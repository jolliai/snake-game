# JOE-9 — Add Exit (Iron Snake)

## Context

Linear **JOE-9** ("Add Exit"): *"an exit that appears after the goal has been reached on a border and the snake needs to exit to get to the next level."*

Today, in **Iron Snake** mode, reaching a level's cumulative point goal advances instantly: `checkLevelAdvance()` (`src/main.ts:1974`) calls `advanceLevel()` the moment `combined >= levelGoal`, which stops the loop and runs the board-morph transition (JOE-5). This makes level completion passive — you eat the last fruit and the level just changes.

JOE-9 makes completion an **active navigation beat**: hitting the goal opens a glowing **exit door on a border cell** of the irregular board; the player must steer the snake's head onto it to trigger the morph into the next level. This is Iron-Snake-only (classic mode uses grid-doubling, no goals).

Confirmed with the user:
- **Fruit is hidden while the exit is open** (the sole objective becomes reaching the exit), and the **starvation timer is paused** during the exit run so the trek can never be a death sentence.
- **Full signaling**: a distinct door cell + HUD switches to "Reach the exit!" + a brief pop-in banner that fades (consistent with the JOE-6 fruit countdown and the JOE-7 rainbow banner).

Branch `josephhart/joe-9-add-exit` is already created and checked out.

## Behavior

1. Iron Snake, `combined score >= levelGoal` → instead of advancing, pick a border cell and **open the exit** there; fire the banner; hide the fruit; pause starvation.
2. Snake head lands on the exit cell → `advanceLevel()` (existing morph → next level). Either snake in 2P; bots retarget to the exit.
3. New level clears the exit and re-shows fruit. Fallback: if no valid border cell exists, advance immediately (old behavior) so the game can never stall.

## Files

- `src/main.ts` — all game logic, rendering, HUD, bot targeting, reset, test override.
- `index.html` — add `#exit-banner` overlay element inside `.canvas-wrap`.
- `src/style.css` — `.exit-banner` styles (mirror `.death-banner` / `.rainbow-banner`).
- `tests/e2e/iron-snake.spec.ts` — add exit-state E2E test(s).

## Implementation (`src/main.ts`)

### New state (near the Iron Snake fields ~line 129, and rainbow fields ~237)
- `private exitCell: Position | null = null` — the open exit, or null. Doubles as the "exit phase" flag.
- `private exitPulseTick: number = 0` — incremented once per tick while the exit is open; drives a subtle **tick-paced** brightness pulse on the door (honors the "transitions visible & tick-paced" preference).
- `private exitBannerTimer: number | null = null` — mirrors `rainbowBannerTimer` for the timed pop-in→fade.
- `private ironExitOverride: boolean = parseIronExitOverride()` — test hook (see below), parsed at construction like `parseRainbowOverride()` (line 239).

### Open the exit instead of advancing
- **`checkLevelAdvance()` (1974–1979):** when `combined >= this.levelGoal && this.exitCell === null`, call `this.openExit()` instead of `this.advanceLevel()`.
- **New `openExit()`:** enumerate on-board **border** cells (reusing the `onBoard()` extent check at 1680; mirror the enumerate-on-board loop in `spawnFood()` at 2214–2230), excluding cells in `snakeSet`/`snakeSet2` and cells within 2 (Manhattan) of any head. Pick one at random. Set `exitCell`, reset `exitPulseTick`, call `showExitBanner()` + `updateUI()`. If **no** candidate → `this.advanceLevel()` (safe fallback).
- **New `isBorderCell(x, y)`:** `onBoard(x,y)` true **and** at least one orthogonal neighbor is off-board (`!onBoard(nx,ny)` — this also catches the grid edge, since `onBoard` returns false outside `[0,gridSize)`). No such helper exists today; the `NEIGHBORS` offsets live only inside `iron-snake.ts` (not exported), so define the 4 offsets locally.

### Detect head-on-exit → advance
- **Single-player (`updateSinglePlayer`):** after the eat/no-eat block (after `:1439`), before starvation:
  ```ts
  if (this.exitCell && head.x === this.exitCell.x && head.y === this.exitCell.y) {
    this.advanceLevel(); return
  }
  ```
- **Two-player (`updateTwoPlayer`):** after tail removal (after `:1551`), before starvation: advance if **either** head equals `exitCell`.

### Make fruit inert while the exit is open
- Guard the eat comparison so fruit can't be eaten during the exit run:
  - Single: `if (this.exitCell === null && head.x === this.food.x && …)` (`:1429`).
  - 2P: `const p1AteFood = this.exitCell === null && head1.x === this.food.x && …` (`:1529–1530`).
- Guard the fruit render: only `objects.push({…food, type:'food'})` (`:764`) when `this.exitCell === null`. (Countdown-color logic at 815–818 needs no change — it just won't be drawn.)

### Pause starvation during the exit run
- Wrap the starvation death check in `if (this.exitCell === null) { … }` — single (`:1443`) and 2P (`:1558–1569`). Increment `exitPulseTick` each tick while `exitCell !== null`.

### Bots must target the exit (else bot/bvb stalls at the goal)
- Add `private botTarget(): Position { return this.exitCell ?? this.food }`.
- Use it for `food:` in both `BotState` builders — `chooseBotDirection` (`:1581`) and `chooseBotDirectionForPlayer` (`:1610`) — so bot-driven snakes path to the door and trigger the advance.

### Rendering the door (`draw()`)
- Add `'exit'` to the `DrawType` union (`:745`).
- When `exitCell !== null`, push `{ x, y, type: 'exit' }` into `objects` so it depth-sorts correctly (like the food push at 764).
- Add a `case 'exit':` in the block switch (`:821+`) that calls `drawBlock(x, y, top, right, left)` with an **emerald/teal portal palette** (distinct from red fruit and green/blue snakes), brightness lerped by `exitPulseTick` via `lerpHex` (existing, `:1872`) for a gentle pulse. `drawBlock` (513) → `drawPrism` renders correctly in **both** isometric and overhead views (flat when `baseBlockHeight===0`), so no overhead-specific branch is needed.

### HUD (`updateUI`, 2247)
- In the Iron Snake branch (`:2262`), when `this.exitCell !== null` set `#iron-snake-goal` text to `Reach the exit!` (keep `#iron-snake-goal-display` visible); otherwise keep the existing "N pts" readout.

### Banner (mirror the rainbow banner, 2313–2336)
- `showExitBanner()` / `hideExitBanner()` / `clearExitBannerTimer()` — pop in, hold, fade via `setTimeout` (reuse `RAINBOW_BANNER_FADE_MS` cadence or a new `EXIT_BANNER_MS`). Text e.g. `🚪 Exit open — reach the door!`.
- Element `#exit-banner` added to `.canvas-wrap` in `index.html` (next to `#death-banner`/`#rainbow-banner`, lines 91–98); `.exit-banner` CSS in `style.css` cloned from `.death-banner` (202–225) with an emerald accent + the pop/fade keyframes.

### Reset / teardown
- Clear `exitCell = null`, `exitPulseTick = 0`, and `clearExitBannerTimer()` + `hideExitBanner()` in:
  - `applyLevelAdvance()` (2002) — new level re-shows fruit (it already calls `spawnFood()`).
  - `startNewGame` reset path (~1271–1360) and wherever the rainbow banner is hidden on screen change (~2679).

### Test hook
- `parseIronExitOverride()` — free function mirroring `parseRainbowOverride()`, returns true when `?ironExit=1` is in `location.search`.
- In `startNewGame`, after the Iron Snake board is built: `if (this.ironExitOverride && this.ironSnakeMode) this.openExit()` — deterministically opens the exit at game start (snake length 1 at center; border cells always exist), so the DOM state is assertable, exactly as `?rainbow=1` forces the rainbow roll.

## Tests (`tests/e2e/iron-snake.spec.ts`)

Follow the rainbow precedent (URL override + DOM assertions; canvas not asserted):
- **`?ironExit=1`**: `goto('/?ironExit=1')`, check `#iron-snake-toggle`, start game → assert `#iron-snake-goal` reads `Reach the exit!` and `#exit-banner` becomes visible then hidden (timed fade, like the rainbow banner test).
- **Negative**: a normal Iron Snake game (no override) shows the usual "N pts" readout and `#exit-banner` stays hidden.

## Verification

1. `npm run build` (tsc + vite) — type-check + bundle.
2. `npm test` — full Playwright suite incl. the new exit tests and existing iron-snake/rainbow/gameplay specs (guards against regressions in the shared tick/draw path).
3. **Behavioral pass** (canvas position isn't DOM-observable, so drive it live via the `/run` skill or a scripted Playwright drive): load `/?ironExit=1`, enable Iron Snake, start, and steer the head onto the door — confirm the board morphs and `#level` increments to `2`, fruit reappears, and the exit clears. Spot-check overhead view (`O` key) shows the door as a flat colored cell, and a bot/bvb game navigates to and takes the exit (doesn't stall).
