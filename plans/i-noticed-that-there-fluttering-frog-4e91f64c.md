# Fix bot infinite-loop / oscillation (esp. Iron Snake Mode)

## Context

In Iron Snake Mode (and, less often, classic mode) the AI snakes get stuck in
perpetual approach/retreat cycles: a bot paths toward the single food cell,
arrives in a tight pocket, its safety scoring correctly refuses to enter (it
would trap itself), so it retreats — then, from the retreated position, the
*exact same* deterministic scoring re-selects the *exact same* losing approach,
and it repeats forever.

**Root cause (confirmed by exploration):** every bot is a *stateless, per-tick,
greedy direction-scorer* with **no memory, no randomness, and no tie-breaking**
(`src/bots/*.ts`, harness at `src/main.ts:1221-1289`). There is one fixed food
target (`this.food`). Given an identical board configuration, the scoring
produces an identical choice, so any positional cycle is stable and never
breaks. Iron Snake's irregular masks create far more tight pockets, which is why
it surfaces there. This is inherent to the architecture, not a bug in one bot.

**Intended outcome:** bots detect when they are cycling and vary their strategy
to escape, without degrading normal play or breaking any of the 11 bot
personalities.

## Approach

Add a centralized **loop guard** at the harness level rather than rewriting all
11 stateless bots. Bots return only a `Direction` (not scores), so the harness
cannot re-weight their scoring — but it CAN track visited cells and override the
choice when a genuine loop is detected, injecting the memory + variation the bot
layer lacks. Normal bot behavior is untouched unless a loop is actually
happening, so personalities and demos stay intact.

### New shared module: `src/bots/loop-guard.ts`

Reused by both game harnesses (`main.ts` and `menu-demo.ts`) — no logic
duplication. Exports:

- `type LoopMemory = { recentHeads: string[]; escapeTicks: number }`
- `createLoopMemory(): LoopMemory`
- `resetLoopMemory(mem)` — clear history + escape counter (called on progress:
  food eaten, level advance, snake reposition, game start/restart).
- `recordHead(mem, head: Position)` — push `"x,y"` into a capped ring buffer
  (window ~30).
- `isLooping(mem): boolean` — true when the most-recent head cell has been
  revisited `>= REVISIT_THRESHOLD` (≈3) times inside the window. Revisit-count
  detection naturally stays silent while the snake makes forward progress.
- `chooseEscapeDirection(state, helpers, mem): Direction | null` — the variation
  step. Among the legal candidate directions (`getCandidateDirections` +
  `simulateMove !== null`), prefer those whose resulting position is safe
  (`analyzePosition().canReachTail`), then pick the one whose resulting head
  cell has the **lowest recent-visit count** (drives toward unexplored space),
  tie-broken with `Math.random()`. Falls back to max `reachableArea` if none can
  reach tail; returns `null` if no safe move (harness keeps the bot's pick).

All of this uses the existing `BotHelpers` (`simulateMove`, `analyzePosition`,
`getCandidateDirections`), so it automatically respects the Iron Snake
`boardMask` (via `onBoard`/`inBounds`) and the P2 opponent-blocking helpers.

### Harness wiring in `src/main.ts`

- Add per-snake memory fields near the bot state: `botLoopMemory` (P1/single,
  by field 89-96) and `botLoopMemory2` (P2, by 98-101), initialized with
  `createLoopMemory()`.
- In `chooseBotDirection` (`main.ts:1221`) and `chooseBotDirectionForPlayer`
  (`main.ts:1243`): after the bot picks its direction, `recordHead(mem,
  snake[0])`; if `mem.escapeTicks > 0 || isLooping(mem)`, call
  `chooseEscapeDirection`; when it returns a direction, use it instead and set
  `mem.escapeTicks = ESCAPE_DURATION` (≈8) so the snake commits to breaking out
  rather than snapping back. Decrement `escapeTicks` each tick. The chosen
  direction still passes the existing `isValidDirection` + `simulateMove`/
  collision re-validation, so no illegal move is possible.
- Call `resetLoopMemory` at the progress points already located: single-player
  food eat (`main.ts:1129`), 2-player food eat (`main.ts:1197`),
  `advanceLevel` (`1546`), `repositionSnakes` (`1509`), and the game
  start/restart paths (near `762-780` and `1007-1065`).

### Menu demo (in scope)

`src/menu-demo.ts:144-209` has its own copy of the bot harness for the
background animation. Apply the same `loop-guard` there (a `LoopMemory` per
demo snake) to remove the same oscillation from the menu visuals, reusing the
one shared module.

### Behavior decision (confirmed)

The guard engages **only when a loop is detected** — bots stay fully
deterministic and keep their exact personalities in normal play. No ongoing
random jitter is added to the bots' scoring.

## Files to modify

- **New:** `src/bots/loop-guard.ts` — the shared loop-detection + escape logic.
- `src/main.ts` — memory fields, wiring in the two `chooseBotDirection*`
  methods, `resetLoopMemory` calls at the reset points.
- `src/menu-demo.ts` — same wiring for demo snakes.
- Possibly a small unit test for `loop-guard` if the repo has a test setup.

## Verification

1. Build/typecheck: run the project's build (e.g. `npm run build` /
   `tsc --noEmit`) — no type errors.
2. Run the app (`/run` or `npm run dev`), enable Iron Snake Mode, set a bot
   (Survival/Hunter), and watch a run through several regenerated boards:
   confirm snakes no longer sit in an approach/retreat cycle in tight pockets
   and instead wander off to explore, eventually reaching food or safely
   filling space.
3. Confirm classic mode is visually unchanged in normal (non-stuck) play —
   personalities (Coiler hugging, Edge-runner on walls, etc.) still read the
   same, since the guard only engages on detected loops.
4. If menu demo is included, confirm the title-screen background snakes stop
   oscillating.
