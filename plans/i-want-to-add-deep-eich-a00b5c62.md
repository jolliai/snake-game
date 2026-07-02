# Random Arena — Randomly-Shaped Board with Level Goals

## Context

Today the snake board is always a full `gridSize × gridSize` square (default 10×10) that **doubles** in size once it's 25% full (`expandGrid`). The user wants a new **Random Arena** experience: at game start the board is carved into a *random, irregular shape* that is (a) fully connected — every playable cell reachable from every other — and (b) free of narrow corridors only 1–2 cells wide.

In this mode the grid-doubling mechanic is replaced by a **level/goal system**: each level has a target point total; when reached, a *fresh* random shape is generated and a new, higher goal is set. Goals start small and ramp up. Difficulty is *emergent* — the same goal is harder to reach on a small-area or choke-heavy board.

**Decisions confirmed with the user:**
- **Activation:** a menu **toggle** ("Random Arena") that composes with any of the three existing modes (single / two-player / bot-vs-bot). Default off → classic game is byte-for-byte unchanged.
- **Scope:** all three modes.
- **Level advance:** single-player when `score >= goal`; multiplayer when **combined** `score + score2 >= goal`. On advance, regenerate the shape and reset both snakes onto it.

## Approach

The whole design hinges on one fact: **`inBounds()` (main.ts:1201) is the single collision chokepoint** — player collision, MP wall checks, `wouldCollide`, `checkCollision`, and the bot BFS `analyzePosition` (main.ts:1274) all funnel through it. Represent the arena as an on-board **cell mask** and make `inBounds` consult it; off-board cells then behave as walls everywhere at once, with **zero changes to bot code or the movement loops**. Classic mode keeps `mask = null` and `inBounds` short-circuits to today's exact expression.

### 1. Board mask + state (main.ts, near line 63)
- `boardMask: Uint8Array | null = null` — length `gridSize²`, `1` = playable, `0` = off-board; `null` = classic rectangle. (Flat array, not a `Set<string>`, because `inBounds` runs in tight BFS loops — index lookup `mask[y*gridSize + x]` beats string-key hashing.)
- `randomArena: boolean = false` — the menu toggle (persists across replays; only the user resets it).
- `boardArea: number` — count of playable cells (capacity metric; classic = `gridSize²`).
- `levelGoal: number` — points needed to advance the current level.
- New helper `onBoard(x, y)`: rectangle bounds AND (`boardMask === null` || `boardMask[y*gridSize+x] === 1`).
- **Rewrite `inBounds` body** to `return this.onBoard(position.x, position.y)` — the only collision edit needed.

### 2. Shape generation — new module `src/arena.ts`
Export `generateArenaMask(gridSize, rng?) → { mask: Uint8Array; area: number } | null`. Keep it pure and unit-testable, imported like `bots`/`leaderboard`.

**Algorithm — "overlapping rooms"** (chosen over cellular-automata caves and random-walk accretion because rectangles of min side ≥3 make the no-narrow-corridor property nearly free, overlap gives connectivity, and area is trivially tunable):

```
for attempt in 1..RETRY_CAP (~30):
  mask = zeros(N*N); place first room near center
  roomCount = randInt(3,6)
  for each further room:
    pick an existing on-board cell C
    w,h = randInt(3, min(maxRoom, N))         // min side 3 → never <3 wide
    position rectangle so it covers C          // overlap → connectivity
    fill rectangle with 1
  keep largest 4-connected component (flood fill)     // guarantee connectivity
  if fill ratio outside [targetLo, targetHi]: continue // area control
  if not passesMinWidth(mask, k=3): continue           // forbid 1-2-wide necks
  return { mask, area }
return null   // → caller falls back to classic full rectangle
```
- **Connectivity:** BFS over on-board 4-neighbours; prune to the largest component (do this *before* the width check, since pruning can create a thin neck).
- **Min-width:** morphological **open** with a 3×3 element (erode then dilate). If the open removes any cell, that cell sat in a <3-wide sliver → reject. Because rooms are ≥3 wide this usually passes first try; it's a guard, not the generator.
- **Fallback:** retry-cap exhaustion returns `null`; caller sets `boardMask = null` so the game *always* launches.

### 3. Level/goal system (replaces expandGrid in arena mode)
- `goalForLevel(level)` — ramping curve, e.g. `BASE + STEP*(level-1) + CURVE*(level-1)²` (3, 6, 11, 18, …). **Cumulative total** thresholds (not per-level resets) so single-player's leaderboard `this.score` stays the honest final score; strictly-increasing goals are each crossed once as the snake keeps eating.
- **Dispatcher at the two `checkGridExpansion()` call sites** (main.ts:1015 single, 1084 MP): `if (randomArena) checkLevelAdvance() else checkGridExpansion()`.
- `checkLevelAdvance()`: single `score >= levelGoal`; MP `score + score2 >= levelGoal` → `advanceLevel()`.
- `advanceLevel()`: `level++`; regenerate mask (fallback to null); `boardArea = area`; reposition snake(s) via `findStartCell` (reset to length 1 — matches the "new arena" feel and guarantees legality); `spawnFood()`; `levelGoal = goalForLevel(level)`; ramp speed *gently* (e.g. `baseSpeed * 0.9^(level-1)`, floored) rather than halving; restart the interval (as `expandGrid` does at 1307); `updateUI()`. **`gridSize` does NOT change** in arena mode, so the canvas never balloons and `isoCache` stays valid.

### 4. Placement on arbitrary shapes
New helper `findStartCell(preferredRegion, occupied) → { pos, dir }`: among on-board unoccupied cells nearest `preferredRegion`, pick one with a direction giving ≥`FORWARD_CLEARANCE` (~3) clear cells ahead, so a snake never insta-dies on a wall.
- **Single** (`startNewGame` 930-937, `advanceLevel`): use `findStartCell(centroid, ∅)`.
- **MP** (`startNewGame` 910-928): P1 → left-third centroid, then P2 → right-third centroid with P1 occupied. **Mutual reachability is automatic** — the mask is a single connected component, so any two on-board cells are reachable. Fall back to classic rectangle if a placement ever returns null.

### 5. Rendering (main.ts draw routines — guard each; classic keeps the fast path)
- `drawGroundPlane` (236): `if (!onBoard(gx,gy)) continue` — void cells show the dark background.
- `drawGridLines` (263): when mask active, stroke per-cell edges (dedupe shared edges) instead of full spans.
- `drawGroundBorder` (292): when mask active, stroke every edge where an on-board cell meets an off-board cell / the rectangle edge — traces the true outline (and interior holes). No polygon tracing needed.
- `isoCache` already covers the full `(gridSize+1)²` lattice → valid lookup for any subset; `drawBlock`/`getBlockHeight` unchanged.

### 6. Food, HUD, toggle wiring
- `spawnFood` (1315): add `onBoard` to both the empty-cell filter (high-fill branch) and the rejection-sample `while` condition; switch the branch selector to compare against `boardArea`, not `gridSize²`. Guard empty-list.
- **index.html:** add `<label><input type="checkbox" id="random-arena-toggle"> Random Arena</label>` in the menu (near 20-58); `change` listener in `setupEventListeners` (~518) sets `this.randomArena`. All three launch paths read `this.randomArena` in `startNewGame` — no per-button branching. Replay paths (`play-again`, R/Enter) reuse it → fresh shape each replay.
- **HUD:** in `updateUI` (1351), when arena is on, repurpose `#grid-size` (index.html:84) to show `Goal: <score|combined>/<levelGoal>`; else the existing `NxN`.
- **`+/-` size keys (667-684):** in arena mode, treat as arena-size selector (clamp min ≥12 so 3-wide rooms fit), regenerate mask + reposition via `findStartCell` instead of the center snippet.

### 7. Bots & leaderboard (no API change)
- Bots stay **shape-unaware** — do NOT add the mask to `BotState` (`bot-types.ts` frozen). Their moves are engine-validated through the now-mask-aware `inBounds`, so a stale heuristic just kills the bot rather than corrupting state. Edge-hugging bots (explorer/edge-runner/spiral/sweeper/ambusher/zigzag) degrade gracefully. Acceptable per requirements.
- Leaderboard: arena runs record into the same `single|pvp|bvb` board (gameMode unchanged). **Default: accept the mixed board** — no `leaderboard.ts` change. Tagging entries `arena: true` is a possible follow-up, not built now.

## Critical files
- `src/main.ts` — `inBounds`:1201, `spawnFood`:1315, `startNewGame`:898, `checkGridExpansion`/`expandGrid`:1291-1311, draw routines:236-308, `updateUI`:1351, key handler:667, call sites:1015/1084.
- `src/arena.ts` — **NEW**: mask generator, connectivity, min-width, area.
- `index.html` — menu toggle (20-58), HUD (78-95).
- `src/bots/bot-types.ts` — confirm `BotState` unchanged.
- `src/leaderboard.ts` — untouched under the default decision.

## Sequencing
1. `src/arena.ts` (pure, test first). 2. `main.ts` state + `onBoard` + `inBounds`. 3. `spawnFood` + branch selector. 4. `findStartCell` + placement in `startNewGame`. 5. Level/goal (`goalForLevel`, `checkLevelAdvance`, `advanceLevel`, dispatcher). 6. Render guards. 7. HTML toggle + listener + HUD + `+/-` branch.

## Verification
- **Toggle-off regression:** launch each mode with the toggle off → identical to today (full square, grid doubles at 25%, center start). Confirm `boardMask` stays null.
- **Shape validity:** in `arena.ts`, add/run a quick harness generating many masks and asserting (a) single connected component, (b) 3×3 open leaves the mask unchanged (no ≤2-wide necks), (c) area within target band. `npm run build` for type safety.
- **In-app (`npm run dev`, use the /run skill):** toggle on, start single-player → verify an irregular connected board renders with a clean outline, snake spawns safely, food only spawns on-board. Play to the level goal → confirm a *new* shape appears, level increments, goal rises, snake resets. Repeat for two-player and bot-vs-bot (combined-score advance; bots navigate without corrupting state even when they wall-hit). Exercise `+/-` sizing and replay (R/Enter) in arena mode.
