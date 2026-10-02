import type { PowerUpType } from './game-types'

// Centralised gameplay colours.
//
// Every 3D object on the board is drawn as an extruded prism whose three
// visible faces are shaded [top, right, left], lightest to darkest (see
// `drawPrism` in main.ts). So every entry here is a `Faces` triple in that
// order, and any new palette MUST keep the light-to-dark ordering or the
// isometric geometry reads as flat.
//
// Both renderers (the real game in main.ts and the menu's background demo in
// menu-demo.ts) pull from `getPalette()` rather than holding their own
// literals, so the two can no longer drift apart.
export type Faces = [string, string, string]

export interface Palette {
  /** Player 1 snake: a taller head block plus body/tail segments. */
  p1Head: Faces
  p1Body: Faces
  /** Player 2 snake (two-player and bot-vs-bot). */
  p2Head: Faces
  p2Body: Faces
  /** Normal food. */
  food: Faces
  /**
   * Iron Snake "final stretch" fruit colours, keyed by how many fruits remain
   * in the level (3 -> 2 -> 1). The last one flashes near-white so the level
   * ending is unmistakable.
   */
  finalFruit: Record<number, Faces>
  /** Palette the snake blends toward as it approaches starvation. */
  hungerHead: Faces
  hungerBody: Faces
  /** The fatal cell highlighted during the death freeze. */
  death: Faces
  /** Per-type power-up collectible colours. */
  powerUp: Record<PowerUpType, Faces>
}

// The original look: green snake, red apple, blue second player.
const DEFAULT_PALETTE: Palette = {
  p1Head: ['#4ade80', '#22c55e', '#16a34a'],
  p1Body: ['#22c55e', '#16a34a', '#15803d'],
  p2Head: ['#60a5fa', '#3b82f6', '#2563eb'],
  p2Body: ['#3b82f6', '#2563eb', '#1d4ed8'],
  food: ['#ef4444', '#dc2626', '#b91c1c'],
  finalFruit: {
    3: ['#8b5cf6', '#7c3aed', '#6d28d9'], // violet
    2: ['#ec4899', '#db2777', '#be185d'], // magenta
    1: ['#f8fafc', '#e2e8f0', '#cbd5e1'], // white flash (final fruit)
  },
  hungerHead: ['#f59e0b', '#d97706', '#b45309'], // amber
  hungerBody: ['#ef4444', '#dc2626', '#b91c1c'], // red
  death: ['#facc15', '#eab308', '#a16207'], // amber "impact"
  powerUp: {
    double: ['#fde047', '#facc15', '#ca8a04'], // gold
    slow: ['#67e8f9', '#22d3ee', '#0e7490'], // cyan
    shrink: ['#d8b4fe', '#a855f7', '#7e22ce'], // violet
  },
}

// Colour-blind-safe palette, built from the Okabe-Ito qualitative set.
//
// The default palette's core problem is that it encodes the single most
// important distinction in the game — snake vs. food — as green vs. red, which
// is precisely the pair lost under deuteranopia and protanopia, and it gives
// the two a near-identical luminance so there is no brightness fallback.
//
// This palette instead separates every gameplay-critical pair along the
// blue/orange axis (preserved under all three common dichromacies) and backs
// that up with large luminance gaps:
//
//   P1 snake   blue       vs. food  orange   — hue AND luminance separated
//   P1 blue    vs. P2 near-white             — large luminance gap, hue-free
//   food orange vs. board near-black         — large luminance gap
//
// Power-ups stay chromatically distinct but no longer have to carry the load
// alone: in colour-blind mode their ★/⏱/✂ icons are also drawn onto the
// collectible itself, so they are identifiable with no colour vision at all.
const COLOR_BLIND_PALETTE: Palette = {
  // Blue (Okabe-Ito sky blue / blue).
  p1Head: ['#8ecff5', '#56b4e9', '#1f78b4'],
  p1Body: ['#56b4e9', '#2e86c1', '#1a5f8a'],
  // Near-white. Chosen over a second hue so P1/P2 separate by luminance, which
  // survives every form of colour blindness including achromatopsia.
  p2Head: ['#ffffff', '#e2e8f0', '#94a3b8'],
  p2Body: ['#e2e8f0', '#cbd5e1', '#7c8ea3'],
  // Orange (Okabe-Ito orange / vermillion). Unmistakable against the blue P1
  // snake and far brighter than the board.
  food: ['#f5b041', '#e69f00', '#b36d00'],
  finalFruit: {
    3: ['#e79bc4', '#cc79a7', '#9c4f7c'], // reddish purple
    2: ['#f7e96b', '#f0e442', '#b8ac22'], // yellow
    1: ['#ffffff', '#f1f5f9', '#cbd5e1'], // white flash (final fruit)
  },
  // Starvation warning. Yellow head over vermillion body keeps the original
  // "hot" read without relying on the red/green channel.
  hungerHead: ['#f7e96b', '#f0e442', '#b8ac22'],
  hungerBody: ['#ef8a4c', '#d55e00', '#8f3f00'],
  // Reddish purple. Distinct from the orange food, and power-ups are hidden
  // during the death freeze so there is no clash with the Shrink collectible.
  death: ['#e79bc4', '#cc79a7', '#9c4f7c'],
  powerUp: {
    double: ['#f7e96b', '#f0e442', '#b8ac22'], // yellow
    slow: ['#e79bc4', '#cc79a7', '#9c4f7c'], // reddish purple
    shrink: ['#5fd3ae', '#009e73', '#00674c'], // bluish green
  },
}

// Glyphs stamped on the top face of collectibles in colour-blind mode, so food
// and each power-up type are identifiable by shape alone. The power-up glyphs
// deliberately match the icons already shown in the HUD, toast, and the
// controls legend, so the same symbol means the same thing everywhere.
export const FOOD_GLYPH = '◆'

let colorBlindMode = false

/** The palette the renderers should draw with right now. */
export function getPalette(): Palette {
  return colorBlindMode ? COLOR_BLIND_PALETTE : DEFAULT_PALETTE
}

export function isColorBlindMode(): boolean {
  return colorBlindMode
}

/**
 * Switch palettes. Both canvases read `getPalette()` every frame, so this takes
 * effect on the next repaint with no further plumbing — including mid-game.
 */
export function setColorBlindMode(enabled: boolean): void {
  colorBlindMode = enabled
  // Let the DOM restyle itself to match the canvas (HUD score colours, power-up
  // accents). Guarded so the module stays importable in a non-browser context.
  if (typeof document !== 'undefined') {
    document.body.classList.toggle('color-blind', enabled)
  }
}
