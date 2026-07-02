# Iron Snake Mode — Final-Stretch Fruit Colors

## Context

In **Iron Snake Mode**, players clear a level by reaching a cumulative point goal
(`ironSnakeGoalForLevel(L) = 5·L(L+1)/2` → 5, 15, 30, 50, 75…). Each fruit is
worth exactly **1 point**, so the "points remaining to goal" the HUD already
shows (`main.ts:1826-1830`) is identical to **fruits remaining in the level**.

Today the fruit is always red (`#ef4444`). The user wants a clear visual cue
that the level is about to end: recolor the fruit for the **last 3 fruits** of
the level, using **3 distinct colors that count down** (not one flat color, not
a blend). Chosen scheme — "Flash to white", climaxing on the final fruit:

| Fruits remaining | Color  | Triad (top / right / left faces) |
|------------------|--------|----------------------------------|
| 3                | Violet  | `#8b5cf6` / `#7c3aed` / `#6d28d9` |
| 2                | Magenta | `#ec4899` / `#db2777` / `#be185d` |
| 1 (last fruit)   | White   | `#f8fafc` / `#e2e8f0` / `#cbd5e1` |

Outside Iron Snake Mode (classic), the fruit stays red — unchanged.

## Approach

All changes are in **`src/main.ts`**. The fruit is a canvas isometric block; its
color is set by a single `drawBlock(x, y, top, right, left)` call in the
`case 'food':` branch of `draw()` (`main.ts:636-638`). We reuse the exact
pattern the codebase already uses for the hunger tint (`main.ts:609-619`): pick
the color triad from state just before the render switch.

### 1. Color constant (next to the `HUNGER_*` palette, `main.ts:37-39`)
Add a lookup keyed by fruits-remaining, matching the existing
`[string, string, string]` triad convention:

```ts
// Iron Snake "final stretch" fruit colours. The fruit is recoloured for the
// last three fruits of a level (remaining 3 → 2 → 1), flashing near-white on
// the final fruit so the level ending is unmistakable.
const IRON_SNAKE_FINAL_FRUIT_COLORS: Record<number, [string, string, string]> = {
  3: ['#8b5cf6', '#7c3aed', '#6d28d9'], // violet
  2: ['#ec4899', '#db2777', '#be185d'], // magenta
  1: ['#f8fafc', '#e2e8f0', '#cbd5e1'], // white flash (final fruit)
}
```

### 2. Extract a small `remaining` helper (reuse / DRY)
`draw()` and `updateScore()` (`main.ts:1826-1830`) both need "fruits remaining".
Add one private method and have **both** call sites use it, removing the
duplicated `combined`/`remaining` math:

```ts
// Points (== fruits, since 1 fruit = 1 pt) still needed to clear the current
// Iron Snake level. 0 outside Iron Snake Mode or once the goal is reached.
private ironSnakeRemaining(): number {
  if (!this.ironSnakeMode) return 0
  const combined = this.score + (this.isTwoSnakeMode() ? this.score2 : 0)
  return Math.max(0, this.levelGoal - combined)
}
```
Then in `updateScore()` replace the inline `combined`/`remaining` (`main.ts:1827-1828`)
with `const remaining = this.ironSnakeRemaining()`.

### 3. Recolor the fruit in `draw()`
Alongside the hunger-tint block (~`main.ts:609-619`), compute the fruit triad,
then use it in the `case 'food':` branch (`main.ts:636-638`):

```ts
// Iron Snake final-stretch cue: recolour the fruit for the last three fruits.
const remainingFruit = this.ironSnakeRemaining()
const foodColors: [string, string, string] =
  IRON_SNAKE_FINAL_FRUIT_COLORS[remainingFruit] ?? ['#ef4444', '#dc2626', '#b91c1c']
```
```ts
case 'food':
  this.drawBlock(obj.x, obj.y, foodColors[0], foodColors[1], foodColors[2])
  break
```
The `?? red` fallback covers every case except remaining ∈ {1,2,3}: classic mode
(`ironSnakeRemaining()` returns 0), and early in a level. This one insertion
point also covers the overhead view, which shares the same `case 'food':` path.

### Notes / edge cases
- **No lingering "remaining 0" fruit.** When the goal fruit is eaten, the eat
  path calls `checkLevelAdvance()` → `advanceLevel()` synchronously (raising
  `levelGoal` and re-spawning) *before* the next `draw()`, so remaining never
  sits at 0 with a fruit on screen. The `{1,2,3}`-only lookup guards it anyway.
- **Multiplayer** uses the same combined `score + score2` via the shared helper,
  so the last 3 fruits of the *shared* goal are recolored — consistent with the
  existing HUD countdown.
- **Do NOT touch** `src/menu-demo.ts` — its decorative fruit (`drawBlock(..., '#ef4444', …)`)
  has no level concept and should stay red.
- Optional: add a line to the README feature list for Iron Snake Mode noting the
  final-fruit color cue (the repo keeps `README.md` as the single source of truth).

## Critical files
- `src/main.ts` — the only code file:
  - `main.ts:37-39` — add `IRON_SNAKE_FINAL_FRUIT_COLORS` constant.
  - `main.ts:636-638` — use `foodColors` in the `case 'food':` branch.
  - `main.ts:~609-619` — compute `remainingFruit`/`foodColors` near the hunger tint.
  - `main.ts:1826-1830` — swap inline math for `ironSnakeRemaining()`; add the helper near `hungerFactor()` (`main.ts:1625`).

## Verification
1. **Build / types:** `npm run build` — confirms the `Record<number, …>` typing and edits compile.
2. **In-app** (`npm run dev`, use the `/run` skill):
   - Enable **Iron Snake Mode** on the menu, start single-player. Level 1 needs 5
     fruits — eat until **3 remaining** and confirm the fruit turns **violet**,
     then **magenta** at 2, then **white** on the last fruit. After eating the
     white one, the level advances, board regenerates, and the next fruit is red again.
   - Confirm the HUD "N pts" countdown still tracks correctly (helper refactor).
   - Toggle **overhead view** (`O`) during the final stretch — the flat fruit
     shows the same countdown colors.
   - **Two-player:** verify the last 3 fruits of the combined goal recolor.
   - **Classic mode (toggle off):** fruit stays red throughout — no regression.
