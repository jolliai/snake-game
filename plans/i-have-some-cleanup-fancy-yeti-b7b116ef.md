# Cleanup: preview demo polish + bot-control removals + arrow-key scroll fix

## Context

Four cleanup items on `chores/cleanup-bugs`:

1. **Landing-page preview is a stripped-down clone.** The auto-playing menu demo (`MenuDemo` in `src/menu-demo.ts`) is a separate, simplified renderer. It draws the snake as plain blocks (no head eyes / tapered tail), always uses a single fixed bot (Survival) with no on-screen indication of which bot is playing, and runs a plain classic 12×12 game — none of the Iron Snake character. We want it to look and feel like the real game: head/tail graphics, a random bot per life with a corner label, and Iron-Snake-style boards.
2. **"Disable Bot" button is vestigial.** The `#toggle-bot` button (and its `B` shortcut) flips a bot on/off inside a normal single-player game — a mode nobody uses now that bot play lives in the "Solo Bot" menu. Remove it.
3. **Mid-game bot switching.** The `#game-bot-selection` dropdown sits inside the live game screen and swaps the driving bot on the next tick with no gate. Remove the ability to change bots once you're on the game screen (bot choice stays pre-game via the Solo Bot / Bot-vs-Bot menu panels). *(Note: single-player bot runs are already excluded from the leaderboard via `botEverActive`, and BvB fixes its bots pre-launch, so no stored leaderboard entry is currently corrupted — this is a UX/consistency cleanup.)*
4. **Arrow keys scroll the page.** On a short viewport, Arrow keys scroll the browser window because the global `keydown` handler never calls `preventDefault()`. WASD is unaffected. Simple fix.

Confirmed decisions: (1) preview picks a **fresh board each life**, randomly choosing **Iron Snake (irregular) vs classic (full rectangle)**, plus a **new random bot**, on every reset (covers page-load and every subsequent death); (2) remove the Disable Bot **button + `B` shortcut + `toggleBot()` logic** entirely.

## Files to modify

- `src/menu-demo.ts` — preview head/tail graphics, Iron/classic board, random bot, label updates (Task 1)
- `index.html` — add bot-label element (Task 1); remove `#toggle-bot` button + its controls-text mention (Task 2); remove `#game-bot-selection` block (Task 3)
- `src/style.css` — style the bot label (Task 1); drop now-dead `.bot-selection` rules (Task 3)
- `src/main.ts` — remove toggle/hotkey/logic (Task 2); drop the mid-game selector from wiring (Task 3); arrow-key `preventDefault` (Task 4)

---

## Task 1 — Preview demo parity (`src/menu-demo.ts`, `index.html`, `src/style.css`)

### Head & tail graphics (port from the real game)
Port these from `SnakeGame` in `src/main.ts` into `MenuDemo`:
- **`drawPrism(corners, bh, top, right, left)`** (`main.ts:484`) — the shared extrusion routine. Refactor the demo's existing `drawBlock` (`menu-demo.ts:409`) to delegate to `drawPrism` and add a `heightScale = 1` param (matches `main.ts:467`).
- **`drawSnakeHead(gx, gy, colors, dir)`** (`main.ts:542`) — taller block (`HEAD_HEIGHT_SCALE = 1.6`) with two eyes on the leading face. The demo has no overhead view, so `hs` is always `HEAD_HEIGHT_SCALE`.
- **`drawSnakeTail(gx, gy, colors, awayDir)`** (`main.ts:594`) + **`tailDirection(snake)`** (`main.ts:586`) + **`vectorToDirection(v)`** (`main.ts:1676`) — tapered tail prism.
- Constants `HEAD_HEIGHT_SCALE = 1.6`, `TAIL_HEIGHT_SCALE = 0.7`.

Update `draw()` (`menu-demo.ts:317-334`): extend the object type to include `'tail'`; classify segments as the real game does — `index === 0 → head`, `index === len-1 → tail`, else `body` (a length-1 snake is just a head, no tail). Dispatch: head → `drawSnakeHead(x, y, headColors, this.direction)`; tail → `drawSnakeTail(x, y, bodyColors, this.tailDirection(this.snake))`; body → `drawBlock`. Reuse the P1 color tuples from `main.ts:743-746`: head `['#4ade80','#22c55e','#16a34a']`, body `['#22c55e','#16a34a','#15803d']`, food `['#ef4444','#dc2626','#b91c1c']`.

### Iron / classic board (fresh + random each life)
- Import `generateIronSnakeBoard` from `./iron-snake` and add a field `boardMask: Uint8Array | null = null`.
- Add an `onBoard(x, y)` helper (rectangle bounds AND, if `boardMask` set, `boardMask[y*gridSize+x] === 1`); have `inBounds` delegate to it — mirrors `main.ts:1606`. Because the bot's `simulateMove`/`analyzePosition`/food-spawn all route through `inBounds`, collision + pathfinding + spawning respect the shape automatically.
- In `resetSnake()`: randomly pick Iron vs classic. If Iron, call `generateIronSnakeBoard(this.gridSize)`; on non-null use `mask`, else fall back to classic (`boardMask = null`) — same fallback as the real game. Bump `DEMO_GRID_SIZE` to ~14 so irregular shapes have room (Iron Snake `MIN_GRID` is 12).
- Seat the length-1 snake on a valid cell: center when classic; when masked, the on-board cell nearest center (center may be void).
- `spawnFood()` (`menu-demo.ts:221`): only consider on-board empty cells.
- Port the **masked branches** of `drawGroundPlane` (skip off-board cells, `main.ts:310`), `drawGridLines` (per-cell edges, `main.ts:356-380`), and `drawGroundBorder` (trace the irregular outline, `main.ts:405-438`) so Iron boards render with the authentic carved look; keep the existing full-rectangle branches for classic.

### Random bot + corner label
- In `resetSnake()`, pick `this.bot = AVAILABLE_BOTS[Math.floor(Math.random() * AVAILABLE_BOTS.length)]` (replaces the fixed `DEFAULT_BOT_ID` pick at `menu-demo.ts:55`).
- **HTML** (`index.html`, inside `.menu-hero` ~line 13): add `<div id="menu-demo-bot-label" class="menu-demo-bot-label"></div>`.
- **CSS** (`src/style.css`, near `.menu-hero` at line 32): absolutely position the label in a top corner of the hero (small translucent pill, muted text).
- `MenuDemo` updates the label text (e.g. `Bot: <name>`) in `resetSnake()` — query `document.getElementById('menu-demo-bot-label')` once in the constructor.

---

## Task 2 — Remove the "Disable Bot" button (`index.html`, `src/main.ts`)

- **`index.html`**: delete the `#toggle-bot` button (line 94); remove "Press B to toggle bot" from the controls text (line 100).
- **`src/main.ts`**:
  - Delete the click listener (`:830`) and the `B`-key branch (`:969-974`).
  - Delete the `toggleBot()` method (`:1125-1140`).
  - `updateBotUI()` (`:1196-1207`): drop the `toggle` element lookup + its null-guard + the "Disable/Enable Bot" label line (and the redundant `demoButton` text line); keep updating `#bot-status`. **Important:** the current guard `if (!status || !toggle || !demoButton) return` must lose `toggle`/`demoButton`, or removing the button would make it bail and stop updating status.
  - `updateModeUI()` (`:2260-2285`): remove the `toggleBot` lookup (`:2268`) and its `.hidden` toggle (`:2276`); drop "Press B to toggle bot" from the single-player controls string (`:2283`).
- **Keep** `botEnabled` / `botEverActive` and all their other uses — the Solo Bot launch (`demo-launch`, `:827`) still sets `botEnabled = true`, human-input suppression (`:1095`) and leaderboard disqualification (`botEverActive`, `:1225`, `:2340`) still work, and menu/Escape/back-to-menu still reset `botEnabled = false`.

---

## Task 3 — Remove mid-game bot switching (`index.html`, `src/main.ts`, `src/style.css`)

- **`index.html`**: delete the `#game-bot-selection` block (lines 89-93) — `#game-bot-select` + `#game-bot-description`.
- **`src/main.ts`**:
  - `setupBotSelectors()` (`:868`): drop `gameSelect` (`:870`) from the `botSelectors` array (`:873`). `#bvb-bot1-select` and `#demo-bot-select` remain, so `handleBotSelection`/`syncBotSelectors` still serve the pre-game menu selectors.
  - `updateBotDescriptions()` (`:1175`): remove `'game-bot-description'` from `bot1Ids`.
  - `updateModeUI()` (`:2267`, `:2275`): remove the `gameBotSelection` lookup and its `.hidden` toggle.
- **`src/style.css`**: remove the now-unused `.bot-selection` rules (`:105-128`) and the responsive rule at `:624`.
- No replacement selector needed on the game screen — the `#bot-status` display already shows the active bot name for Solo Bot runs.

---

## Task 4 — Arrow keys scroll the page (`src/main.ts`)

In `handleKeyPress` (`:911`), immediately after the INPUT/TEXTAREA/SELECT early-return guard (`:913-915`), add:

```ts
if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
  e.preventDefault()
}
```

This stops the browser's default scroll on Arrow keys everywhere except text fields (already exempted by the guard). WASD is unaffected because letter keys don't scroll. Placed before the game-state branches so it applies in all states.

---

## Verification

1. `npm run build` — runs `tsc`; must pass with no type errors (there is no test suite).
2. `npm run dev`, open the landing page:
   - **Preview:** snake shows a taller head with eyes and a tapered tail (not plain blocks); a corner label names the current bot; across successive deaths the board alternates between irregular Iron Snake shapes and full rectangles and the bot changes.
3. Start **New Game** (single): no "Disable Bot" button, no bot dropdown on the game screen; **Arrow keys move the snake without scrolling the page** (shrink the window height so it overflows to confirm); WASD still works; pressing `B` does nothing.
4. **Solo Bot** menu → pick a bot → Launch: bot drives the game and `#bot-status` names it. **Bot vs Bot** and **Two Player** still start and play normally.
5. Confirm a human single-player run still reaches the leaderboard prompt and a bot-assisted (Solo Bot) run does not.
