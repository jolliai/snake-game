# JOE-7 — Rainbow Snake Surprise

## Context

Linear issue **JOE-7** (Snake Game Project, Backlog) asks for a rare "surprise": on
roughly 1 in 100 games the snake should render **rainbow-colored**, and when it does,
a banner reading **"Rainbow Snake"** (in rainbow colors) should appear. (Notion had no
related feature; the ticket is the sole source.)

The goal is a delightful, low-frequency easter egg — it must not change normal gameplay,
must persist for the whole game once rolled, and should be visibly animated (per Joe's
recorded preference for visible, gameplay-paced motion — and **not** gated behind
`prefers-reduced-motion`).

The game is a single class `SnakeGame` in `src/main.ts`, rendering an isometric
Canvas 2D scene; all UI text is DOM/CSS (`index.html` + `src/style.css`). There is no
existing rainbow/gradient/HSL styling — this is net-new.

### Chosen defaults
- **Snake look:** animated hue shimmer sweeping along the body.
- **Banner:** styled after the **Mortal Kombat "FRIENDSHIP!" finisher** — a cheerful
  rainbow arc behind chunky, all-caps arcade text that pops/bounces in, flashes, then
  auto-dismisses (~3s). The deliberately wholesome, celebratory tone is the point.

## Implementation

All code lives in `src/main.ts`, `index.html`, `src/style.css`. Reuse existing patterns
throughout — the `.death-banner` overlay, the per-face color-tuple render helpers, and
`Math.random()` (the codebase's only RNG).

### 1. Per-game roll (the "1 in 100")
- Add constant near the other tuning constants (`src/main.ts:35-52`):
  `const RAINBOW_CHANCE = 0.01`.
- Add per-game state field alongside the others (~`src/main.ts:89-140`):
  `private rainbowSnake = false`.
- Add a **test/verification seam** read once in the constructor:
  `private rainbowOverride: boolean | null` = parse `?rainbow` from `location.search`
  (`'1'` → true, `'0'` → false, else `null`). Lets Playwright and manual testing force
  the effect deterministically instead of waiting on a 1% roll.
- In `startNewGame()` (`src/main.ts:1223`), after the state reset block, set:
  `this.rainbowSnake = this.rainbowOverride ?? (Math.random() < RAINBOW_CHANCE)`.
- **Scope:** applies to player 1's snake only. In two-snake modes P2 stays blue so player
  identity is preserved (P2 head/body tuples at `src/main.ts:771-772` are untouched).

### 2. Rainbow rendering in `draw()` (`src/main.ts:703-807`)
- The `objects` array (pushed at `:719-721`) currently carries only `{x, y, type}`. Add
  optional `index?: number` and `len?: number` and populate them for the **snake1**
  segments so the switch can compute a per-segment hue.
- Add a small helper (module scope or private method):
  `rainbowFaces(index, len, phase): [string, string, string]` →
  `h = ((index / len) * 360 + phase) % 360`, returning three HSL face shades that match
  the existing isometric shading (top lightest → left darkest), e.g.
  `hsl(h,90%,62%)` / `hsl(h,90%,50%)` / `hsl(h,90%,40%)`. HSL strings are valid
  `ctx.fillStyle` values, so no hex conversion is needed (unlike `lerpHex`, which is
  hex-only — that's why we don't reuse it here).
- Compute an animation `phase` once at the top of `draw()` when `this.rainbowSnake`:
  `const phase = performance.now() / 1000 * HUE_SWEEP_DEG_PER_SEC` (e.g. ~60°/s).
  `draw()` is already called every frame by the continuous board auto-rotation rAF loop
  (`autoRotateStep`, `src/main.ts:646/698`), so the shimmer animates for free.
- In the render switch (`src/main.ts:780-799`), for the `head` / `body` / `tail` cases:
  when `this.rainbowSnake`, pass `rainbowFaces(obj.index, obj.len, phase)` into
  `drawSnakeHead` / `drawBlock` / `drawSnakeTail` instead of the fixed `head1` / `body1`
  tuples. Otherwise keep the current behavior unchanged.
- **Hunger tint interaction:** rainbow supersedes the green→warning `tint()` blend
  (`src/main.ts:766-772`) for the body colors. The pulsing starvation text banner
  (`updateStarvationWarning`, `src/main.ts:2222`) still fires, so the starvation cue isn't
  lost — just carried by the banner rather than the body tint during a rainbow game.

### 3. "Rainbow Snake" banner — Mortal Kombat "FRIENDSHIP!" style
Reuse the `.death-banner` overlay *mechanics* (absolute-positioned in `.canvas-wrap`,
toggled via `hidden`), but style it as the classic MK friendship reveal. Text stays
**"Rainbow Snake"** per the ticket, rendered in caps arcade style.

- **HTML** (`index.html`, inside `.canvas-wrap` next to `#death-banner`, line ~93) — a
  wrapper so the rainbow arc can sit *behind* the text:
  ```html
  <div id="rainbow-banner" class="rainbow-banner hidden" role="status">
    <div class="rainbow-arc" aria-hidden="true"></div>
    <div class="rainbow-text">Rainbow Snake</div>
  </div>
  ```
- **CSS** (`src/style.css`):
  - `.rainbow-banner` — position/size mirroring `.death-banner` (`:202-225`), centered near
    top of the board, `pointer-events: none`, and a **pop-in bounce** on reveal:
    `animation: friendship-pop .5s cubic-bezier(.2,1.4,.4,1);`
    `@keyframes friendship-pop { from { transform: translateX(-50%) scale(.5); opacity:0 } ... to { scale(1) } }`.
  - `.rainbow-arc` — the iconic semicircular rainbow. Draw concentric bands with a bottom-
    anchored `radial-gradient` and clip to the top half (`overflow:hidden` container at half
    height, circle center at its bottom edge): rings of red→orange→yellow→green→blue→
    indigo→violet, transparent between center and the innermost band. Sits behind the text.
  - `.rainbow-text` — chunky arcade look: `text-transform: uppercase`,
    `font-weight: 900`, generous `letter-spacing`, bright yellow fill (`#ffe600`) with a
    thick dark **outline built from layered `text-shadow`s** (the arcade edge), plus a
    `friendship-flash` blink (`animation: friendship-flash .4s steps(2) 3`) so it flickers
    like the MK caption before settling.
  - Add an `opacity` transition for the ~3s auto-dismiss fade.
- **Logic** (`src/main.ts`, model on `showDeathBanner`/`hideDeathBanner` at `:2247-2255`):
  - `showRainbowBanner()`: `remove('hidden')`, then `window.setTimeout(() => hide, 3000)`
    (store the timer id in a field, e.g. `rainbowBannerTimer`).
  - `hideRainbowBanner()`: `add('hidden')` and `clearTimeout` the stored timer.
  - Call from `startNewGame()`: `this.rainbowSnake ? showRainbowBanner() : hideRainbowBanner()`
    (at the end, once the game screen is shown). Also call `hideRainbowBanner()` in the
    reset / game-over / back-to-menu paths so a stale banner never lingers.
- **Optional (default OFF):** an MK-style announcer sting. There's no audio system in the
  project, so this would be a tiny WebAudio-generated jingle. Left out unless you want it —
  easy to add later.

### 4. E2E test
- Add a Playwright spec (matching the existing harness under the tests dir) that loads the
  app with `?rainbow=1`, starts a game, and asserts `#rainbow-banner` is visible with text
  `Rainbow Snake`, then that it auto-hides after ~3s; and a `?rainbow=0` case asserting the
  banner stays hidden. (Canvas pixel colors aren't asserted — the DOM banner + forced flag
  are the reliable observable.)

## Files to modify
- `src/main.ts` — roll + state field + query-param seam, `draw()` per-segment rainbow,
  banner show/hide methods.
- `index.html` — `#rainbow-banner` element.
- `src/style.css` — `.rainbow-banner` + `@keyframes rainbow-shift`.
- `tests/` — new Playwright spec.

## Verification
- `npm run dev`, open `http://localhost:5173/?rainbow=1`, start a game → snake renders as an
  animated rainbow and the "Rainbow Snake" banner reveals then fades (~3s). Open with
  `?rainbow=0` → normal green snake, no banner. Confirm two-player mode keeps P2 blue.
- `npm run build` (runs `tsc` — must typecheck clean).
- `npm test` (Playwright) — existing suite still green + the new rainbow spec passes.
