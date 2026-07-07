import './style.css'
import { AVAILABLE_BOTS, DEFAULT_BOT_ID, getBotById } from './bots'
import type { BotHelpers, BotState, SnakeBot } from './bots/bot-types'
import { applyLoopGuard, createLoopMemory, resetLoopMemory, type LoopMemory } from './bots/loop-guard'
import { DIRECTIONS, DIRECTION_VECTORS, OPPOSITE_DIRECTIONS, type Direction, type Position } from './game-types'
import {
  addEntry,
  getLeaderboard,
  clearLeaderboard,
  qualifies,
  sanitizeName,
  MODE_LABELS
} from './leaderboard'
import type { LeaderboardEntry, LeaderboardMode, GameResult } from './leaderboard'
import { MenuDemo } from './menu-demo'
import { generateIronSnakeBoard, growIronSnakeBoard, ironSnakeGridSizeForArea } from './iron-snake'

type GameMode = 'single' | 'pvp' | 'bvb'

const ISO_MIN_WIDTH = 300
const ISO_MAX_WIDTH = 1200

// Iron Snake Mode tuning.
const IRON_SNAKE_MIN_SIZE = 12 // bounding box floor so shapes have room to be interesting
const IRON_SNAKE_MIN_SPEED = 60 // fastest the loop interval ramps to (ms)
// The snake keeps its (cumulative) length across levels, so the board must grow
// with the goal or a long snake eventually fills a fixed board. This is the
// snake's target share of the playable area at the moment a level's goal is
// reached; the per-level board area is sized to hit it (lower => roomier).
const IRON_SNAKE_GOAL_FILL = 0.4
// Level-to-level board morph (Iron Snake). The playable region reshapes in
// discrete steps — each held for roughly one snake-move — so the arena visibly
// "grows" a step at a time from the old board into the new one, rather than
// jumping in a single frame. Bigger reshapes get more (capped) steps.
const LEVEL_MORPH_MIN_STEPS = 3
const LEVEL_MORPH_MAX_STEPS = 7
const LEVEL_MORPH_CELLS_PER_STEP = 6 // aim for ~this many cells revealed per step
const LEVEL_MORPH_MIN_STEP_MS = 130 // step-hold floor so fast late levels still show it

// Starvation: a snake that goes too long without eating dies, so a bot that can
// never reach walled-off food (or is hopelessly stuck) eventually loses instead
// of forcing a watcher to stop the game. The limit resets on every food, so a
// competent snake on a reachable board never approaches it — it's a backstop.
// It scales with playable board area (bigger board => food can be legitimately
// farther away). The snake tints toward a warning colour past WARN_FRACTION so
// the eventual death reads as "starved", not as a glitch.
const STARVATION_FLOOR = 100 // never starve in fewer than this many moves
const STARVATION_AREA_FACTOR = 2 // moves-without-food budget per playable cell
const STARVATION_WARN_FRACTION = 0.6 // hunger tint begins at this fraction of the limit
// Warning palette the snake blends toward as it starves (top / right / left faces).
const HUNGER_HEAD_COLORS: [string, string, string] = ['#f59e0b', '#d97706', '#b45309']
const HUNGER_BODY_COLORS: [string, string, string] = ['#ef4444', '#dc2626', '#b91c1c']
// Cumulative point goal to clear a level: 5, 15, 30, 50, 75, ... Each level
// requires more points than the last (deltas 5, 10, 15, 20, ...).
const ironSnakeGoalForLevel = (level: number): number => (5 * level * (level + 1)) / 2
// Iron Snake "final stretch" fruit colours. The fruit is recoloured for the
// last three fruits of a level (remaining 3 -> 2 -> 1), flashing near-white on
// the final fruit so the level ending is unmistakable.
const IRON_SNAKE_FINAL_FRUIT_COLORS: Record<number, [string, string, string]> = {
  3: ['#8b5cf6', '#7c3aed', '#6d28d9'], // violet
  2: ['#ec4899', '#db2777', '#be185d'], // magenta
  1: ['#f8fafc', '#e2e8f0', '#cbd5e1'], // white flash (final fruit)
}

// Rainbow Snake surprise (JOE-7): on a rare game the P1 snake renders as an
// animated rainbow and a Mortal Kombat "FRIENDSHIP!"-style banner flashes.
const RAINBOW_CHANCE = 0.01 // ~1 in 100 games
const RAINBOW_HUE_SWEEP_DEG_PER_SEC = 60 // how fast the body's rainbow scrolls
const RAINBOW_BANNER_MS = 3000 // banner hold before it fades out
const RAINBOW_BANNER_FADE_MS = 600 // opacity fade duration (matches the CSS transition)

// ?rainbow=1 forces the surprise on, ?rainbow=0 forces it off (deterministic
// testing / manual verification); anything else leaves it to the random roll.
function parseRainbowOverride(): boolean | null {
  const p = new URLSearchParams(window.location.search).get('rainbow')
  if (p === '1' || p === 'true') return true
  if (p === '0' || p === 'false') return false
  return null
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => {
    switch (ch) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&#39;'
    }
  })
}

class SnakeGame {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D

  // Game mode
  private gameMode: GameMode = 'single'

  // Player 1 state
  private snake: Position[] = []
  private snakeSet: Set<string> = new Set()
  private direction: Direction = 'RIGHT'
  private nextDirection: Direction = 'RIGHT'
  private score: number = 0

  // Player 2 state
  private snake2: Position[] = []
  private snakeSet2: Set<string> = new Set()
  private direction2: Direction = 'LEFT'
  private nextDirection2: Direction = 'LEFT'
  private score2: number = 0

  // Shared game state
  private food: Position = { x: 0, y: 0 }
  private gridSize: number = 10
  private initialGridSize: number = 10
  // Iron Snake Mode: when enabled, the board is carved into an irregular shape.
  // `boardMask` is a flat gridSize*gridSize array (1 = playable, 0 = wall);
  // null means the classic full rectangle. `boardArea` is the playable-cell
  // count (capacity metric); `levelGoal` is the cumulative score to advance.
  private ironSnakeMode: boolean = false
  private boardMask: Uint8Array | null = null
  private boardArea: number = 100
  private levelGoal: number = 0
  private level: number = 1
  private gameSpeed: number = 200
  private baseSpeed: number = 200
  private gameLoop: number | null = null
  private isPaused: boolean = false
  private isGameOver: boolean = false
  private gameStarted: boolean = false

  // Bot state (P1 / single player)
  private botEnabled: boolean = false
  // True if the bot was active at any point in the current single-player run.
  // Disqualifies the run from prompting for a leaderboard name.
  private botEverActive: boolean = false
  private selectedBotId: string = DEFAULT_BOT_ID
  private activeBot: SnakeBot = getBotById(DEFAULT_BOT_ID) ?? AVAILABLE_BOTS[0]
  private botSelectors: HTMLSelectElement[] = []
  // Anti-loop memory: detects and breaks bot oscillation cycles (see loop-guard).
  private botLoopMemory: LoopMemory = createLoopMemory()

  // Bot state (P2)
  private selectedBotId2: string = AVAILABLE_BOTS.length > 1 ? AVAILABLE_BOTS[1].id : DEFAULT_BOT_ID
  private activeBot2: SnakeBot = AVAILABLE_BOTS.length > 1 ? AVAILABLE_BOTS[1] : (getBotById(DEFAULT_BOT_ID) ?? AVAILABLE_BOTS[0])
  private botSelectors2: HTMLSelectElement[] = []
  private botLoopMemory2: LoopMemory = createLoopMemory()

  // Isometric rendering
  private isoAngle: number = Math.PI / 3 // z-rotation: 30° (45° = standard diamond)
  private perspectiveRatio: number = 0.5  // vertical squash for top-down tilt
  private basisXx: number = 0
  private basisXy: number = 0
  private basisYx: number = 0
  private basisYy: number = 0
  private baseBlockHeight: number = 0
  private perspectiveStrength: number = 0.4
  private focalLength: number = Infinity
  private rawMaxY: number = 0
  private rawCenterX: number = 0
  private isoOriginX: number = 0
  private isoOriginY: number = 0
  private isoCache: { x: number; y: number }[][] = []

  // Overhead (top-down) view toggle. When active, the board is rendered flat
  // and axis-aligned; the prior isometric settings are saved for restoration.
  private overheadView: boolean = false
  private savedIsoAngle: number = 0
  private savedPerspectiveRatio: number = 0
  private savedPerspectiveStrength: number = 0

  // Stats tracking (for leaderboards)
  private gameStartTime: number = 0
  private maxLength1: number = 1
  private maxLength2: number = 1

  // Starvation tracking: moves each snake has taken since it last ate. Resets to
  // 0 on eating / new game / reposition. Reaching starvationLimit() kills that
  // snake. deathCause tells the game-over screen why the last death happened.
  private movesSinceFood1: number = 0
  private movesSinceFood2: number = 0
  private deathCause: 'collision' | 'starved' = 'collision'

  // Death freeze: on any loss the board stays visible and frozen, the fatal
  // collision is highlighted, and a banner names the reason until any key is
  // pressed — then the deferred game-over finalize runs. deathMessage is the
  // banner text (composed at the death site, which has full per-snake context);
  // deathCells are the fatal head cell(s) to highlight (empty for starvation,
  // where the head is already part of the snake); awaitingDeathAck gates the
  // freeze; pendingFinalize is the deferred endGame/endGameTwoPlayer call.
  private deathMessage: string = ''
  private deathCells: Array<{ x: number; y: number; who: 1 | 2 }> = []
  private awaitingDeathAck: boolean = false
  private pendingFinalize: (() => void) | null = null

  // Leaderboard UI
  private leaderboardActiveMode: LeaderboardMode = 'single'
  private pendingEntry: { mode: LeaderboardMode; entry: LeaderboardEntry } | null = null

  // Auto-rotation
  private autoRotating: boolean = false
  private autoRotateRafId: number | null = null
  private autoRotateLastTime: number = 0
  private autoRotateSpeed: number = 0.15 // radians per second
  private autoRotatePausedUntil: number = 0 // timestamp when manual override expires
  private autoRotatePaused: boolean = false // user-toggled pause (T key)

  // Level transition (Iron Snake board morph). While a morph runs the logic loop
  // is torn down and `boardMask` is temporarily driven by the morph frames.
  private isTransitioning: boolean = false
  private transitionRafId: number | null = null
  private transitionStartTime: number = 0
  // Per-morph state, populated by startLevelMorph and consumed by morphStep.
  private morphWork: Uint8Array | null = null // reused display buffer fed to draw()
  private morphTargetReal: Uint8Array | null = null // real new mask to restore on finish
  private morphChanged: number[] = [] // flat indices that differ start->target, wave-ordered
  private morphTargetDisplay: Uint8Array | null = null // target values at those indices
  private morphRevealed: number = 0 // how many of morphChanged already applied
  private morphSteps: number = 0 // number of discrete reshape steps for this morph
  private morphStepMs: number = 0 // real time each step is held (≈ one snake move)
  private morphLastReveal: number = 0 // last revealed count actually drawn

  // Menu demo (small rotating snake on the start screen)
  private menuDemo: MenuDemo | null = null

  // Rainbow Snake surprise (JOE-7). Rolled once per game in startNewGame and held
  // for the whole run; rainbowOverride (from ?rainbow=1|0) forces it for testing.
  // rainbowBannerTimer drives the friendship banner's flash-then-fade auto-dismiss.
  private rainbowSnake: boolean = false
  private rainbowOverride: boolean | null = parseRainbowOverride()
  private rainbowBannerTimer: number | null = null

  constructor() {
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement
    this.ctx = this.canvas.getContext('2d')!
    this.updateCanvasSize()
    this.loadHighScore()
    this.setupEventListeners()
    this.updateBotUI()
    this.initMenuDemo()
    window.addEventListener('resize', () => { this.updateCanvasSize(); this.draw() })
  }

  private initMenuDemo() {
    const demoCanvas = document.getElementById('menu-demo-canvas') as HTMLCanvasElement | null
    if (!demoCanvas) return
    this.menuDemo = new MenuDemo(demoCanvas)
    // Menu is the initial screen — start the demo right away.
    this.menuDemo.start()
  }

  private isTwoSnakeMode(): boolean {
    return this.gameMode === 'pvp' || this.gameMode === 'bvb'
  }

  // === Isometric Rendering ===

  private getIsoWidth(): number {
    // Leave room for page padding (2rem = 32px each side) and canvas border (3px each side)
    const available = window.innerWidth - 70
    return Math.max(ISO_MIN_WIDTH, Math.min(available, ISO_MAX_WIDTH))
  }

  private toIso(gridX: number, gridY: number): { x: number; y: number } {
    const rawX = gridX * this.basisXx + gridY * this.basisYx
    const rawY = gridX * this.basisXy + gridY * this.basisYy
    const d = this.rawMaxY - rawY
    const scale = this.focalLength === Infinity ? 1 : this.focalLength / (this.focalLength + d)
    return {
      x: (this.rawCenterX + (rawX - this.rawCenterX) * scale) + this.isoOriginX,
      y: (this.rawMaxY - d * scale) + this.isoOriginY
    }
  }

  private updateCanvasSize() {
    const cosA = Math.cos(this.isoAngle)
    const sinA = Math.sin(this.isoAngle)
    const pr = this.perspectiveRatio

    // Scale so the grid fits within the viewport-derived width at any rotation angle
    const isoWidth = this.getIsoWidth()
    const scale = isoWidth / (this.gridSize * Math.SQRT2)

    this.basisXx = cosA * scale
    this.basisXy = sinA * scale * pr
    this.basisYx = -sinA * scale
    this.basisYy = cosA * scale * pr

    // Rotation-invariant block height: use fixed scale * pr * sqrt(2) instead of
    // angle-dependent (basisXy + basisYy) so blocks stay the same height at all angles.
    // In overhead view blocks are flattened to squares (no extruded height).
    this.baseBlockHeight = this.overheadView ? 0 : scale * pr * Math.SQRT2 * 0.6

    // Compute raw iso corner positions (before perspective and origin offset)
    const N = this.gridSize
    const rawCorners = [
      { x: 0, y: 0 },
      { x: N * this.basisXx, y: N * this.basisXy },
      { x: N * this.basisYx, y: N * this.basisYy },
      { x: N * (this.basisXx + this.basisYx), y: N * (this.basisXy + this.basisYy) }
    ]

    this.rawMaxY = Math.max(...rawCorners.map(c => c.y))
    const rawMinY = Math.min(...rawCorners.map(c => c.y))
    this.rawCenterX = (Math.min(...rawCorners.map(c => c.x)) + Math.max(...rawCorners.map(c => c.x))) / 2

    const depthRange = Math.max(this.rawMaxY - rawMinY, 0.001)
    this.focalLength = this.perspectiveStrength > 0 ? depthRange / this.perspectiveStrength : Infinity

    // Fixed canvas size: max possible extent at any rotation angle
    const padding = 20
    const canvasInnerW = isoWidth
    const canvasInnerH = isoWidth * pr
    this.canvas.width = canvasInnerW + padding * 2
    this.canvas.height = canvasInnerH + padding * 2 + this.baseBlockHeight

    // Anchor grid center to canvas center so rotation pivots smoothly
    const half = this.gridSize / 2
    const gcRawX = half * (this.basisXx + this.basisYx)
    const gcRawY = half * (this.basisXy + this.basisYy)
    const gcD = this.rawMaxY - gcRawY
    const gcS = this.focalLength === Infinity ? 1 : this.focalLength / (this.focalLength + gcD)
    const gcProjX = this.rawCenterX + (gcRawX - this.rawCenterX) * gcS
    const gcProjY = this.rawMaxY - gcD * gcS

    this.isoOriginX = this.canvas.width / 2 - gcProjX
    this.isoOriginY = this.canvas.height / 2 - gcProjY

    // Build isoCache[gy][gx] for grid intersection points
    this.isoCache = []
    for (let gy = 0; gy <= this.gridSize; gy++) {
      this.isoCache[gy] = []
      for (let gx = 0; gx <= this.gridSize; gx++) {
        this.isoCache[gy][gx] = this.toIso(gx, gy)
      }
    }
  }

  private drawGroundPlane() {
    const ctx = this.ctx
    const lightPath = new Path2D()
    const darkPath = new Path2D()

    for (let gy = 0; gy < this.gridSize; gy++) {
      for (let gx = 0; gx < this.gridSize; gx++) {
        // Skip off-board cells so the void shows the dark background.
        if (this.boardMask !== null && this.boardMask[gy * this.gridSize + gx] !== 1) continue

        const top = this.isoCache[gy][gx]
        const right = this.isoCache[gy][gx + 1]
        const bottom = this.isoCache[gy + 1][gx + 1]
        const left = this.isoCache[gy + 1][gx]

        const path = (gx + gy) % 2 === 0 ? lightPath : darkPath
        path.moveTo(top.x, top.y)
        path.lineTo(right.x, right.y)
        path.lineTo(bottom.x, bottom.y)
        path.lineTo(left.x, left.y)
        path.closePath()
      }
    }

    ctx.fillStyle = '#2a2a2a'
    ctx.fill(lightPath)
    ctx.fillStyle = '#222222'
    ctx.fill(darkPath)
  }

  private drawGridLines() {
    // Skip grid lines when tiles are too small
    const tileScreenWidth = Math.abs(this.basisXx) + Math.abs(this.basisYx)
    if (tileScreenWidth < 5) return

    const ctx = this.ctx
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
    ctx.lineWidth = 0.5

    if (this.boardMask === null) {
      // Full-span lines (classic rectangle).
      for (let gy = 0; gy <= this.gridSize; gy++) {
        const start = this.isoCache[gy][0]
        const end = this.isoCache[gy][this.gridSize]
        ctx.moveTo(start.x, start.y)
        ctx.lineTo(end.x, end.y)
      }
      for (let gx = 0; gx <= this.gridSize; gx++) {
        const start = this.isoCache[0][gx]
        const end = this.isoCache[this.gridSize][gx]
        ctx.moveTo(start.x, start.y)
        ctx.lineTo(end.x, end.y)
      }
    } else {
      // Per-cell edges: draw each lattice edge once if it borders an on-board cell.
      for (let gy = 0; gy <= this.gridSize; gy++) {
        for (let gx = 0; gx < this.gridSize; gx++) {
          // Horizontal edge between rows gy-1 and gy.
          if (this.onBoard(gx, gy - 1) || this.onBoard(gx, gy)) {
            const a = this.isoCache[gy][gx]
            const b = this.isoCache[gy][gx + 1]
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
          }
        }
      }
      for (let gx = 0; gx <= this.gridSize; gx++) {
        for (let gy = 0; gy < this.gridSize; gy++) {
          // Vertical edge between columns gx-1 and gx.
          if (this.onBoard(gx - 1, gy) || this.onBoard(gx, gy)) {
            const a = this.isoCache[gy][gx]
            const b = this.isoCache[gy + 1][gx]
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
          }
        }
      }
    }

    ctx.stroke()
  }

  private drawGroundBorder() {
    const ctx = this.ctx
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.lineWidth = 2

    if (this.boardMask === null) {
      const topCorner = this.isoCache[0][0]
      const rightCorner = this.isoCache[0][this.gridSize]
      const bottomCorner = this.isoCache[this.gridSize][this.gridSize]
      const leftCorner = this.isoCache[this.gridSize][0]

      ctx.beginPath()
      ctx.moveTo(topCorner.x, topCorner.y)
      ctx.lineTo(rightCorner.x, rightCorner.y)
      ctx.lineTo(bottomCorner.x, bottomCorner.y)
      ctx.lineTo(leftCorner.x, leftCorner.y)
      ctx.closePath()
      ctx.stroke()
      return
    }

    // Trace the true outline: stroke every side of an on-board cell whose
    // neighbour across that side is off-board (includes interior holes).
    ctx.beginPath()
    for (let gy = 0; gy < this.gridSize; gy++) {
      for (let gx = 0; gx < this.gridSize; gx++) {
        if (!this.onBoard(gx, gy)) continue
        if (!this.onBoard(gx, gy - 1)) {
          const a = this.isoCache[gy][gx]
          const b = this.isoCache[gy][gx + 1]
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
        }
        if (!this.onBoard(gx, gy + 1)) {
          const a = this.isoCache[gy + 1][gx]
          const b = this.isoCache[gy + 1][gx + 1]
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
        }
        if (!this.onBoard(gx - 1, gy)) {
          const a = this.isoCache[gy][gx]
          const b = this.isoCache[gy + 1][gx]
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
        }
        if (!this.onBoard(gx + 1, gy)) {
          const a = this.isoCache[gy][gx + 1]
          const b = this.isoCache[gy + 1][gx + 1]
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
        }
      }
    }
    ctx.stroke()
  }

  private getBlockHeight(gx: number, gy: number): number {
    if (this.focalLength === Infinity) return this.baseBlockHeight
    const centerRawY = (gx + 0.5) * this.basisXy + (gy + 0.5) * this.basisYy
    const d = this.rawMaxY - centerRawY
    const scale = this.focalLength / (this.focalLength + d)
    return this.baseBlockHeight * scale
  }

  private drawBlockShadow(gx: number, gy: number) {
    const inset = 0.05
    const top = this.toIso(gx + inset, gy + inset)
    const right = this.toIso(gx + 1 - inset, gy + inset)
    const bottom = this.toIso(gx + 1 - inset, gy + 1 - inset)
    const left = this.toIso(gx + inset, gy + 1 - inset)

    const ctx = this.ctx
    ctx.beginPath()
    ctx.moveTo(top.x, top.y)
    ctx.lineTo(right.x, right.y)
    ctx.lineTo(bottom.x, bottom.y)
    ctx.lineTo(left.x, left.y)
    ctx.closePath()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
    ctx.fill()
  }

  private drawBlock(gx: number, gy: number, topColor: string, rightColor: string, leftColor: string, heightScale: number = 1) {
    const inset = 0.05
    const bh = this.getBlockHeight(gx, gy) * heightScale
    // Corners clockwise: TL, TR, BR, BL
    const c = [
      this.toIso(gx + inset, gy + inset),
      this.toIso(gx + 1 - inset, gy + inset),
      this.toIso(gx + 1 - inset, gy + 1 - inset),
      this.toIso(gx + inset, gy + 1 - inset)
    ]
    this.drawPrism(c, bh, topColor, rightColor, leftColor)
  }

  // Draw an extruded prism from 4 clockwise ground corners (already projected to
  // iso screen space) raised by `bh`: back side faces first, then front side
  // faces (so they paint over), then the top. Shared by drawBlock and the
  // tapered tail so both shade identically.
  private drawPrism(c: { x: number; y: number }[], bh: number, topColor: string, rightColor: string, leftColor: string) {
    const ctx = this.ctx

    // 4 side faces defined by clockwise edges; classify as front or back
    // Outward normal Y = a.x - b.x; visible (front) when > 0
    const backFaces: number[] = []
    const frontFaces: number[] = []
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4]
      if (a.x > b.x) frontFaces.push(i)
      else if (a.x < b.x) backFaces.push(i)
    }

    // Draw back faces first so front faces paint over them
    for (const i of backFaces) {
      const a = c[i], b = c[(i + 1) % 4]
      ctx.beginPath()
      ctx.moveTo(a.x, a.y - bh)
      ctx.lineTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.lineTo(b.x, b.y - bh)
      ctx.closePath()
      ctx.fillStyle = leftColor
      ctx.fill()
    }

    // Draw front faces; use outward normal X to pick light/dark shading
    for (const i of frontFaces) {
      const a = c[i], b = c[(i + 1) % 4]
      const normalX = b.y - a.y
      ctx.beginPath()
      ctx.moveTo(a.x, a.y - bh)
      ctx.lineTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.lineTo(b.x, b.y - bh)
      ctx.closePath()
      ctx.fillStyle = normalX > 0 ? rightColor : leftColor
      ctx.fill()
    }

    // Top face
    ctx.beginPath()
    ctx.moveTo(c[0].x, c[0].y - bh)
    ctx.lineTo(c[1].x, c[1].y - bh)
    ctx.lineTo(c[2].x, c[2].y - bh)
    ctx.lineTo(c[3].x, c[3].y - bh)
    ctx.closePath()
    ctx.fillStyle = topColor
    ctx.fill()
  }

  // The head stands taller than the body so it reads at a glance.
  private static readonly HEAD_HEIGHT_SCALE = 1.6

  // Draw a snake head: a taller block with two eyes on the leading (travel-
  // direction) vertical face, so the head clearly looks where it's going. When
  // that face points away from the camera (or in the flat overhead view) it
  // isn't visible, so no eyes are drawn — the snake just shows its back.
  private drawSnakeHead(gx: number, gy: number, colors: [string, string, string], dir: Direction) {
    const hs = this.overheadView ? 1 : SnakeGame.HEAD_HEIGHT_SCALE
    this.drawBlock(gx, gy, colors[0], colors[1], colors[2], hs)

    const bh = this.getBlockHeight(gx, gy) * hs
    if (bh <= 0) return // flat overhead view: no vertical face to hold eyes

    const inset = 0.05
    // Ground-plane corners, matching drawBlock (TL, TR, BR, BL clockwise).
    const c = [
      this.toIso(gx + inset, gy + inset),
      this.toIso(gx + 1 - inset, gy + inset),
      this.toIso(gx + 1 - inset, gy + 1 - inset),
      this.toIso(gx + inset, gy + 1 - inset)
    ]

    // The leading face is the grid edge whose outward normal is the travel
    // direction: UP=c0->c1, RIGHT=c1->c2, DOWN=c2->c3, LEFT=c3->c0. Skip it when
    // it faces away from the camera (same front-face test as drawBlock).
    const EDGE: Record<Direction, number> = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 }
    const a = c[EDGE[dir]], b = c[(EDGE[dir] + 1) % 4]
    if (a.x <= b.x) return // leading face hidden — show no eyes

    const ctx = this.ctx
    const eyeR = Math.hypot(c[2].x - c[0].x, c[2].y - c[0].y) * 0.1
    const h = 0.6 // eye height up the face
    for (const t of [0.3, 0.7]) {
      const ex = a.x + (b.x - a.x) * t
      const ey = a.y + (b.y - a.y) * t - bh * h
      ctx.beginPath()
      ctx.ellipse(ex, ey, eyeR, eyeR, 0, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(ex, ey + eyeR * 0.28, eyeR * 0.5, eyeR * 0.5, 0, 0, Math.PI * 2)
      ctx.fillStyle = '#0f172a'
      ctx.fill()
    }
  }

  // The tail is a bit shorter than the body so it reads as tapering off.
  private static readonly TAIL_HEIGHT_SCALE = 0.7

  // Direction the tail points: from the second-to-last segment toward the last.
  private tailDirection(snake: Position[]): Direction {
    const t = snake[snake.length - 1], p = snake[snake.length - 2]
    return this.vectorToDirection({ x: t.x - p.x, y: t.y - p.y })
  }

  // Draw the tail: a block that is full-width where it meets the body and
  // narrows to a small tip in `awayDir` (the way the tail points), shorter than
  // a body block, so the snake tapers to a point instead of ending in a stub.
  private drawSnakeTail(gx: number, gy: number, colors: [string, string, string], awayDir: Direction) {
    const bh = this.getBlockHeight(gx, gy) * SnakeGame.TAIL_HEIGHT_SCALE
    const f = DIRECTION_VECTORS[awayDir]
    const p = { x: -f.y, y: f.x } // lateral
    const cx = gx + 0.5, cy = gy + 0.5
    const body = 0.45  // half-length to the full-width body edge (matches inset)
    const tip = 0.45   // half-length to the tip edge
    const halfBody = 0.45
    const halfTip = 0.12 // narrow tip
    const corners = [
      { x: cx - f.x * body + p.x * halfBody, y: cy - f.y * body + p.y * halfBody },
      { x: cx - f.x * body - p.x * halfBody, y: cy - f.y * body - p.y * halfBody },
      { x: cx + f.x * tip - p.x * halfTip, y: cy + f.y * tip - p.y * halfTip },
      { x: cx + f.x * tip + p.x * halfTip, y: cy + f.y * tip + p.y * halfTip }
    ]
    // Keep clockwise winding (positive shoelace in grid space) so drawPrism's
    // front/back face test matches drawBlock for any tail direction.
    let area = 0
    for (let i = 0; i < 4; i++) { const a = corners[i], b = corners[(i + 1) % 4]; area += a.x * b.y - b.x * a.y }
    if (area < 0) corners.reverse()
    this.drawPrism(corners.map(g => this.toIso(g.x, g.y)), bh, colors[0], colors[1], colors[2])
  }

  // === Auto-rotation ===

  private startAutoRotate() {
    if (this.autoRotating) return
    this.autoRotating = true
    this.autoRotateLastTime = 0
    this.autoRotateRafId = requestAnimationFrame(t => this.autoRotateStep(t))
  }

  private stopAutoRotate() {
    this.autoRotating = false
    if (this.autoRotateRafId !== null) {
      cancelAnimationFrame(this.autoRotateRafId)
      this.autoRotateRafId = null
    }
  }

  private toggleAutoRotatePause() {
    if (!this.autoRotating) return
    this.autoRotatePaused = !this.autoRotatePaused
  }

  // === Overhead view ===

  private toggleOverheadView() {
    this.overheadView = !this.overheadView
    if (this.overheadView) {
      // Save the current isometric settings, then switch to a flat top-down view.
      this.savedIsoAngle = this.isoAngle
      this.savedPerspectiveRatio = this.perspectiveRatio
      this.savedPerspectiveStrength = this.perspectiveStrength
      this.isoAngle = 0
      this.perspectiveRatio = 1
      this.perspectiveStrength = 0
    } else {
      // Restore the previously saved isometric settings.
      this.isoAngle = this.savedIsoAngle
      this.perspectiveRatio = this.savedPerspectiveRatio
      this.perspectiveStrength = this.savedPerspectiveStrength
    }
    this.updateCanvasSize()
    this.draw()
  }

  private autoRotateStep(timestamp: number) {
    if (!this.autoRotating) return

    // Keep rotating through a level morph — the transition shouldn't disturb the
    // camera. autoRotateStep reads the same boardMask the morph is updating, so it
    // renders the in-progress reshape at the current angle without conflict.
    if (!this.autoRotatePaused && !this.overheadView && this.autoRotateLastTime > 0 && timestamp > this.autoRotatePausedUntil) {
      const dt = (timestamp - this.autoRotateLastTime) / 1000
      this.isoAngle += this.autoRotateSpeed * dt
      this.updateCanvasSize()
      this.draw()
    }

    this.autoRotateLastTime = timestamp
    this.autoRotateRafId = requestAnimationFrame(t => this.autoRotateStep(t))
  }

  // === Main draw ===

  // Three isometric face shades (top / right / left) for one Rainbow Snake
  // segment. Hue = the segment's fraction along the body (index/len) plus a
  // time-based phase so the rainbow scrolls; lightness steps down per face to
  // match the existing 3D block shading (top lightest, left darkest).
  private rainbowFaces(index: number, len: number, phaseDeg: number): [string, string, string] {
    const h = (((index / Math.max(1, len)) * 360) + phaseDeg) % 360
    return [`hsl(${h}, 90%, 62%)`, `hsl(${h}, 90%, 50%)`, `hsl(${h}, 90%, 40%)`]
  }

  private draw() {
    const ctx = this.ctx
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

    this.drawGroundPlane()
    this.drawGridLines()
    this.drawGroundBorder()

    // Collect all objects to render
    type DrawType = 'head' | 'body' | 'tail' | 'food' | 'head2' | 'body2' | 'tail2' | 'death'
    // seg/segLen carry the P1 segment's position along its body so the Rainbow
    // Snake surprise can colour each segment by a hue derived from its index.
    const objects: { x: number; y: number; type: DrawType; seg?: number; segLen?: number }[] = []

    const segType = (index: number, len: number): DrawType =>
      index === 0 ? 'head' : index === len - 1 ? 'tail' : 'body'

    this.snake.forEach((segment, index) => {
      objects.push({ x: segment.x, y: segment.y, type: segType(index, this.snake.length), seg: index, segLen: this.snake.length })
    })

    if (this.isTwoSnakeMode()) {
      this.snake2.forEach((segment, index) => {
        const t = segType(index, this.snake2.length)
        objects.push({ x: segment.x, y: segment.y, type: t === 'head' ? 'head2' : t === 'tail' ? 'tail2' : 'body2' })
      })
    }

    objects.push({ x: this.food.x, y: this.food.y, type: 'food' })

    // Death freeze: the fatal cell(s) are drawn in the amber "impact" palette,
    // added to the object list so they respect painter's depth order (a segment
    // in front of the fatal cell correctly occludes it) rather than floating on
    // top. Off-grid classic wall deaths are anchored on the head cell here and
    // the out-of-bounds sliver is drawn separately afterwards. Stable sort keeps
    // a death marker after the segment sharing its cell, so it paints over it.
    if (this.awaitingDeathAck) {
      for (const dc of this.deathCells) {
        const offGrid = dc.x < 0 || dc.x >= this.gridSize || dc.y < 0 || dc.y >= this.gridSize
        if (offGrid) {
          const head = dc.who === 1 ? this.snake[0] : this.snake2[0]
          if (head) objects.push({ x: head.x, y: head.y, type: 'death' })
        } else {
          objects.push({ x: dc.x, y: dc.y, type: 'death' })
        }
      }
    }

    // Sort back-to-front (painter's algorithm): lower projected Y drawn first.
    // Array.prototype.sort is stable, so equal-depth ties keep insertion order
    // (death markers, pushed last, stay above the segment in the same cell).
    objects.sort((a, b) =>
      (a.x * this.basisXy + a.y * this.basisYy) - (b.x * this.basisXy + b.y * this.basisYy)
    )

    // Draw shadows first
    for (const obj of objects) {
      this.drawBlockShadow(obj.x, obj.y)
    }

    // Hunger tint: blend each snake's colours toward the warning palette as it
    // nears starvation, so the impending death is legible rather than abrupt.
    const f1 = this.hungerFactor(this.movesSinceFood1)
    const f2 = this.isTwoSnakeMode() ? this.hungerFactor(this.movesSinceFood2) : 0
    const tint = (base: [string, string, string], warn: [string, string, string], f: number): [string, string, string] =>
      f <= 0 ? base : [this.lerpHex(base[0], warn[0], f), this.lerpHex(base[1], warn[1], f), this.lerpHex(base[2], warn[2], f)]

    const head1 = tint(['#4ade80', '#22c55e', '#16a34a'], HUNGER_HEAD_COLORS, f1)
    const body1 = tint(['#22c55e', '#16a34a', '#15803d'], HUNGER_BODY_COLORS, f1)

    // Rainbow Snake surprise: colour each P1 segment by a hue that runs along the
    // body and scrolls over time (animated by the existing per-frame redraw).
    // Supersedes the P1 hunger tint; the starvation text banner still warns.
    const rainbowPhase = this.rainbowSnake ? (performance.now() / 1000) * RAINBOW_HUE_SWEEP_DEG_PER_SEC : 0
    const p1Faces = (obj: { seg?: number; segLen?: number }): [string, string, string] =>
      this.rainbowFaces(obj.seg ?? 0, obj.segLen ?? 1, rainbowPhase)
    const head2 = tint(['#60a5fa', '#3b82f6', '#2563eb'], HUNGER_HEAD_COLORS, f2)
    const body2 = tint(['#3b82f6', '#2563eb', '#1d4ed8'], HUNGER_BODY_COLORS, f2)

    // Iron Snake final-stretch cue: recolour the fruit for the last three fruits.
    const remainingFruit = this.ironSnakeRemaining()
    const foodColors: [string, string, string] =
      IRON_SNAKE_FINAL_FRUIT_COLORS[remainingFruit] ?? ['#ef4444', '#dc2626', '#b91c1c']

    // Draw blocks
    for (const obj of objects) {
      switch (obj.type) {
        case 'head':
          this.drawSnakeHead(obj.x, obj.y, this.rainbowSnake ? p1Faces(obj) : head1, this.direction)
          break
        case 'body': {
          const c = this.rainbowSnake ? p1Faces(obj) : body1
          this.drawBlock(obj.x, obj.y, c[0], c[1], c[2])
          break
        }
        case 'tail':
          this.drawSnakeTail(obj.x, obj.y, this.rainbowSnake ? p1Faces(obj) : body1, this.tailDirection(this.snake))
          break
        case 'head2':
          this.drawSnakeHead(obj.x, obj.y, head2, this.direction2)
          break
        case 'body2':
          this.drawBlock(obj.x, obj.y, body2[0], body2[1], body2[2])
          break
        case 'tail2':
          this.drawSnakeTail(obj.x, obj.y, body2, this.tailDirection(this.snake2))
          break
        case 'food':
          this.drawBlock(obj.x, obj.y, foodColors[0], foodColors[1], foodColors[2])
          break
        case 'death':
          this.drawBlock(obj.x, obj.y, '#facc15', '#eab308', '#a16207')
          break
      }
    }

    // Classic wall death: the true fatal cell is off-grid and projects mostly
    // off-canvas, so draw a sliver at the out-of-bounds coord on top so a bit
    // pokes past the border (the on-grid anchor marker was depth-sorted above).
    if (this.awaitingDeathAck) {
      for (const dc of this.deathCells) {
        const offGrid = dc.x < 0 || dc.x >= this.gridSize || dc.y < 0 || dc.y >= this.gridSize
        if (offGrid) this.drawBlock(dc.x, dc.y, '#facc15', '#eab308', '#a16207')
      }
    }
  }

  // === Event handling ===

  private setupEventListeners() {
    document.addEventListener('keydown', this.handleKeyPress.bind(this))
    this.setupBotSelectors()
    const ironSnakeToggle = document.getElementById('iron-snake-toggle') as HTMLInputElement | null
    if (ironSnakeToggle) {
      ironSnakeToggle.addEventListener('change', () => {
        this.ironSnakeMode = ironSnakeToggle.checked
      })
    }
    document.getElementById('new-game')!.addEventListener('click', () => this.startNewGame('single'))
    document.getElementById('two-player')!.addEventListener('click', () => this.startNewGame('pvp'))
    document.getElementById('bot-vs-bot')!.addEventListener('click', () => {
      this.closeAllExpandPanels()
      this.setExpandPanel('bot-vs-bot', 'bvb-panel', true)
    })
    document.getElementById('bvb-cancel')!.addEventListener('click', () => {
      this.setExpandPanel('bot-vs-bot', 'bvb-panel', false)
    })
    document.getElementById('bvb-launch')!.addEventListener('click', () => {
      this.setExpandPanel('bot-vs-bot', 'bvb-panel', false)
      this.startNewGame('bvb')
    })
    document.getElementById('start-demo')!.addEventListener('click', () => {
      this.closeAllExpandPanels()
      this.setExpandPanel('start-demo', 'demo-panel', true)
    })
    document.getElementById('demo-cancel')!.addEventListener('click', () => {
      this.setExpandPanel('start-demo', 'demo-panel', false)
    })
    document.getElementById('demo-launch')!.addEventListener('click', () => {
      this.setExpandPanel('start-demo', 'demo-panel', false)
      this.botEnabled = true
      this.startNewGame('single')
    })
    document.getElementById('play-again')!.addEventListener('click', () => this.startNewGame())
    document.getElementById('back-to-menu')!.addEventListener('click', () => {
      if (this.gameLoop) clearInterval(this.gameLoop)
      this.gameLoop = null
      this.cancelLevelMorph()
      this.stopAutoRotate()
      this.botEnabled = false
      this.updateBotUI()
      this.showScreen('menu')
    })

    document.getElementById('open-leaderboards')!.addEventListener('click', () => {
      this.openLeaderboards(this.leaderboardActiveMode)
    })
    document.getElementById('leaderboards-back')!.addEventListener('click', () => {
      this.showScreen('menu')
    })
    document.getElementById('clear-leaderboard')!.addEventListener('click', () => {
      if (confirm(`Clear the ${MODE_LABELS[this.leaderboardActiveMode]} leaderboard?`)) {
        clearLeaderboard(this.leaderboardActiveMode)
        this.renderLeaderboardTable(this.leaderboardActiveMode)
      }
    })
    for (const tab of document.querySelectorAll<HTMLButtonElement>('.lb-tab')) {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.mode as LeaderboardMode | undefined
        if (mode) this.openLeaderboards(mode)
      })
    }
    document.getElementById('view-leaderboard')!.addEventListener('click', () => {
      this.openLeaderboards(this.gameMode)
    })
    document.getElementById('leaderboard-name-form')!.addEventListener('submit', e => {
      e.preventDefault()
      this.submitPendingEntry()
    })
  }

  private setupBotSelectors() {
    // Bot 1 selectors (BvB expand panel, Demo expand panel) — chosen pre-game only.
    const bvbBot1Select = document.getElementById('bvb-bot1-select') as HTMLSelectElement | null
    const demoBotSelect = document.getElementById('demo-bot-select') as HTMLSelectElement | null
    this.botSelectors = [bvbBot1Select, demoBotSelect].filter((select): select is HTMLSelectElement => select !== null)

    for (const select of this.botSelectors) {
      select.innerHTML = ''
      for (const bot of AVAILABLE_BOTS) {
        const option = document.createElement('option')
        option.value = bot.id
        option.textContent = bot.name
        select.appendChild(option)
      }
      select.addEventListener('change', event => {
        const target = event.target as HTMLSelectElement
        this.handleBotSelection(target.value)
      })
    }

    // Bot 2 selector (BvB expand panel)
    const bvbBot2Select = document.getElementById('bvb-bot2-select') as HTMLSelectElement | null
    this.botSelectors2 = [bvbBot2Select].filter((select): select is HTMLSelectElement => select !== null)

    for (const select of this.botSelectors2) {
      select.innerHTML = ''
      for (const bot of AVAILABLE_BOTS) {
        const option = document.createElement('option')
        option.value = bot.id
        option.textContent = bot.name
        select.appendChild(option)
      }
      select.addEventListener('change', event => {
        const target = event.target as HTMLSelectElement
        this.handleBotSelection2(target.value)
      })
    }

    this.syncBotSelectors()
    this.updateBotDescriptions()
  }

  private handleKeyPress(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
      return
    }

    // Arrow keys otherwise scroll the page when it overflows the viewport; the
    // game uses them for movement, so suppress the browser default. (WASD needs
    // no such guard.) Text fields are already exempted by the guard above.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
    }

    // Death freeze: any key dismisses the frozen board and runs the deferred
    // game-over finalize. Must sit above the Enter/r/Escape branches so the first
    // post-death key acknowledges the freeze rather than restarting/exiting.
    // Exception: the camera controls (rotate q/e, auto-rotate toggle t, overhead
    // o, perspective [ ]) fall through to their normal handlers so the player can
    // inspect the collision from any angle without ending the freeze. Ignore
    // auto-repeat and bare modifiers so a held/stray key doesn't skip it.
    if (this.awaitingDeathAck) {
      if (e.repeat || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
      const cameraKeys = ['q', 'Q', 'e', 'E', 't', 'T', 'o', 'O', '[', ']']
      if (!cameraKeys.includes(e.key)) {
        e.preventDefault()
        this.awaitingDeathAck = false
        this.hideDeathBanner()
        const finalize = this.pendingFinalize
        this.pendingFinalize = null
        finalize?.()
        return
      }
      // Camera key: fall through to the view handlers below; freeze stays active.
    }

    if (e.key === 'Enter') {
      if (!this.gameStarted || this.isGameOver) {
        this.startNewGame()
        return
      }
    }

    if (e.key === 'r' || e.key === 'R') {
      this.startNewGame()
      return
    }

    if (e.key === 'Escape') {
      if (!document.getElementById('menu')!.classList.contains('hidden')) return
      if (this.gameLoop) clearInterval(this.gameLoop)
      this.gameLoop = null
      this.cancelLevelMorph()
      this.stopAutoRotate()
      this.botEnabled = false
      this.updateBotUI()
      this.showScreen('menu')
      return
    }

    if (e.key === 'p' || e.key === 'P') {
      if (!this.isGameOver && this.gameLoop !== null) {
        this.togglePause()
      }
      return
    }

    if ((e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') &&
      !this.gameStarted && !this.isGameOver && !this.isTwoSnakeMode() &&
      !document.getElementById('game')!.classList.contains('hidden')) {
      if (e.key === '+' || e.key === '=') {
        this.initialGridSize = Math.min(this.initialGridSize + 5, 50)
      } else {
        this.initialGridSize = Math.max(this.initialGridSize - 5, 5)
      }
      this.gridSize = this.ironSnakeMode
        ? this.ironSnakeGridSizeForLevel(1)
        : this.initialGridSize
      this.regenerateIronSnakeBoard()
      this.updateCanvasSize()
      const placed = this.boardMask !== null && this.repositionSnakes()
      if (!placed) {
        if (this.boardMask !== null) {
          this.boardMask = null
          this.boardArea = this.gridSize * this.gridSize
        }
        const center = Math.floor(this.gridSize / 2)
        this.snake = [{ x: center, y: center }]
        this.snakeSet = new Set([`${center},${center}`])
      }
      this.levelGoal = this.ironSnakeMode ? ironSnakeGoalForLevel(1) : 0
      this.spawnFood()
      this.updateUI()
      this.draw()
      return
    }

    if (e.key === 'o' || e.key === 'O') {
      this.toggleOverheadView()
      return
    }

    if (e.key === 'q' || e.key === 'Q') {
      if (this.overheadView) return  // perspective is fixed in overhead view
      this.isoAngle -= Math.PI / 36  // rotate clockwise by 5°
      this.autoRotatePausedUntil = performance.now() + 3000
      this.updateCanvasSize()
      this.draw()
      return
    }

    if (e.key === 'e' || e.key === 'E') {
      if (this.overheadView) return  // perspective is fixed in overhead view
      this.isoAngle += Math.PI / 36  // rotate counter-clockwise by 5°
      this.autoRotatePausedUntil = performance.now() + 3000
      this.updateCanvasSize()
      this.draw()
      return
    }

    if (e.key === 't' || e.key === 'T') {
      this.toggleAutoRotatePause()
      return
    }

    if (e.key === '[') {
      if (this.overheadView) return  // perspective is fixed in overhead view
      this.perspectiveStrength = Math.max(this.perspectiveStrength - 0.05, 0)
      this.updateCanvasSize()
      this.draw()
      return
    }

    if (e.key === ']') {
      if (this.overheadView) return  // perspective is fixed in overhead view
      this.perspectiveStrength = Math.min(this.perspectiveStrength + 0.05, 0.8)
      this.updateCanvasSize()
      this.draw()
      return
    }

    if (this.isPaused || this.isGameOver) return

    if (this.isTwoSnakeMode()) {
      // P1: WASD only
      const p1KeyMap: Record<string, Direction> = {
        'w': 'UP', 'W': 'UP',
        'a': 'LEFT', 'A': 'LEFT',
        's': 'DOWN', 'S': 'DOWN',
        'd': 'RIGHT', 'D': 'RIGHT'
      }
      const p1Dir = p1KeyMap[e.key]
      if (p1Dir && this.gameMode === 'pvp' && this.isValidDirection(p1Dir, this.direction)) {
        this.nextDirection = p1Dir
      }

      // P2: Arrow keys only
      const p2KeyMap: Record<string, Direction> = {
        'ArrowUp': 'UP',
        'ArrowDown': 'DOWN',
        'ArrowLeft': 'LEFT',
        'ArrowRight': 'RIGHT'
      }
      const p2Dir = p2KeyMap[e.key]
      if (p2Dir && this.gameMode === 'pvp' && this.isValidDirection(p2Dir, this.direction2)) {
        this.nextDirection2 = p2Dir
      }
    } else {
      // Single player: both WASD and arrows control the snake
      const keyMap: Record<string, Direction> = {
        'ArrowUp': 'UP',
        'ArrowDown': 'DOWN',
        'ArrowLeft': 'LEFT',
        'ArrowRight': 'RIGHT',
        'w': 'UP',
        'W': 'UP',
        'a': 'LEFT',
        'A': 'LEFT',
        's': 'DOWN',
        'S': 'DOWN',
        'd': 'RIGHT',
        'D': 'RIGHT'
      }

      const newDirection = keyMap[e.key]
      if (newDirection) {
        if (this.botEnabled) return

        if (this.isValidDirection(newDirection, this.direction)) {
          this.nextDirection = newDirection

          // Start the game on first directional input
          if (!this.gameStarted) {
            this.gameStarted = true
            this.gameStartTime = performance.now()
            this.gameLoop = window.setInterval(() => this.update(), this.gameSpeed)
          }
        }
      }
    }
  }

  private isValidDirection(newDirection: Direction, currentDirection: Direction): boolean {
    return OPPOSITE_DIRECTIONS[currentDirection] !== newDirection
  }

  private togglePause() {
    this.isPaused = !this.isPaused
    const pauseScreen = document.getElementById('pause')!
    if (this.isPaused) {
      pauseScreen.classList.remove('hidden')
    } else {
      pauseScreen.classList.add('hidden')
    }
  }

  // === Bot selection ===

  private handleBotSelection(botId: string) {
    const selected = getBotById(botId)
    if (!selected) return

    this.selectedBotId = selected.id
    this.activeBot = selected
    this.syncBotSelectors()
    this.updateBotDescriptions()
    this.updateBotUI()
  }

  private handleBotSelection2(botId: string) {
    const selected = getBotById(botId)
    if (!selected) return

    this.selectedBotId2 = selected.id
    this.activeBot2 = selected
    this.syncBotSelectors()
    this.updateBotDescriptions()
  }

  private syncBotSelectors() {
    for (const select of this.botSelectors) {
      select.value = this.selectedBotId
    }
    for (const select of this.botSelectors2) {
      select.value = this.selectedBotId2
    }
  }

  private updateBotDescriptions() {
    const bot1Ids = ['bvb-bot1-description', 'demo-bot-description']
    for (const id of bot1Ids) {
      const el = document.getElementById(id)
      if (el) el.textContent = this.activeBot.description
    }
    const el2 = document.getElementById('bvb-bot2-description')
    if (el2) el2.textContent = this.activeBot2.description
  }

  private setExpandPanel(buttonId: string, panelId: string, open: boolean) {
    const button = document.getElementById(buttonId)!
    const panel = document.getElementById(panelId)!
    button.classList.toggle('hidden', open)
    panel.classList.toggle('hidden', !open)
  }

  private closeAllExpandPanels() {
    this.setExpandPanel('bot-vs-bot', 'bvb-panel', false)
    this.setExpandPanel('start-demo', 'demo-panel', false)
  }

  private updateBotUI() {
    const status = document.getElementById('bot-status')
    if (!status) return

    status.textContent = this.botEnabled ? `ON (${this.activeBot.name})` : `OFF (${this.activeBot.name})`
    status.classList.toggle('on', this.botEnabled)
    status.classList.toggle('off', !this.botEnabled)
  }

  // === Game loop ===

  private startLoopIfNeeded() {
    if (this.gameLoop !== null) return
    this.gameStarted = true
    if (this.gameStartTime === 0) this.gameStartTime = performance.now()
    this.gameLoop = window.setInterval(() => this.update(), this.gameSpeed)
  }

  startNewGame(mode?: GameMode) {
    // Abandon any in-flight board morph; this game sets up its own board below.
    this.cancelLevelMorph()

    if (mode !== undefined) this.gameMode = mode

    // Reset bot flag for two-snake modes
    if (this.isTwoSnakeMode()) {
      this.botEnabled = false
    }
    this.botEverActive = this.botEnabled

    // Roll the rare Rainbow Snake surprise (JOE-7) once per game; it holds for
    // the whole run. rainbowOverride (from ?rainbow=…) wins so tests are stable.
    this.rainbowSnake = this.rainbowOverride ?? (Math.random() < RAINBOW_CHANCE)

    // Iron Snake Mode uses a larger bounding box (so shapes have room) and carves
    // an irregular mask; classic mode keeps the full rectangle (mask = null).
    this.gridSize = this.ironSnakeMode
      ? this.ironSnakeGridSizeForLevel(1)
      : this.initialGridSize
    this.regenerateIronSnakeBoard()
    this.updateCanvasSize()

    this.score = 0
    this.score2 = 0
    if (!this.isTwoSnakeMode()) {
      this.snake2 = []
      this.snakeSet2 = new Set()
    }

    // On an Iron Snake board, seat snakes on valid cells with room to move; if that
    // fails (or in classic mode) use the fixed center/quarter positions.
    const boardPlaced = this.boardMask !== null && this.repositionSnakes()
    if (!boardPlaced) {
      if (this.boardMask !== null) {
        this.boardMask = null
        this.boardArea = this.gridSize * this.gridSize
      }
      if (this.isTwoSnakeMode()) {
        // Place snakes on opposite sides
        const quarter = Math.floor(this.gridSize / 4)
        const center = Math.floor(this.gridSize / 2)
        const p2x = this.gridSize - 1 - quarter

        // P1: left side, facing right
        this.snake = [{ x: quarter, y: center }]
        this.snakeSet = new Set([`${quarter},${center}`])
        this.direction = 'RIGHT'
        this.nextDirection = 'RIGHT'

        // P2: right side, facing left
        this.snake2 = [{ x: p2x, y: center }]
        this.snakeSet2 = new Set([`${p2x},${center}`])
        this.direction2 = 'LEFT'
        this.nextDirection2 = 'LEFT'
      } else {
        const center = Math.floor(this.gridSize / 2)
        this.snake = [{ x: center, y: center }]
        this.snakeSet = new Set([`${center},${center}`])
        this.direction = 'RIGHT'
        this.nextDirection = 'RIGHT'
      }
    }

    this.level = 1
    this.levelGoal = this.ironSnakeMode ? ironSnakeGoalForLevel(1) : 0
    this.baseSpeed = 200
    this.gameSpeed = this.baseSpeed
    this.isPaused = false
    this.isGameOver = false
    this.gameStarted = false
    this.gameStartTime = 0
    this.maxLength1 = this.snake.length
    this.maxLength2 = this.snake2.length
    this.pendingEntry = null
    this.movesSinceFood1 = 0
    this.movesSinceFood2 = 0
    this.deathCause = 'collision'
    this.deathMessage = ''
    this.deathCells = []
    this.awaitingDeathAck = false
    this.pendingFinalize = null
    resetLoopMemory(this.botLoopMemory)
    resetLoopMemory(this.botLoopMemory2)
    this.spawnFood()
    this.updateUI()
    this.showScreen('game')
    document.getElementById('pause')!.classList.add('hidden')
    this.hideDeathBanner()
    if (this.rainbowSnake) this.showRainbowBanner()
    else this.hideRainbowBanner()

    if (this.gameLoop) clearInterval(this.gameLoop)
    this.gameLoop = null

    this.updateModeUI()
    this.updateBotUI()

    // Two-snake modes and bot demos start the loop immediately
    if (this.isTwoSnakeMode() || this.botEnabled) {
      this.startLoopIfNeeded()
    }

    if (this.gameMode === 'bvb' || (this.gameMode === 'single' && this.botEnabled)) {
      this.startAutoRotate()
    } else {
      this.stopAutoRotate()
    }

    // Draw initial state
    this.draw()
  }

  private update() {
    if (this.isPaused || this.isGameOver) return

    if (this.isTwoSnakeMode()) {
      this.updateTwoPlayer()
    } else {
      this.updateSinglePlayer()
    }
  }

  private updateSinglePlayer() {
    if (this.botEnabled) {
      const botDirection = this.chooseBotDirection()
      if (botDirection) {
        this.nextDirection = botDirection
      }
    }

    this.direction = this.nextDirection
    const head = { ...this.snake[0] }

    switch (this.direction) {
      case 'UP': head.y--; break
      case 'DOWN': head.y++; break
      case 'LEFT': head.x--; break
      case 'RIGHT': head.x++; break
    }

    if (this.checkCollision(head)) {
      // A head inside the grid but off-board fell into an interior hole; fully
      // off-grid is the outer wall; otherwise it collided with its own body.
      const insideGrid = head.x >= 0 && head.x < this.gridSize && head.y >= 0 && head.y < this.gridSize
      this.deathMessage = !insideGrid
        ? 'Hit the wall!'
        : !this.inBounds(head)
          ? 'Fell into a hole!'
          : 'Ran into itself!'
      this.deathCells = [{ x: head.x, y: head.y, who: 1 }]
      this.beginDeathFreeze(() => this.endGame())
      return
    }

    this.snake.unshift(head)
    this.snakeSet.add(`${head.x},${head.y}`)

    if (head.x === this.food.x && head.y === this.food.y) {
      this.score++
      this.movesSinceFood1 = 0
      resetLoopMemory(this.botLoopMemory)
      this.spawnFood()
      this.checkGridExpansion()
    } else {
      this.movesSinceFood1++
      const tail = this.snake.pop()!
      this.snakeSet.delete(`${tail.x},${tail.y}`)
    }

    if (this.snake.length > this.maxLength1) this.maxLength1 = this.snake.length

    if (this.movesSinceFood1 >= this.starvationLimit()) {
      this.deathCause = 'starved'
      this.deathMessage = 'Starved!'
      this.deathCells = []
      this.beginDeathFreeze(() => this.endGame())
      return
    }

    // A level-advance this tick starts a board morph and owns painting; skip the
    // normal repaint so it doesn't overwrite the morph's first frame.
    if (!this.isTransitioning) this.draw()
    this.updateUI()
  }

  private updateTwoPlayer() {
    // Get bot directions for BvB mode
    if (this.gameMode === 'bvb') {
      const dir1 = this.chooseBotDirectionForPlayer(1)
      if (dir1) this.nextDirection = dir1
      const dir2 = this.chooseBotDirectionForPlayer(2)
      if (dir2) this.nextDirection2 = dir2
    }

    this.direction = this.nextDirection
    this.direction2 = this.nextDirection2

    // Calculate new heads
    const head1 = { ...this.snake[0] }
    const vec1 = DIRECTION_VECTORS[this.direction]
    head1.x += vec1.x
    head1.y += vec1.y

    const head2 = { ...this.snake2[0] }
    const vec2 = DIRECTION_VECTORS[this.direction2]
    head2.x += vec2.x
    head2.y += vec2.y

    // Check collisions for each snake. "Off-board" covers both the outer wall
    // and an interior hole; an in-grid off-board cell is a hole (see describe).
    const inGrid = (h: Position) => h.x >= 0 && h.x < this.gridSize && h.y >= 0 && h.y < this.gridSize
    const p1OffBoard = !this.inBounds(head1)
    const p1InGrid = inGrid(head1)
    const p1HitsSelf = this.snakeSet.has(`${head1.x},${head1.y}`)
    const p1HitsP2 = this.snakeSet2.has(`${head1.x},${head1.y}`)

    const p2OffBoard = !this.inBounds(head2)
    const p2InGrid = inGrid(head2)
    const p2HitsSelf = this.snakeSet2.has(`${head2.x},${head2.y}`)
    const p2HitsP1 = this.snakeSet.has(`${head2.x},${head2.y}`)

    // Head-to-head collision
    const headToHead = head1.x === head2.x && head1.y === head2.y

    const p1Dead = p1OffBoard || p1HitsSelf || p1HitsP2 || headToHead
    const p2Dead = p2OffBoard || p2HitsSelf || p2HitsP1 || headToHead

    if (p1Dead || p2Dead) {
      this.deathCells = []
      if (p1Dead) this.deathCells.push({ x: head1.x, y: head1.y, who: 1 })
      if (p2Dead) this.deathCells.push({ x: head2.x, y: head2.y, who: 2 })
      // Compose a per-snake reason so the banner reads sensibly however each
      // snake died. Head-on is a single shared cause; otherwise describe each
      // dead snake (wall > self > opponent, matching the p*Dead precedence).
      const describe = (who: 1 | 2, offBoard: boolean, inGridCell: boolean, hitsSelf: boolean): string =>
        offBoard ? (inGridCell ? `P${who} fell into a hole` : `P${who} hit the wall`)
          : hitsSelf ? `P${who} ran into itself`
          : `P${who} crashed into P${who === 1 ? 2 : 1}`
      if (headToHead) {
        this.deathMessage = 'Head-on collision!'
      } else {
        const parts: string[] = []
        if (p1Dead) parts.push(describe(1, p1OffBoard, p1InGrid, p1HitsSelf))
        if (p2Dead) parts.push(describe(2, p2OffBoard, p2InGrid, p2HitsSelf))
        this.deathMessage = parts.join(' · ')
      }
      this.beginDeathFreeze(() => this.endGameTwoPlayer(p1Dead, p2Dead))
      return
    }

    // Apply moves
    this.snake.unshift(head1)
    this.snakeSet.add(`${head1.x},${head1.y}`)
    this.snake2.unshift(head2)
    this.snakeSet2.add(`${head2.x},${head2.y}`)

    // Check food
    const p1AteFood = head1.x === this.food.x && head1.y === this.food.y
    const p2AteFood = head2.x === this.food.x && head2.y === this.food.y

    if (p1AteFood) this.score++
    if (p2AteFood) this.score2++
    this.movesSinceFood1 = p1AteFood ? 0 : this.movesSinceFood1 + 1
    this.movesSinceFood2 = p2AteFood ? 0 : this.movesSinceFood2 + 1
    if (p1AteFood || p2AteFood) {
      resetLoopMemory(this.botLoopMemory)
      resetLoopMemory(this.botLoopMemory2)
      this.spawnFood()
      this.checkGridExpansion()
    }

    // Remove tails if didn't eat
    if (!p1AteFood) {
      const tail = this.snake.pop()!
      this.snakeSet.delete(`${tail.x},${tail.y}`)
    }
    if (!p2AteFood) {
      const tail = this.snake2.pop()!
      this.snakeSet2.delete(`${tail.x},${tail.y}`)
    }

    if (this.snake.length > this.maxLength1) this.maxLength1 = this.snake.length
    if (this.snake2.length > this.maxLength2) this.maxLength2 = this.snake2.length

    // A snake that starves loses; if both starve on the same tick it's a draw.
    // Reuse the existing win/loss/draw resolution by feeding starved snakes as dead.
    const limit = this.starvationLimit()
    const p1Starved = this.movesSinceFood1 >= limit
    const p2Starved = this.movesSinceFood2 >= limit
    if (p1Starved || p2Starved) {
      this.deathCause = 'starved'
      this.deathMessage = p1Starved && p2Starved
        ? 'Both snakes starved!'
        : `P${p1Starved ? 1 : 2} starved!`
      this.deathCells = []
      this.beginDeathFreeze(() => this.endGameTwoPlayer(p1Starved, p2Starved))
      return
    }

    // See updateSinglePlayer: a morph in progress owns painting this tick.
    if (!this.isTransitioning) this.draw()
    this.updateUI()
  }

  // === Bot AI ===

  private chooseBotDirection(): Direction | null {
    const botState: BotState = {
      snake: this.snake,
      food: this.food,
      gridSize: this.gridSize,
      direction: this.direction
    }

    const botHelpers: BotHelpers = {
      simulateMove: (snake, direction, food) => this.simulateMove(snake, direction, food),
      analyzePosition: (start, snake, targets) =>
        this.analyzePosition(start, snake, targets),
      getCandidateDirections: currentDirection => this.getCandidateDirections(currentDirection)
    }

    const botDirection = this.activeBot.chooseDirection(botState, botHelpers)
    const direction = applyLoopGuard(this.botLoopMemory, botState, botHelpers, botDirection)
    if (!direction || !this.isValidDirection(direction, this.direction)) {
      return null
    }
    return this.simulateMove(this.snake, direction, this.food) ? direction : null
  }

  private chooseBotDirectionForPlayer(player: 1 | 2): Direction | null {
    const snake = player === 1 ? this.snake : this.snake2
    const currentDirection = player === 1 ? this.direction : this.direction2
    const bot = player === 1 ? this.activeBot : this.activeBot2
    const opponentSnake = player === 1 ? this.snake2 : this.snake
    const opponentSnakeSet = player === 1 ? this.snakeSet2 : this.snakeSet

    const botState: BotState = {
      snake,
      food: this.food,
      gridSize: this.gridSize,
      direction: currentDirection,
      opponentSnake
    }

    // Create helpers that include opponent snake as blocked
    const botHelpers: BotHelpers = {
      simulateMove: (s, dir, food) => {
        const nextHead = this.getMovedPosition(s[0], dir)
        if (this.wouldCollide(nextHead, s) || opponentSnakeSet.has(`${nextHead.x},${nextHead.y}`)) {
          return null
        }
        const nextSnake = [nextHead, ...s]
        if (!(nextHead.x === food.x && nextHead.y === food.y)) {
          nextSnake.pop()
        }
        return nextSnake
      },
      analyzePosition: (start, s, targets) => {
        return this.analyzePosition(start, s, targets, opponentSnakeSet)
      },
      getCandidateDirections: dir => this.getCandidateDirections(dir)
    }

    const botDirection = bot.chooseDirection(botState, botHelpers)
    const mem = player === 1 ? this.botLoopMemory : this.botLoopMemory2
    const direction = applyLoopGuard(mem, botState, botHelpers, botDirection)
    if (!direction || !this.isValidDirection(direction, currentDirection)) {
      return null
    }

    // Validate the chosen move
    const nextHead = this.getMovedPosition(snake[0], direction)
    if (this.wouldCollide(nextHead, snake) || opponentSnakeSet.has(`${nextHead.x},${nextHead.y}`)) {
      return null
    }

    return direction
  }

  // === Collision and movement helpers ===

  private simulateMove(snake: Position[], direction: Direction, food: Position): Position[] | null {
    const nextHead = this.getMovedPosition(snake[0], direction)
    if (this.wouldCollide(nextHead, snake)) {
      return null
    }

    const nextSnake = [nextHead, ...snake]
    const ateFood = nextHead.x === food.x && nextHead.y === food.y
    if (!ateFood) {
      nextSnake.pop()
    }
    return nextSnake
  }


  private getMovedPosition(position: Position, direction: Direction): Position {
    const vector = DIRECTION_VECTORS[direction]
    return {
      x: position.x + vector.x,
      y: position.y + vector.y
    }
  }

  // A cell is playable if it lies inside the grid and, when an Iron Snake mask
  // is active, is marked on-board. This is the single source of truth for board
  // extent: inBounds delegates here, so collision, food, and bot BFS all respect
  // the Iron Snake shape automatically.
  private onBoard(x: number, y: number): boolean {
    if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) return false
    if (this.boardMask === null) return true
    return this.boardMask[y * this.gridSize + x] === 1
  }

  private inBounds(position: Position): boolean {
    return this.onBoard(position.x, position.y)
  }

  // Find a safe spawn on an arbitrary board: an on-board, unoccupied cell near
  // `preferred` that has a direction with at least `clearance` clear cells
  // ahead, so a freshly-placed snake won't immediately run into a wall.
  // Returns null only on a pathological board (caller falls back to a rectangle).
  // On-board, unoccupied cells sorted by Manhattan distance to `preferred`.
  // Shared by findStartCell (single-cell spawn) and the shape-preserving
  // placement below (anchor search).
  private sortedCandidates(preferred: Position, occupied: Set<string>): Position[] {
    const candidates: Position[] = []
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        if (!this.onBoard(x, y)) continue
        if (occupied.has(`${x},${y}`)) continue
        candidates.push({ x, y })
      }
    }
    candidates.sort(
      (a, b) =>
        Math.abs(a.x - preferred.x) + Math.abs(a.y - preferred.y) -
        (Math.abs(b.x - preferred.x) + Math.abs(b.y - preferred.y))
    )
    return candidates
  }

  private findStartCell(
    preferred: Position,
    occupied: Set<string>,
    clearance: number = 3
  ): { pos: Position; dir: Direction } | null {
    const candidates = this.sortedCandidates(preferred, occupied)

    let fallback: { pos: Position; dir: Direction } | null = null
    for (const pos of candidates) {
      for (const dir of DIRECTIONS) {
        const vec = DIRECTION_VECTORS[dir]
        let clear = 0
        for (let step = 1; step <= clearance; step++) {
          const cx = pos.x + vec.x * step
          const cy = pos.y + vec.y * step
          if (!this.onBoard(cx, cy) || occupied.has(`${cx},${cy}`)) break
          clear++
        }
        if (clear >= clearance) return { pos, dir }
        if (!fallback && clear >= 1) fallback = { pos, dir }
      }
    }
    return fallback
  }

  // Map a unit step vector to its Direction (used to derive facing from geometry).
  private vectorToDirection(v: Position): Direction {
    for (const d of DIRECTIONS) {
      const vec = DIRECTION_VECTORS[d]
      if (vec.x === v.x && vec.y === v.y) return d
    }
    return 'RIGHT' // unreachable for unit vectors
  }

  // Bounding-box gridSize for an Iron Snake level. The snake keeps its length,
  // so size the board to the snake's length at the level's goal
  // (endLen = goal + heads), targeting IRON_SNAKE_GOAL_FILL occupancy. Floored
  // at max(min size, the user's chosen size) and monotonic in level, so the
  // board never shrinks between levels.
  private ironSnakeGridSizeForLevel(level: number): number {
    const goal = ironSnakeGoalForLevel(level)
    const endLen = this.isTwoSnakeMode() ? goal + 2 : goal + 1
    const targetArea = endLen / IRON_SNAKE_GOAL_FILL
    const floor = Math.max(IRON_SNAKE_MIN_SIZE, this.initialGridSize)
    return Math.max(floor, ironSnakeGridSizeForArea(targetArea))
  }

  private positionToKey(position: Position): string {
    return `${position.x},${position.y}`
  }

  private wouldCollide(head: Position, snake: Position[], blockedSet?: Set<string>): boolean {
    if (!this.inBounds(head)) {
      return true
    }
    if (blockedSet) {
      return blockedSet.has(`${head.x},${head.y}`)
    }
    return snake.some(segment => segment.x === head.x && segment.y === head.y)
  }

  private getCandidateDirections(currentDirection: Direction): Direction[] {
    return DIRECTIONS.filter(direction => OPPOSITE_DIRECTIONS[currentDirection] !== direction)
  }

  private analyzePosition(
    start: Position,
    snake: Position[],
    targets: { tail: Position; food: Position },
    additionalBlocked?: Set<string>
  ): { reachableArea: number; canReachTail: boolean; pathToFood: number | null } {
    const startKey = this.positionToKey(start)
    const tailKey = this.positionToKey(targets.tail)
    const foodKey = this.positionToKey(targets.food)

    // Blocked set matches original countReachableArea: snake minus start.
    // Tail IS blocked (like the original). We detect tail reachability by
    // checking adjacency — if any visited cell neighbors the tail, it's reachable.
    const blocked = new Set<string>()
    for (const segment of snake) {
      const key = this.positionToKey(segment)
      if (key === startKey) continue
      blocked.add(key)
    }
    if (additionalBlocked) {
      for (const key of additionalBlocked) {
        blocked.add(key)
      }
    }

    const queue: Array<{ position: Position; distance: number }> = [{ position: start, distance: 0 }]
    const visited = new Set<string>([startKey])
    let head = 0
    let canReachTail = false
    let pathToFood: number | null = null

    while (head < queue.length) {
      const current = queue[head++]
      const currentKey = this.positionToKey(current.position)

      if (currentKey === foodKey) pathToFood = current.distance

      // Check if current cell is adjacent to tail (tail is blocked, so check neighbors)
      if (!canReachTail) {
        for (const direction of DIRECTIONS) {
          const adj = this.getMovedPosition(current.position, direction)
          if (this.positionToKey(adj) === tailKey) {
            canReachTail = true
            break
          }
        }
      }

      for (const direction of DIRECTIONS) {
        const next = this.getMovedPosition(current.position, direction)
        const nextKey = this.positionToKey(next)
        if (!this.inBounds(next) || blocked.has(nextKey) || visited.has(nextKey)) {
          continue
        }
        visited.add(nextKey)
        queue.push({ position: next, distance: current.distance + 1 })
      }
    }

    return { reachableArea: visited.size, canReachTail, pathToFood }
  }

  private checkCollision(head: Position): boolean {
    return this.wouldCollide(head, this.snake, this.snakeSet)
  }

  // === Starvation ===

  // Max moves a snake may go without eating before it starves. Scales with the
  // playable board area (boardArea is kept current for both classic and Iron
  // Snake boards), with a floor so small boards still allow room to maneuver.
  private starvationLimit(): number {
    return Math.max(STARVATION_FLOOR, this.boardArea * STARVATION_AREA_FACTOR)
  }

  // 0 while the snake is well-fed, ramping to 1 as movesSinceFood approaches the
  // limit. Drives the warning tint; only nonzero past STARVATION_WARN_FRACTION.
  private hungerFactor(movesSinceFood: number): number {
    const limit = this.starvationLimit()
    const warnStart = limit * STARVATION_WARN_FRACTION
    if (movesSinceFood <= warnStart) return 0
    return Math.min(1, (movesSinceFood - warnStart) / (limit - warnStart))
  }

  // Points (== fruits, since 1 fruit = 1 pt) still needed to clear the current
  // Iron Snake level. 0 outside Iron Snake Mode or once the goal is reached.
  private ironSnakeRemaining(): number {
    if (!this.ironSnakeMode) return 0
    const combined = this.score + (this.isTwoSnakeMode() ? this.score2 : 0)
    return Math.max(0, this.levelGoal - combined)
  }

  // Linear interpolate between two "#rrggbb" colours (t in [0,1]).
  private lerpHex(from: string, to: string, t: number): string {
    const parse = (hex: string) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16)
    ]
    const a = parse(from)
    const b = parse(to)
    const channel = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t)
    const hex = (v: number) => v.toString(16).padStart(2, '0')
    return `#${hex(channel(0))}${hex(channel(1))}${hex(channel(2))}`
  }

  // === Grid expansion / level progression ===

  private checkGridExpansion() {
    // In Iron Snake Mode, reaching the point goal advances to a freshly
    // generated shape instead of doubling the grid.
    if (this.ironSnakeMode) {
      this.checkLevelAdvance()
      return
    }

    const totalCells = this.gridSize * this.gridSize
    const combinedLength = this.snake.length + (this.isTwoSnakeMode() ? this.snake2.length : 0)
    const fillPercentage = combinedLength / totalCells

    if (fillPercentage >= 0.25) {
      this.expandGrid()
    }
  }

  private expandGrid() {
    this.gridSize *= 2
    this.boardArea = this.gridSize * this.gridSize
    this.level++
    this.gameSpeed = this.gameSpeed / 2
    this.updateCanvasSize()

    if (this.gameLoop) clearInterval(this.gameLoop)
    this.gameLoop = window.setInterval(() => this.update(), this.gameSpeed)

    this.spawnFood()
  }

  // === Iron Snake Mode ===

  // Regenerate the board mask for the current gridSize. Falls back to the full
  // rectangle (mask = null) if generation fails, so the game always launches.
  private regenerateIronSnakeBoard() {
    if (!this.ironSnakeMode) {
      this.boardMask = null
      this.boardArea = this.gridSize * this.gridSize
      return
    }
    const result = generateIronSnakeBoard(this.gridSize)
    if (result) {
      this.boardMask = result.mask
      this.boardArea = result.area
    } else {
      this.boardMask = null
      this.boardArea = this.gridSize * this.gridSize
    }
  }

  // Place snake(s) on valid on-board cells with room to move. Resets each snake
  // to length 1. Returns false only if placement is impossible (caller should
  // have already fallen back to a rectangle, where this always succeeds).
  private repositionSnakes(): boolean {
    resetLoopMemory(this.botLoopMemory)
    resetLoopMemory(this.botLoopMemory2)
    this.movesSinceFood1 = 0
    this.movesSinceFood2 = 0
    const N = this.gridSize
    if (this.isTwoSnakeMode()) {
      const occ = new Set<string>()
      const p1 = this.findStartCell({ x: N * 0.25, y: N / 2 }, occ)
      if (!p1) return false
      occ.add(`${p1.pos.x},${p1.pos.y}`)
      const p2 = this.findStartCell({ x: N * 0.75, y: N / 2 }, occ)
      if (!p2) return false

      this.snake = [p1.pos]
      this.snakeSet = new Set([`${p1.pos.x},${p1.pos.y}`])
      this.direction = p1.dir
      this.nextDirection = p1.dir

      this.snake2 = [p2.pos]
      this.snakeSet2 = new Set([`${p2.pos.x},${p2.pos.y}`])
      this.direction2 = p2.dir
      this.nextDirection2 = p2.dir
    } else {
      const s = this.findStartCell({ x: N / 2, y: N / 2 }, new Set())
      if (!s) return false
      this.snake = [s.pos]
      this.snakeSet = new Set([`${s.pos.x},${s.pos.y}`])
      this.direction = s.dir
      this.nextDirection = s.dir
    }
    return true
  }

  private checkLevelAdvance() {
    const combined = this.score + (this.isTwoSnakeMode() ? this.score2 : 0)
    if (combined >= this.levelGoal) {
      this.advanceLevel()
    }
  }

  private advanceLevel() {
    // Snapshot the board being left behind (its mask + size) before we mutate
    // anything, so the morph can start from the old shape and grow into the new.
    const prevMask = this.boardMask
    const prevGridSize = this.gridSize
    // The just-cleared level's move interval; each morph step is held this long
    // so the reshape unfolds at the snake's own pace.
    const moveMs = this.gameSpeed

    this.applyLevelAdvance()

    // Animate the board reshaping from the old mask into the new one. Logic ticks
    // are paused for the morph; finishLevelMorph restarts the loop.
    if (this.gameLoop) clearInterval(this.gameLoop)
    this.gameLoop = null
    this.startLevelMorph(prevMask, prevGridSize, moveMs)
  }

  // Mutate all game state for the next level (board shape/size, snake placement,
  // goal, speed, food, HUD). Deliberately does NOT restart the loop or draw —
  // advanceLevel owns that so it can insert a morph between the old and new board.
  private applyLevelAdvance() {
    this.level++

    // Build a fresh board *around* the snakes instead of re-seating them: keep
    // every snake exactly where it is and grow a new random shape around it. Each
    // snake is first translated by the centring offset (so it stays put on screen
    // as the box grows), then the board is generated to keep those cells playable.
    const prevGridSize = this.gridSize
    this.gridSize = this.ironSnakeGridSizeForLevel(this.level)
    const offset = Math.floor((this.gridSize - prevGridSize) / 2)
    if (offset !== 0) this.translateSnakes(offset)

    if (this.ironSnakeMode) {
      const cells = this.isTwoSnakeMode() ? [...this.snake, ...this.snake2] : this.snake
      const grown = growIronSnakeBoard(this.gridSize, cells, this.level)
      this.boardMask = grown.mask
      this.boardArea = grown.area
    } else {
      this.boardMask = null
      this.boardArea = this.gridSize * this.gridSize
    }

    // Fresh starvation budget / loop memory for the new (larger) level.
    resetLoopMemory(this.botLoopMemory)
    resetLoopMemory(this.botLoopMemory2)
    this.movesSinceFood1 = 0
    this.movesSinceFood2 = 0

    this.maxLength1 = Math.max(this.maxLength1, this.snake.length)
    this.maxLength2 = Math.max(this.maxLength2, this.snake2.length)

    this.levelGoal = ironSnakeGoalForLevel(this.level)
    // Gentle speed ramp (vs the classic /2 halving); the board grows with the
    // level, so difficulty comes from the bigger arena plus a slight speed-up.
    this.gameSpeed = Math.max(IRON_SNAKE_MIN_SPEED, Math.round(this.baseSpeed * Math.pow(0.9, this.level - 1)))
    this.updateCanvasSize()

    this.spawnFood()
    this.updateUI()
  }

  // Shift both snakes (and their occupancy sets) by `offset` on each axis, so a
  // snake keeps its exact shape and heading while the board grows centred around
  // it. Directions are unchanged; the snake does not visually move.
  private translateSnakes(offset: number) {
    const shift = (snake: Position[]) => snake.map(s => ({ x: s.x + offset, y: s.y + offset }))
    this.snake = shift(this.snake)
    this.snakeSet = new Set(this.snake.map(s => `${s.x},${s.y}`))
    if (this.isTwoSnakeMode()) {
      this.snake2 = shift(this.snake2)
      this.snakeSet2 = new Set(this.snake2.map(s => `${s.x},${s.y}`))
    }
  }

  // === Level transition (board morph) ===

  // Build the start/target display masks and the wave-ordered list of cells that
  // differ, then drive an RAF loop that reveals them so the playable region
  // reshapes cell-by-cell. `prevMask`/`prevGridSize` describe the old board.
  private startLevelMorph(prevMask: Uint8Array | null, prevGridSize: number, moveMs: number) {
    const N = this.gridSize
    const targetReal = this.boardMask

    // Target as a concrete mask (a null real mask = full rectangle => all playable).
    const targetDisplay = new Uint8Array(N * N)
    if (targetReal === null) targetDisplay.fill(1)
    else targetDisplay.set(targetReal)

    // Start = the old board's cells, centre-aligned into the (usually larger) new
    // grid. A null old mask means the old board was a full rectangle.
    const startDisplay = new Uint8Array(N * N)
    const O = prevGridSize
    const off = Math.floor((N - O) / 2)
    for (let oy = 0; oy < O; oy++) {
      for (let ox = 0; ox < O; ox++) {
        const wasPlayable = prevMask === null || prevMask[oy * O + ox] === 1
        if (!wasPlayable) continue
        const nx = ox + off
        const ny = oy + off
        if (nx >= 0 && nx < N && ny >= 0 && ny < N) startDisplay[ny * N + nx] = 1
      }
    }
    // Ground every cell the snakes and food currently occupy (they sit at their
    // new positions already) so nothing is ever drawn floating over the void.
    const ground = (x: number, y: number) => {
      if (x >= 0 && x < N && y >= 0 && y < N) startDisplay[y * N + x] = 1
    }
    for (const s of this.snake) ground(s.x, s.y)
    if (this.isTwoSnakeMode()) for (const s of this.snake2) ground(s.x, s.y)
    ground(this.food.x, this.food.y)

    // Cells that must change, ordered as an inside-out wave from the board centre
    // (the shape grows outward and old-only cells peel away as the wave passes).
    const changed: number[] = []
    for (let i = 0; i < N * N; i++) {
      if (startDisplay[i] !== targetDisplay[i]) changed.push(i)
    }
    const c = N / 2
    const dist2 = (i: number) => {
      const x = (i % N) + 0.5 - c
      const y = Math.floor(i / N) + 0.5 - c
      return x * x + y * y
    }
    changed.sort((a, b) => dist2(a) - dist2(b))

    // Pace the reshape to the snake's rhythm: a few steps, each held for about one
    // move; scale the count with the reshape size, capped so it never drags.
    this.morphSteps = Math.min(
      LEVEL_MORPH_MAX_STEPS,
      Math.max(LEVEL_MORPH_MIN_STEPS, Math.ceil(changed.length / LEVEL_MORPH_CELLS_PER_STEP))
    )
    this.morphStepMs = Math.max(LEVEL_MORPH_MIN_STEP_MS, moveMs)
    this.morphLastReveal = 0

    this.morphWork = startDisplay
    this.morphTargetReal = targetReal
    this.morphTargetDisplay = targetDisplay
    this.morphChanged = changed
    this.morphRevealed = 0
    this.isTransitioning = true
    this.transitionStartTime = 0

    // Nothing to reshape (same shape and size) — skip straight to the clean state.
    if (changed.length === 0) {
      this.finishLevelMorph()
      return
    }

    // Paint the start frame now (updateCanvasSize cleared the resized canvas), then
    // let the RAF loop reveal the changes.
    this.boardMask = this.morphWork
    this.draw()
    this.transitionRafId = requestAnimationFrame(t => this.morphStep(t))
  }

  private morphStep(timestamp: number) {
    if (!this.isTransitioning) return
    if (this.transitionStartTime === 0) this.transitionStartTime = timestamp

    const elapsed = timestamp - this.transitionStartTime
    // Discrete steps: the first chunk shows immediately, one more each step, and
    // each state is held for morphStepMs so the reshape reads as deliberate beats.
    const step = Math.min(this.morphSteps, 1 + Math.floor(elapsed / this.morphStepMs))
    const revealTarget = Math.round((step / this.morphSteps) * this.morphChanged.length)

    // Only repaint when a step actually reveals new cells (the board is static in
    // between), so the hold between steps is free.
    if (revealTarget !== this.morphLastReveal) {
      for (; this.morphRevealed < revealTarget; this.morphRevealed++) {
        const idx = this.morphChanged[this.morphRevealed]
        this.morphWork![idx] = this.morphTargetDisplay![idx]
      }
      this.morphLastReveal = revealTarget
      this.boardMask = this.morphWork
      this.draw()
    }

    // Finish once the final step has been held for its full duration.
    if (elapsed >= this.morphSteps * this.morphStepMs) {
      this.finishLevelMorph()
      return
    }
    this.transitionRafId = requestAnimationFrame(ts => this.morphStep(ts))
  }

  // Restore the real new mask, repaint cleanly, and resume the logic loop.
  private finishLevelMorph() {
    if (this.transitionRafId !== null) {
      cancelAnimationFrame(this.transitionRafId)
      this.transitionRafId = null
    }
    this.boardMask = this.morphTargetReal
    this.morphWork = null
    this.morphTargetDisplay = null
    this.morphTargetReal = null
    this.morphChanged = []
    this.morphRevealed = 0
    this.morphLastReveal = 0
    this.isTransitioning = false
    this.transitionStartTime = 0

    this.draw()

    if (this.gameLoop) clearInterval(this.gameLoop)
    this.gameLoop = window.setInterval(() => this.update(), this.gameSpeed)
  }

  // Abandon an in-flight morph without restoring the old board (used when the game
  // is torn down / restarted, which sets up its own board immediately after).
  private cancelLevelMorph() {
    if (this.transitionRafId !== null) {
      cancelAnimationFrame(this.transitionRafId)
      this.transitionRafId = null
    }
    this.isTransitioning = false
    this.morphWork = null
    this.morphTargetDisplay = null
    this.morphTargetReal = null
    this.morphChanged = []
    this.morphRevealed = 0
    this.morphLastReveal = 0
    this.transitionStartTime = 0
  }

  // === Food ===

  private spawnFood() {
    const combinedLength = this.snake.length + (this.isTwoSnakeMode() ? this.snake2.length : 0)

    // Enumerate empty cells directly once the board is more than half full, or
    // whenever an Iron Snake mask is active (rejection sampling would waste most
    // draws on off-board cells). `boardArea` is the playable-cell count.
    if (this.boardMask !== null || combinedLength > this.boardArea * 0.5) {
      const emptyCells: Position[] = []
      for (let y = 0; y < this.gridSize; y++) {
        for (let x = 0; x < this.gridSize; x++) {
          if (!this.onBoard(x, y)) continue
          const key = `${x},${y}`
          if (!this.snakeSet.has(key) && (!this.isTwoSnakeMode() || !this.snakeSet2.has(key))) {
            emptyCells.push({ x, y })
          }
        }
      }
      if (emptyCells.length > 0) {
        this.food = emptyCells[Math.floor(Math.random() * emptyCells.length)]
      }
      // If no empty cell exists the board is full; leave food where it is.
      return
    }

    let newFood: Position
    do {
      newFood = {
        x: Math.floor(Math.random() * this.gridSize),
        y: Math.floor(Math.random() * this.gridSize)
      }
    } while (
      this.snakeSet.has(`${newFood.x},${newFood.y}`) ||
      (this.isTwoSnakeMode() && this.snakeSet2.has(`${newFood.x},${newFood.y}`))
    )
    this.food = newFood
  }

  // === UI ===

  private updateUI() {
    if (this.isTwoSnakeMode()) {
      document.getElementById('p1-score')!.textContent = this.score.toString()
      document.getElementById('p2-score')!.textContent = this.score2.toString()
    } else {
      document.getElementById('score')!.textContent = this.score.toString()
    }
    document.getElementById('level')!.textContent = this.level.toString()
    document.getElementById('grid-size')!.textContent = `${this.gridSize}x${this.gridSize}`

    // In Iron Snake Mode, show goal progress instead of grid dimensions.
    const gridDisplay = document.getElementById('grid-display')!
    const goalDisplay = document.getElementById('iron-snake-goal-display')!
    gridDisplay.classList.toggle('hidden', this.ironSnakeMode)
    goalDisplay.classList.toggle('hidden', !this.ironSnakeMode)
    if (this.ironSnakeMode) {
      const remaining = this.ironSnakeRemaining()
      const suffix = remaining === 1 ? 'pt' : 'pts'
      document.getElementById('iron-snake-goal')!.textContent = `${remaining} ${suffix}`
    }

    this.updateStarvationWarning()
  }

  // Show a pulsing alert the moment a snake enters the hunger (tinted) zone, so
  // the player knows to race to the food before it starves. Text names which
  // snake is at risk in two-player modes. The exact remaining-move count drives
  // the tint; here a plain urgent message avoids per-tick number flicker.
  private updateStarvationWarning() {
    const warningEl = document.getElementById('starvation-warning')!
    const p1Hungry = this.hungerFactor(this.movesSinceFood1) > 0
    const p2Hungry = this.isTwoSnakeMode() && this.hungerFactor(this.movesSinceFood2) > 0

    if (!p1Hungry && !p2Hungry) {
      warningEl.classList.add('hidden')
      return
    }

    let message: string
    if (this.isTwoSnakeMode()) {
      if (p1Hungry && p2Hungry) message = '⚠ Both snakes starving — reach the food!'
      else if (p1Hungry) message = '⚠ P1 starving — reach the food!'
      else message = '⚠ P2 starving — reach the food!'
    } else {
      message = '⚠ Starving — reach the food!'
    }
    warningEl.textContent = message
    warningEl.classList.remove('hidden')
  }

  // Show the frozen-death banner over the still-visible board, naming how the
  // snake lost. deathMessage is set at the death site; " — Press any key" is the
  // universal dismissal hint. Mirrors the starvation-warning overlay pattern.
  private showDeathBanner() {
    const bannerEl = document.getElementById('death-banner')!
    bannerEl.textContent = `${this.deathMessage} — Press any key`
    bannerEl.classList.remove('hidden')
  }

  private hideDeathBanner() {
    document.getElementById('death-banner')!.classList.add('hidden')
  }

  // Rainbow Snake surprise (JOE-7): flash the Mortal Kombat "FRIENDSHIP!"-style
  // banner announcing the rare rainbow game, hold it, then fade it out. Called
  // when a rainbow game starts; auto-dismisses so it never covers the board.
  private showRainbowBanner() {
    const el = document.getElementById('rainbow-banner')!
    this.clearRainbowBannerTimer()
    el.classList.remove('hidden', 'fading')
    void el.offsetWidth // reflow so the pop-in animation restarts on a fresh game
    this.rainbowBannerTimer = window.setTimeout(() => {
      el.classList.add('fading') // CSS transitions opacity to 0
      this.rainbowBannerTimer = window.setTimeout(() => this.hideRainbowBanner(), RAINBOW_BANNER_FADE_MS)
    }, RAINBOW_BANNER_MS)
  }

  private hideRainbowBanner() {
    this.clearRainbowBannerTimer()
    const el = document.getElementById('rainbow-banner')!
    el.classList.add('hidden')
    el.classList.remove('fading')
  }

  private clearRainbowBannerTimer() {
    if (this.rainbowBannerTimer !== null) {
      clearTimeout(this.rainbowBannerTimer)
      this.rainbowBannerTimer = null
    }
  }

  private updateModeUI() {
    const isTwoPlayer = this.isTwoSnakeMode()

    const scoreDisplay = document.getElementById('score-display')!
    const p1ScoreDisplay = document.getElementById('p1-score-display')!
    const p2ScoreDisplay = document.getElementById('p2-score-display')!
    const botStatusDisplay = document.getElementById('bot-status-display')!
    const controlsText = document.getElementById('controls-text')!

    scoreDisplay.classList.toggle('hidden', isTwoPlayer)
    p1ScoreDisplay.classList.toggle('hidden', !isTwoPlayer)
    p2ScoreDisplay.classList.toggle('hidden', !isTwoPlayer)
    botStatusDisplay.classList.toggle('hidden', isTwoPlayer)

    if (this.gameMode === 'pvp') {
      controlsText.textContent = 'P1: WASD | P2: Arrow Keys | P to Pause | R to Reset | Q/E to rotate | T to pause rotation | O for overhead view'
    } else if (this.gameMode === 'bvb') {
      controlsText.textContent = `${this.activeBot.name} vs ${this.activeBot2.name} | P to Pause | R to Reset | Q/E to rotate | T to pause rotation | O for overhead view`
    } else {
      controlsText.textContent = 'Use Arrow Keys or WASD to move | Press P to Pause | Press R to Reset | +/- to change grid size | Press O for overhead view | Press any direction to start'
    }
  }

  // === Game over ===

  // Enter the death-freeze phase instead of jumping straight to the game-over
  // screen: stop the loop, keep the board on screen, render the frozen frame
  // (including any highlighted fatal cell), and show the loss-reason banner. The
  // deferred `finalize` (endGame / endGameTwoPlayer) runs when the player presses
  // any key — see the awaitingDeathAck branch in handleKeyPress. Steps mirror the
  // interval-stop that endGame runs at finalize time, so re-running them is safe.
  private beginDeathFreeze(finalize: () => void) {
    this.isGameOver = true
    this.awaitingDeathAck = true
    this.pendingFinalize = finalize
    // Leave auto-rotate running (it spins the frozen board into a death cam in
    // bot/bvb modes); the camera keys stay live too — see handleKeyPress. The
    // deferred endGame/endGameTwoPlayer stops auto-rotate when the freeze ends.
    if (this.gameLoop) {
      clearInterval(this.gameLoop)
      this.gameLoop = null
    }
    // Hide the starvation alert so it doesn't overlap the death banner.
    document.getElementById('starvation-warning')!.classList.add('hidden')
    this.draw()
    this.showDeathBanner()
  }

  private endGame() {
    this.isGameOver = true
    this.stopAutoRotate()
    if (this.gameLoop) {
      clearInterval(this.gameLoop)
      this.gameLoop = null
    }

    const highScore = this.getHighScore()
    if (this.score > highScore) {
      this.saveHighScore(this.score)
    }

    document.getElementById('game-over-title')!.textContent =
      this.deathCause === 'starved' ? 'Starved!' : 'Game Over!'
    document.getElementById('game-over-winner')!.classList.add('hidden')
    document.getElementById('single-final-score')!.classList.remove('hidden')
    document.getElementById('final-score')!.textContent = this.score.toString()
    document.getElementById('game-over-high-score')!.textContent = Math.max(this.score, highScore).toString()
    document.getElementById('two-player-final-scores')!.classList.add('hidden')
    document.getElementById('high-score-display')!.classList.remove('hidden')

    const survivalSeconds = this.survivalSeconds()
    this.renderGameOverStats([
      { label: 'Longest', value: this.maxLength1.toString() },
      { label: 'Time', value: formatDuration(survivalSeconds) }
    ])

    if (this.botEverActive) {
      // Any bot involvement disqualifies the run from the human leaderboard.
      this.clearLeaderboardPrompt()
    } else {
      this.maybePromptForEntry('single', {
        name: '',
        score: this.score,
        longestSnake: this.maxLength1,
        survivalSeconds,
        timestamp: Date.now()
      })
    }

    this.showScreen('game-over')
  }

  private endGameTwoPlayer(p1Dead: boolean, p2Dead: boolean) {
    this.isGameOver = true
    this.stopAutoRotate()
    if (this.gameLoop) {
      clearInterval(this.gameLoop)
      this.gameLoop = null
    }

    let winnerText: string
    let p1Result: GameResult
    let p2Result: GameResult
    if (p1Dead && p2Dead) {
      winnerText = 'Draw!'
      p1Result = 'draw'
      p2Result = 'draw'
    } else if (p1Dead) {
      winnerText = 'Player 2 Wins!'
      p1Result = 'loss'
      p2Result = 'win'
    } else {
      winnerText = 'Player 1 Wins!'
      p1Result = 'win'
      p2Result = 'loss'
    }

    // When the death was starvation, name the cause so the outcome is legible.
    if (this.deathCause === 'starved') {
      if (p1Dead && p2Dead) winnerText = 'Draw — both starved!'
      else if (p1Dead) winnerText = 'Player 2 Wins! (P1 starved)'
      else winnerText = 'Player 1 Wins! (P2 starved)'
    }

    document.getElementById('game-over-title')!.textContent =
      this.deathCause === 'starved' ? 'Starved!' : 'Game Over!'
    const winnerEl = document.getElementById('game-over-winner')!
    winnerEl.textContent = winnerText
    winnerEl.classList.remove('hidden')
    document.getElementById('single-final-score')!.classList.add('hidden')
    const twoPlayerScores = document.getElementById('two-player-final-scores')!
    twoPlayerScores.classList.remove('hidden')
    document.getElementById('final-p1-score')!.textContent = this.score.toString()
    document.getElementById('final-p2-score')!.textContent = this.score2.toString()
    document.getElementById('high-score-display')!.classList.add('hidden')

    const survivalSeconds = this.survivalSeconds()
    this.renderGameOverStats([
      { label: 'P1 longest', value: this.maxLength1.toString() },
      { label: 'P2 longest', value: this.maxLength2.toString() },
      { label: 'Time', value: formatDuration(survivalSeconds) }
    ])

    if (this.gameMode === 'bvb') {
      // Auto-record both bots; no prompt needed.
      addEntry('bvb', {
        name: this.activeBot.name,
        score: this.score,
        longestSnake: this.maxLength1,
        survivalSeconds,
        timestamp: Date.now(),
        result: p1Result,
        opponent: this.activeBot2.name
      })
      addEntry('bvb', {
        name: this.activeBot2.name,
        score: this.score2,
        longestSnake: this.maxLength2,
        survivalSeconds,
        timestamp: Date.now(),
        result: p2Result,
        opponent: this.activeBot.name
      })
      this.clearLeaderboardPrompt()
    } else {
      // PvP: prompt for the winning player (or the higher scorer on draw).
      const useP1 =
        p1Result === 'win' ||
        (p1Result === 'draw' && this.score >= this.score2)
      const entry: LeaderboardEntry = useP1
        ? {
            name: '',
            score: this.score,
            longestSnake: this.maxLength1,
            survivalSeconds,
            timestamp: Date.now(),
            result: p1Result
          }
        : {
            name: '',
            score: this.score2,
            longestSnake: this.maxLength2,
            survivalSeconds,
            timestamp: Date.now(),
            result: p2Result
          }
      this.maybePromptForEntry('pvp', entry)
    }

    this.showScreen('game-over')
  }

  private survivalSeconds(): number {
    if (this.gameStartTime === 0) return 0
    return Math.max(0, (performance.now() - this.gameStartTime) / 1000)
  }

  private renderGameOverStats(stats: Array<{ label: string; value: string }>) {
    const wrap = document.getElementById('game-over-stats')!
    wrap.innerHTML = ''
    for (const stat of stats) {
      const span = document.createElement('div')
      span.innerHTML = `<span class="stat-label">${stat.label}:</span><span>${stat.value}</span>`
      wrap.appendChild(span)
    }
  }

  private clearLeaderboardPrompt() {
    this.pendingEntry = null
    document.getElementById('leaderboard-prompt')!.classList.add('hidden')
    document.getElementById('leaderboard-confirmation')!.classList.add('hidden')
  }

  private maybePromptForEntry(mode: LeaderboardMode, entry: LeaderboardEntry) {
    this.clearLeaderboardPrompt()
    if (!qualifies(mode, entry.score, entry.longestSnake, entry.survivalSeconds)) return

    this.pendingEntry = { mode, entry }
    const promptEl = document.getElementById('leaderboard-prompt')!
    const rankEl = document.getElementById('leaderboard-prompt-rank')!
    const existing = getLeaderboard(mode)
    const rank = existing.filter(e =>
      e.score > entry.score ||
      (e.score === entry.score && e.longestSnake > entry.longestSnake) ||
      (e.score === entry.score && e.longestSnake === entry.longestSnake && e.survivalSeconds > entry.survivalSeconds)
    ).length + 1
    rankEl.textContent = `Rank #${rank} in ${MODE_LABELS[mode]}`
    promptEl.classList.remove('hidden')

    const input = document.getElementById('leaderboard-name-input') as HTMLInputElement
    input.value = localStorage.getItem('snake-last-name') ?? ''
    input.focus()
    input.select()
  }

  private submitPendingEntry() {
    if (!this.pendingEntry) return
    const input = document.getElementById('leaderboard-name-input') as HTMLInputElement
    const name = sanitizeName(input.value)
    localStorage.setItem('snake-last-name', name)

    const finalEntry: LeaderboardEntry = { ...this.pendingEntry.entry, name }
    const rank = addEntry(this.pendingEntry.mode, finalEntry)
    const modeLabel = MODE_LABELS[this.pendingEntry.mode]

    document.getElementById('leaderboard-prompt')!.classList.add('hidden')
    const confirmation = document.getElementById('leaderboard-confirmation')!
    confirmation.textContent = rank
      ? `Saved as #${rank} on ${modeLabel}`
      : `Saved to ${modeLabel}`
    confirmation.classList.remove('hidden')
    this.pendingEntry = null
  }

  // === Leaderboard UI ===

  private openLeaderboards(mode: LeaderboardMode) {
    this.leaderboardActiveMode = mode
    for (const tab of document.querySelectorAll<HTMLButtonElement>('.lb-tab')) {
      tab.classList.toggle('active', tab.dataset.mode === mode)
    }
    this.renderLeaderboardTable(mode)
    this.showScreen('leaderboards')
  }

  private renderLeaderboardTable(mode: LeaderboardMode) {
    const wrap = document.getElementById('leaderboard-table-wrap')!
    const entries = getLeaderboard(mode)
    if (entries.length === 0) {
      wrap.innerHTML = `<div class="leaderboard-empty">No entries yet for ${MODE_LABELS[mode]} — play a game to set the bar.</div>`
      return
    }

    const showResult = mode !== 'single'
    const showOpponent = mode === 'bvb'

    const rows = entries.map((entry, i) => {
      const cells: string[] = []
      cells.push(`<td class="rank">${i + 1}</td>`)
      cells.push(`<td>${escapeHtml(entry.name)}</td>`)
      cells.push(`<td class="score">${entry.score}</td>`)
      cells.push(`<td>${entry.longestSnake}</td>`)
      cells.push(`<td>${formatDuration(entry.survivalSeconds)}</td>`)
      if (showResult) {
        const result = entry.result ?? '—'
        cells.push(`<td class="result-${result}">${result === '—' ? '—' : result.toUpperCase()}</td>`)
      }
      if (showOpponent) {
        cells.push(`<td>${escapeHtml(entry.opponent ?? '—')}</td>`)
      }
      return `<tr>${cells.join('')}</tr>`
    }).join('')

    const headers = ['#', 'Name', 'Score', 'Longest', 'Time']
    if (showResult) headers.push('Result')
    if (showOpponent) headers.push('Opponent')

    wrap.innerHTML = `
      <table class="leaderboard-table">
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `
  }

  // === Screen management ===

  private showScreen(screenId: string) {
    document.querySelectorAll('.screen:not(.overlay)').forEach(screen => {
      screen.classList.add('hidden')
    })
    document.getElementById(screenId)!.classList.remove('hidden')
    if (this.menuDemo) {
      if (screenId === 'menu') this.menuDemo.start()
      else this.menuDemo.stop()
    }
    if (screenId !== 'menu') this.closeAllExpandPanels()
    // Never let the rainbow banner linger past the game view (e.g. quick deaths).
    if (screenId !== 'game') this.hideRainbowBanner()
  }

  private getHighScore(): number {
    const stored = localStorage.getItem('snake-high-score')
    return stored ? parseInt(stored, 10) : 0
  }

  private saveHighScore(score: number) {
    localStorage.setItem('snake-high-score', score.toString())
    this.loadHighScore()
  }

  private loadHighScore() {
    const highScore = this.getHighScore()
    document.getElementById('high-score')!.textContent = highScore.toString()
  }
}

new SnakeGame()
