# JOE-5 — Smooth level-to-level transition in Iron Snake mode

## Context

Linear issue **JOE-5** ("Create smooth transition from level to level in iron snake
mode"): when a player or bot passes a level, a new board is generated and swapped in
instantly, which feels jarring. The ask (refined with the user): a **geometric morph** —
the board's playable region *reshapes one box at a time* from the completed board's
shape into the next level's shape, rather than a hard cut.

Today the swap is entirely synchronous inside `advanceLevel()` (`src/main.ts:2083`): it
captures the snake's shape, regenerates the board mask/size, reseats the snake, resizes
the canvas, restarts the `setInterval` loop, and calls `draw()` — all in one frame.

## The key lever (why this is clean)

The board's shape is one field: `boardMask: Uint8Array | null` (`main.ts:106`, flat
`gridSize*gridSize`, `1`=playable). **All three board-drawing functions read only that
field:**
- `drawGroundPlane()` reads `this.boardMask[...]` directly (`main.ts:310`).
- `drawGridLines()` and `drawGroundBorder()` read it via `onBoard()` (`main.ts:1583`,
  lines 361/372/411–430).

So if we temporarily assign `this.boardMask` to an **interpolated display mask** (same
`gridSize` dimensions) and call the existing `draw()`, the **floor, grid lines, and
outline all reshape cell-by-cell for free** — no changes to any render function. We
animate by revealing the cells that differ between the old and new shape a few at a time.

## Approach

Keep the game paused for the morph and drive it with a `requestAnimationFrame` loop
modeled on the existing `autoRotateStep` render-only loop (`main.ts:661`). No offscreen
snapshots needed — every frame is a real `draw()` with a mutated `boardMask`.

**Frame 0 (inside `advanceLevel`, after the existing mutations):** the new `gridSize`,
projection (`updateCanvasSize`), real new `boardMask`, reseated snake, and food are all
already in place. We then build, in the **new** grid's dimensions (`N = new gridSize`):

- `targetReal` = the value `regenerateIronSnakeBoard()` left in `this.boardMask` (a
  `Uint8Array`, or `null` for the full-rectangle fallback). Kept to restore verbatim at
  the end.
- `targetDisplay: Uint8Array(N*N)` = copy of `targetReal`, or all-`1` if `targetReal` is
  `null`.
- `startDisplay: Uint8Array(N*N)` = the **old** board's playable cells stamped in,
  center-aligned into the (≥-sized) new grid. (Old mask captured *before* mutation; a
  `null` old mask = a full `O×O` block.) Then **union in every current snake segment and
  the food cell** so nothing is ever drawn floating over void from frame 0.
- `changed` = list of `(x,y)` where `startDisplay !== targetDisplay`, **sorted by
  distance from board center ascending** → an inside-out wave: the shape grows outward
  and old-only cells peel away as the wave passes. (Optional nicer ordering: BFS frontier
  from the cells common to both masks; more code, same scaffolding.)

**Each frame:** eased progress `p = smoothstep(clamp(elapsed / DURATION, 0, 1))`;
`revealCount = round(p * changed.length)`. Maintain one reusable working buffer seeded
from `startDisplay`; since `p` is monotonic, apply `changed[i] → targetDisplay[i]` for the
newly-revealed indices only (incremental, cheap). Set `this.boardMask = workBuffer`, call
`draw()`. The snake/food blocks draw on top as usual (they're collected from positions,
not the mask), so the snake sits on its grounded patch while the arena reshapes around it.

**On completion (`p >= 1`):** cancel RAF, restore `this.boardMask = targetReal` (exact
`null`-or-array), `draw()` once cleanly, restart the logic interval at the new
`gameSpeed`, clear the transition flags.

**Pacing / "one box at a time":** default `DURATION ≈ 600 ms` with the reveal ramped over
it, so it stays snappy but visibly sequential. Trivial to retune (e.g. K cells/frame at a
fixed rate) if you want it slower/more literal.

**Known minor effect:** `gridSize` (and thus cell scale) jumps to the new value at frame
0, so cells shrink slightly at the start of the morph. Per-level grid growth is small
(often +0/+1 cell), so this is subtle; animating the scale too is possible later but adds
real complexity (the projection is derived from `gridSize`). Out of scope for now.

## Fallbacks & scope
- **`prefers-reduced-motion: reduce`** (`window.matchMedia`) → keep today's instant swap.
- **Re-entrancy** → if `isTransitioning`, `advanceLevel` does the instant swap.
- **Scope: Iron Snake only** (matches the issue). Classic-mode `expandGrid()`
  (`main.ts:1964`) keeps its instant swap but could reuse the same helper later.

## Key existing code reused
- **Swap point:** `advanceLevel()` — `main.ts:2083` (mutations 2092–2130); triggered by
  `checkLevelAdvance()` (`main.ts:2076`) from the logic tick.
- **RAF render-only pattern:** `startAutoRotate`/`autoRotateStep` — `main.ts:619–673`.
- **Loop teardown/restart:** `clearInterval(this.gameLoop); this.gameLoop = null` (2125,
  832, 958, 1279) and `startLoopIfNeeded()` (`main.ts:1188`).
- **Render entry (unchanged):** `draw()` — `main.ts:677`.
- **Mask read path (unchanged):** `onBoard()` — `main.ts:1583`; `drawGroundPlane/GridLines/
  GroundBorder` — `main.ts:302/332/385`.

## Implementation (all in `src/main.ts`)

### 1. Fields + constant
Near the auto-rotate fields (~`main.ts:186`):
`private isTransitioning = false`, `private transitionRafId: number | null = null`.
Near the tuning constants (top of file, ~`main.ts:20`): `const LEVEL_TRANSITION_MS = 600`.

### 2. Refactor `advanceLevel()` (`main.ts:2083`)
- Short-circuit to the **current synchronous body** (instant swap) if reduced-motion or
  `isTransitioning`.
- Otherwise: capture the **old** `boardMask` + old `gridSize` *before* mutating; run the
  existing mutations (lines 2092–2123: `level++`, grid sizing + `regenerateIronSnakeBoard`
  + `reseatKeepingShape` retry ladder, `maxLength*`, `levelGoal`, `gameSpeed`,
  `updateCanvasSize`) plus `spawnFood()`/`updateUI()`; **but do not** restart the interval
  or `draw()` here. Then `clearInterval(this.gameLoop); this.gameLoop = null;
  this.isTransitioning = true`, build the masks + `changed` list, and start the morph loop.

### 3. New `startLevelMorph(...)` + `morphStep(timestamp)`
Mirror `autoRotateStep` (record start time on first frame; reschedule via
`requestAnimationFrame`; store id in `transitionRafId`). Per frame: compute `p`,
`revealCount`, update the working mask incrementally, `this.boardMask = workBuffer`,
`draw()`. On finish: restore `targetReal`, `draw()`, restart interval, clear flags/RAF id.

### 4. Suppress the stray trailing draw during a transition
`advanceLevel` runs mid-tick; the enclosing tick still calls `draw()` at its tail
(`updateSinglePlayer` ~`main.ts:1361`, `updateTwoPlayer` ~`main.ts:1475`), which would
paint one full new-board frame before the morph starts. Gate both:
`if (!this.isTransitioning) this.draw()`. (Confirm exact lines when editing.)

### 5. Coordinate with auto-rotate
Add `&& !this.isTransitioning` to the guard in `autoRotateStep` (`main.ts:664`) so camera
rotation freezes during the ~600 ms morph and resumes after (it self-gates; no teardown).

### 6. Teardown cleanup
In `startNewGame` / back-to-menu / existing `clearInterval` sites: if `transitionRafId !==
null`, `cancelAnimationFrame` it, null it, and clear `isTransitioning`, so a morph in
flight can't paint over a fresh game.

## Files touched
- `src/main.ts` — the only file. New fields + constant, refactor `advanceLevel()`, two new
  methods (`startLevelMorph`, `morphStep`) + a small mask-builder helper, three guards
  (two tail `draw()`s + `autoRotateStep`), teardown cleanup.

## Verification
1. `npm run dev`; also `npm run build` for a clean typecheck.
2. **Iron Snake single-player:** reach the level-1 goal (5 pts, or drive with a bot) and
   confirm the board **outline + floor reshape cell-by-cell** into the next level over
   ~0.6 s, the snake keeps its length/shape and stays grounded throughout, and normal
   play + input resume immediately after (loop restarted at the new speed).
3. Advance through **several** levels quickly (bot): no double-fire, no dead loop, HUD
   (`#level`, `#grid-size`, goal countdown) correct after each; watch a level where the
   new shape is markedly different (holes/protrusions) to confirm the morph looks right.
4. **Two-player / bot-vs-bot:** both snakes reseat correctly and neither can die mid-morph
   (loop paused).
5. **Reduced motion:** force `prefers-reduced-motion: reduce` → instant swap, no errors.
6. **Auto-rotate + overhead view:** trigger a level-up while auto-rotating and again in
   overhead view; morph renders correctly and rotation resumes afterward.
7. **Classic mode unaffected:** play a non-Iron-Snake game past a grid-doubling; behavior
   unchanged.
