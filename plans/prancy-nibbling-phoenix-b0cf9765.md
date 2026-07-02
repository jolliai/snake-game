# Freeze-on-death with loss reason

## Context

Today, the instant a snake dies the game calls `endGame()` / `endGameTwoPlayer()`, which
immediately swaps to the `#game-over` DOM screen (`showScreen('game-over')`). That screen sets
`display:none` on `#game`, hiding the canvas — so the player never sees *how* they died. Worse,
the fatal head cell is never even drawn: collision is checked **before** the head is added to the
snake (`this.snake.unshift(head)`), and `draw()` isn't called on the death path at all.

This branch (`feature/lossreason`) adds a "death freeze": when any snake loses, the board stays
visible and frozen, the fatal collision is highlighted on the board, a banner names the loss
reason, and the game waits for **any key** before advancing to the normal Game Over screen.

Decisions confirmed with the user:
- **After the key press → show the existing Game Over screen** (preserves high-score name entry, Play Again, leaderboard, Menu). The freeze is a "death cam" step in front of it.
- **Convey the loss via both a highlighted collision cell AND a text banner** naming the cause.
- **Applies to all modes** — human, bot-driven single-player, and bot-vs-bot all freeze until a key.

## Approach

Do **not** rewrite `endGame` / `endGameTwoPlayer` — treat them verbatim as the "finalize" step.
Insert a new freeze phase in front of them via a stored callback, so all existing winner /
leaderboard / high-score logic is preserved exactly.

### 1. New instance fields (`src/main.ts`, beside `deathCause` at ~line 154)
- `deathReason: 'wall' | 'self' | 'opponent' | 'head-to-head' | 'starved'` — banner-facing reason. Keep the existing `deathCause: 'collision' | 'starved'` field unchanged (it still drives the Game Over title at 1815/1878 and winner nuance at 1871-1875).
- `deathCells: Array<{ x: number; y: number; who: 1 | 2 }>` — fatal head cell(s) to render (empty for starvation).
- `awaitingDeathAck: boolean` — true during the freeze.
- `pendingFinalize: (() => void) | null` — the deferred Game Over action.

Reset all four in `startNewGame` next to `this.deathCause = 'collision'` (~line 1104), and call `hideDeathBanner()` beside the pause-hide (~line 1110), so a restart never leaves a stuck banner or stale alarm cell.

### 2. New method `beginDeathFreeze(finalize: () => void)` (near the end-game fns, before line 1801)
1. `isGameOver = true`; `awaitingDeathAck = true`; `pendingFinalize = finalize`.
2. `stopAutoRotate()` and clear the loop (`if (this.gameLoop) { clearInterval(this.gameLoop); this.gameLoop = null }`) — same lines `endGame` runs at 1803-1807 (idempotent when `endGame` re-runs them at finalize).
3. Hide `#starvation-warning` so it doesn't overlap the banner.
4. `this.draw()` — renders the frozen board + death cell(s).
5. `this.showDeathBanner()`.

### 3. Wire the four death sites to freeze instead of finalizing directly
- **Single collision (1161-1164):** `deathReason = this.inBounds(head) ? 'self' : 'wall'`; `deathCells = [{x:head.x, y:head.y, who:1}]`; `beginDeathFreeze(() => this.endGame())`. (`head` is the pre-`unshift` fatal cell; `this.snake[0]` is still the last valid cell — needed for the wall clamp.)
- **Single starvation (1183-1187):** set `deathCause='starved'`, `deathReason='starved'`, `deathCells=[]`; `beginDeathFreeze(() => this.endGame())`.
- **Two-player collision (1231-1234):** push `head1` (who:1) if `p1Dead`, `head2` (who:2) if `p2Dead`. Derive `deathReason` from the already-computed booleans (1217-1226): `headToHead ? 'head-to-head' : (p1HitsWall||p2HitsWall) ? 'wall' : (p1HitsSelf||p2HitsSelf) ? 'self' : 'opponent'`. Compute per-snake reasons `r1`/`r2` for the banner text. `beginDeathFreeze(() => this.endGameTwoPlayer(p1Dead, p2Dead))`.
- **Two-player starvation (1275-1279):** set `deathCause='starved'`, `deathReason='starved'`, `deathCells=[]`; `beginDeathFreeze(() => this.endGameTwoPlayer(p1Starved, p2Starved))`.

### 4. Render the death cells in `draw()` (append after the object-draw loop, after line 628)
Only when `awaitingDeathAck`. For each cell, use an alarm palette clearly distinct from food-red `#ef4444` (e.g. white/gold top, crimson sides). Draw **after** the main painter-sorted loop so the alarm block paints on top of any coincident body/opponent segment (self/opponent/head-to-head deaths overlap an existing segment).

Bounds handling — branch on the **grid rectangle** (`x<0 || x>=gridSize || y<0 || y>=gridSize`), not `inBounds`:
- **Off the grid rectangle (classic wall death):** the true cell projects mostly off-canvas (canvas is sized to grid + 20px padding only, `updateCanvasSize` 249-253) and clips. Fallback: draw the alarm block at the snake's current head (`snake[0]`/`snake2[0]`, still the last valid cell), **and** also at the true OOB coord so a sliver pokes past the border as an "off the edge" cue.
- **Within the grid rectangle (self / opponent / head-to-head, or an Iron Snake masked-interior void cell):** projects on-canvas; draw directly. This correctly shows Iron Snake deaths where the head entered the interior void.

Starvation (`deathCells=[]`) → this block is a no-op; the freeze just shows the last live frame + banner. Death cells re-read on every `draw()`, so the highlight persists across resize / rotate (q/e) / overhead (o) / perspective (`[` `]`) redraws automatically.

### 5. Banner DOM + CSS (mirror the `starvation-warning` pattern)
- `index.html` — add `<div id="death-banner" class="death-banner hidden" role="alert"></div>` inside `.canvas-wrap`, as a sibling after `#starvation-warning` (line 97). Overlays the canvas without shifting layout; no `showScreen` needed (same trick as `togglePause`).
- `src/style.css` — add `.death-banner` modeled on `.starvation-warning` (184-206) but centered (`top:50%; transform:translate(-50%,-50%)`), larger, alarm-red, `pointer-events:none`, with its own pulse keyframe.
- Two methods near `updateStarvationWarning` (~1750): `showDeathBanner()` builds text from `deathReason` (+ per-snake `r1`/`r2` for two-player) and appends " — Press any key", then unhides; `hideDeathBanner()` re-hides. Suggested copy: wall→"Hit the wall!", self→"Ran into itself!", opponent→"Crashed into the other snake!", head-to-head→"Head-on collision!", starved→"Starved!". Two-player composes with P1/P2 labels.

### 6. Acknowledgement branch in `handleKeyPress` (very top, after the INPUT/TEXTAREA/SELECT guard at 752, **before** the `Enter` branch at 754)
```
if (this.awaitingDeathAck) {
  if (e.repeat || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
  e.preventDefault()
  this.awaitingDeathAck = false
  this.hideDeathBanner()
  const finalize = this.pendingFinalize
  this.pendingFinalize = null
  finalize?.()
  return
}
```
Ordering is the crux: this fires before the `Enter`/`r`/`Escape` branches, so during the freeze the first key *dismisses to Game Over* (not restart/menu). After `finalize()` runs the original end-game fn → `showScreen('game-over')`, `awaitingDeathAck` is false and normal Game Over key handling (Enter/r restart) resumes unchanged. Ignoring `e.repeat` + bare modifiers prevents a stray/held key from skipping the freeze instantly. **Any key dismisses** (view keys q/e/o included) — matches "until a key is pressed"; simplest behavior.

## Files to modify
- `src/main.ts` — new fields (~154) + resets (~1104, ~1110); `beginDeathFreeze` + `showDeathBanner`/`hideDeathBanner` (~1750/1800); the four death sites (1161, 1183, 1231, 1275); death-cell rendering in `draw()` (after 628); ack branch in `handleKeyPress` (after 752).
- `index.html` — add `#death-banner` inside `.canvas-wrap` (after line 97).
- `src/style.css` — add `.death-banner` + pulse keyframe (model on 184-206).

## Notes / minor behavior changes
- Because `endGame`/`endGameTwoPlayer` run at ack-time (not the death instant), `saveHighScore`, `maybePromptForEntry`, and the bvb `addEntry` calls fire when the key is pressed. Nothing depends on them firing earlier. Only edge: closing the tab *during* the freeze skips recording — acceptable; not worth pre-saving.
- Iron Snake, overhead view, and both-snakes-die-same-tick (draw / head-to-head) are all handled by the render/bounds logic above.

## Verification (run the app end-to-end)
1. `npm run dev` and open the app.
2. **Single, wall:** steer the snake into a wall. Confirm the board freezes, the head cell is highlighted at/over the edge, banner reads "Hit the wall! — Press any key". Press a key → Game Over screen appears with correct score.
3. **Single, self:** grow the snake and run into its body. Confirm the fatal cell highlights *on top of* the body segment, banner reads "Ran into itself!".
4. **Starvation:** wait without eating until starvation. Confirm freeze shows the final frame (no separate highlight) and banner reads "Starved!".
5. **Restart path:** during a freeze, press a key → Game Over; press `R`/Enter → new game starts cleanly (no leftover banner or alarm cell). Start another game and die again to confirm no stale state.
6. **Two-player (pvp):** trigger opponent-crash, self-crash, and a head-on collision; confirm both fatal heads highlight (head-on overlaps), banner text names each player's fate, winner/draw resolves correctly on the Game Over screen.
7. **Bot-vs-bot:** confirm it also freezes and waits for a key (all-modes behavior).
8. **View robustness:** while frozen, before dismissing, resize the window and toggle overhead (note: any key press dismisses, so test resize/DOM redraws rather than view keys) — confirm the highlighted death cell persists. Test in both isometric and overhead views, and on an Iron Snake board (masked interior).
9. `npm run build` — confirm `tsc` passes with the new union type and fields.
