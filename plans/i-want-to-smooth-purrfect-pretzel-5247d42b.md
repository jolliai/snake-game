# Smooth Iron Snake progression: keep the snake, grow the board with the goal

## Context

Today, every Iron Snake level advance calls `advanceLevel()` → `repositionSnakes()`
(`src/main.ts:1763`, `1722`), which **truncates each snake back to length 1** and
re-seats it on a freshly generated shape. The board's bounding box (`gridSize`) is
fixed for the whole game (`max(initialGridSize, 12)`), so only the *shape* is
re-rolled each level — the playable area never grows.

This makes progression feel choppy: your snake resets to a dot at the start of each
level, and difficulty scaling comes only from the rising goal + a 10%/level speed
ramp on a same-size board.

**Goal (confirmed with the user):**
1. **Keep the snake across levels** — and place it back **in the same shape it was**
   (preserve its body geometry, not just its length).
2. **Grow the board area proportionally to the goal.** Because the snake now keeps
   its full (cumulative) length, the board *must* grow or the snake eventually fills
   a fixed board and late levels become impossible. Target: the snake fills **~40%**
   of the playable area at the moment its level goal is reached (tighter/harder).

The cumulative triangular goal curve (`ironSnakeGoalForLevel`, 5/15/30/50/75…,
`src/main.ts:40-42`) is a settled decision and is **not** changing.

## Approach

### 1. Board area scales with level (`src/main.ts` + `src/iron-snake.ts`)

The board must hold a snake whose length at the level's end is
`endLen = 1 + ironSnakeGoalForLevel(level)` (in 2-snake modes, the **combined**
end length `2 + goal`, since both snakes share one board). Target playable area:
`targetArea = endLen / IRON_SNAKE_GOAL_FILL` with a new const
`IRON_SNAKE_GOAL_FILL = 0.4`.

- **New exported helper in `src/iron-snake.ts`:** `ironSnakeGridSizeForArea(targetArea)`
  → `ceil(sqrt(targetArea / midFill))` clamped to `MIN_GRID`, where `midFill` is the
  midpoint of the existing `TARGET_FILL_LO`/`TARGET_FILL_HI` band (0.575). Keeps the
  fill constants encapsulated where the generator lives.
- **New method `ironSnakeGridSizeForLevel(level)` in `main.ts`:** returns
  `max(floor, ironSnakeGridSizeForArea(targetArea))`, where
  `floor = max(IRON_SNAKE_MIN_SIZE, this.initialGridSize)`. Monotonic in `level` and
  never below the floor, so **the board never shrinks between levels**. For level 1
  this returns the floor (12 by default) — identical to today.
- Result: `gridSize` grows gently (≈ 12, 12, 12, 15, 19, 22 …) — much gentler than
  classic doubling.

### 2. Grow the board using the existing gridSize-change plumbing

Changing `gridSize` mid-game is already a solved problem: classic `expandGrid()`
(`main.ts:1686-1697`) sets `gridSize`, then `updateCanvasSize()` rebuilds the canvas
**and `isoCache`** (`main.ts:233`, cache rebuilt at `287-292`), then restarts the
interval. `advanceLevel()` already calls `updateCanvasSize()` + restarts the interval,
so we reuse that path — just set the new `gridSize` **before** regenerating the mask
(so `onBoard`/mask length stay consistent), place the snakes, then `updateCanvasSize()`.

### 3. Preserve the snake's shape on advance (the core change)

Replace the "reset to length 1" logic. In `advanceLevel()`, **before** regenerating:

- Capture each snake's body as **relative offsets from its head**
  (`shape[i] = snake[i] - snake[0]`) plus its current facing `direction`. Offsets are
  gridSize-independent, so a larger new board is fine.

Then place each captured shape **rigidly** onto the new board with a new helper
`placeRigidSnake(shape, dir, preferred, occupied, clearance=3)`:

1. Enumerate on-board, unoccupied anchor cells sorted by distance to `preferred`
   (same candidate-gathering as `findStartCell`, `main.ts:1506-1541` — reuse its
   pattern / factor out the sorted-candidate scan).
2. For each anchor `H`, try orientations **identity first, then 90/180/270°**
   (identity keeps the snake visually unchanged; rotations are the fallback that
   still preserves the *shape*). For an orientation `R`, the body is
   `H + R(offset[i])`; accept iff **every** segment is `onBoard` and not in
   `occupied`, and the head has `clearance` clear cells ahead in the rotated
   direction. Return the first fit (`body`, rotated `dir`).
3. Return `null` if nothing fits.

Set `snake`/`snakeSet`/`direction`/`nextDirection` (and the `2` variants) from the
result. Two-player: place snake 1, add its cells to `occupied`, then place snake 2
near the right third. Also reset `movesSinceFood1/2` and both bot loop memories, as
`repositionSnakes()` does today (`main.ts:1723-1726`).

**Fallback chain (guarantees the game always continues legally):**
1. Rigid placement (translation, then rotation) at the target gridSize.
2. If it fails, bump `gridSize` by 1 and retry rigid placement (a few times) — more
   room makes a rigid fit easier.
3. If still failing, fall back to a length-preserving **self-avoiding re-layout**
   (a `layoutSnakeBody(head, dir, length, occupied)` DFS that walks the body behind
   the head) — keeps the length even if the exact shape can't be honored.
4. Last resort: drop the mask (`boardMask = null`, full rectangle) and lay out there,
   which always succeeds — mirroring today's existing rectangle fallback
   (`main.ts:1768-1771`).

`repositionSnakes()` is generalized/renamed to take target lengths (or captured
shapes): new-game start passes length 1 (unchanged behavior via the trivial
1-segment shape); `advanceLevel` passes the captured shapes.

### 4. Wire the new gridSize into level start and advance

- `advanceLevel()` (`main.ts:1763`): `level++` → `gridSize = ironSnakeGridSizeForLevel(level)`
  → regenerate mask at that size → place snakes (shape-preserving, with fallbacks) →
  set `levelGoal`/speed → `updateCanvasSize()` → restart interval → `spawnFood()` →
  `updateUI()` → `draw()`.
- Route the **initial** Iron Snake size through the same helper: `startNewGame`
  (`main.ts:1115-1117`) and the `+/-` handler (`main.ts:866-872`) set
  `gridSize = ironSnakeGridSizeForLevel(1)` (equals the floor, so level-1 behavior is
  unchanged).

### 5. Cleanups in the touched code

- The `maxLength1/2 = Math.max(...)` lines in `advanceLevel` (`main.ts:1774-1775`)
  currently run *after* length was reset to 1, making them no-ops. With shape
  preservation the snake keeps its real length, so these become correct again — keep
  them (or drop as redundant, since play-time capture at `1260`/`1366-1367` already
  covers it).
- Update the now-stale comment at `main.ts:1778-1779` ("since the board stays the same
  size each level") — the board now grows per level.

### What does NOT change
- Goal formula / cumulative scoring / `ironSnakeRemaining` / final-3-fruit recolor.
- `spawnFood` (`main.ts:1793`) and starvation (`starvationLimit`, `main.ts:1632-1634`)
  already key off `boardArea`, so bigger boards automatically get more food spread and
  a more generous starvation budget — no edits needed.
- Bots stay shape-unaware (engine-validated through `inBounds`).

## Critical files
- `src/main.ts` — `advanceLevel` (1763), `repositionSnakes` (1722), `regenerateIronSnakeBoard`
  (1703), `findStartCell` (1506), new `placeRigidSnake` / `layoutSnakeBody` /
  `ironSnakeGridSizeForLevel`, new const `IRON_SNAKE_GOAL_FILL`, gridSize wiring at
  `startNewGame` (1115) and the `+/-` handler (866). Reference: `expandGrid` (1686),
  `updateCanvasSize` (233).
- `src/iron-snake.ts` — new exported `ironSnakeGridSizeForArea`; reuse `generateIronSnakeBoard`
  (151), `TARGET_FILL_LO/HI` (19-20), `MIN_GRID` (21).

## Verification
- `npm run build` for type safety.
- **Playtest via the `/run` skill** (`npm run dev`): enable Iron Snake, play single-player
  through several level advances and confirm:
  - The snake **keeps its length and reappears in the same shape** on the new board
    (identical orientation when it fits; a rotated-but-same shape otherwise).
  - The board (canvas) **grows gradually** each level and the snake fills **~40%** of
    the playable area right as the goal is hit (roomier at level start).
  - No crash / no immediate wall death on spawn; food still only on-board.
- Repeat for **two-player** (combined-score advance, both snakes seated in-shape) and
  **bot-vs-bot** (bots navigate the growing boards without corrupting state).
- Force the fallback (small `initialGridSize`, high levels) to confirm the game keeps
  running via re-layout / rectangle fallback rather than freezing.
