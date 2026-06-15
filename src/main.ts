import './style.css'
import { AVAILABLE_BOTS, DEFAULT_BOT_ID, getBotById } from './bots'
import type { BotHelpers, BotState, SnakeBot } from './bots/bot-types'
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

type GameMode = 'single' | 'pvp' | 'bvb'

const ISO_MIN_WIDTH = 300
const ISO_MAX_WIDTH = 1200

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

  // Bot state (P2)
  private selectedBotId2: string = AVAILABLE_BOTS.length > 1 ? AVAILABLE_BOTS[1].id : DEFAULT_BOT_ID
  private activeBot2: SnakeBot = AVAILABLE_BOTS.length > 1 ? AVAILABLE_BOTS[1] : (getBotById(DEFAULT_BOT_ID) ?? AVAILABLE_BOTS[0])
  private botSelectors2: HTMLSelectElement[] = []

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

  // Stats tracking (for leaderboards)
  private gameStartTime: number = 0
  private maxLength1: number = 1
  private maxLength2: number = 1

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

  // Menu demo (small rotating snake on the start screen)
  private menuDemo: MenuDemo | null = null

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
    // angle-dependent (basisXy + basisYy) so blocks stay the same height at all angles
    this.baseBlockHeight = scale * pr * Math.SQRT2 * 0.6

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

    // Lines along the gx axis (varying gy)
    for (let gy = 0; gy <= this.gridSize; gy++) {
      const start = this.isoCache[gy][0]
      const end = this.isoCache[gy][this.gridSize]
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
    }

    // Lines along the gy axis (varying gx)
    for (let gx = 0; gx <= this.gridSize; gx++) {
      const start = this.isoCache[0][gx]
      const end = this.isoCache[this.gridSize][gx]
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
    }

    ctx.stroke()
  }

  private drawGroundBorder() {
    const ctx = this.ctx
    const topCorner = this.isoCache[0][0]
    const rightCorner = this.isoCache[0][this.gridSize]
    const bottomCorner = this.isoCache[this.gridSize][this.gridSize]
    const leftCorner = this.isoCache[this.gridSize][0]

    ctx.beginPath()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.lineWidth = 2
    ctx.moveTo(topCorner.x, topCorner.y)
    ctx.lineTo(rightCorner.x, rightCorner.y)
    ctx.lineTo(bottomCorner.x, bottomCorner.y)
    ctx.lineTo(leftCorner.x, leftCorner.y)
    ctx.closePath()
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

  private drawBlock(gx: number, gy: number, topColor: string, rightColor: string, leftColor: string) {
    const inset = 0.05
    const bh = this.getBlockHeight(gx, gy)
    const ctx = this.ctx

    // Corners clockwise: TL, TR, BR, BL
    const c = [
      this.toIso(gx + inset, gy + inset),
      this.toIso(gx + 1 - inset, gy + inset),
      this.toIso(gx + 1 - inset, gy + 1 - inset),
      this.toIso(gx + inset, gy + 1 - inset)
    ]

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

  private autoRotateStep(timestamp: number) {
    if (!this.autoRotating) return

    if (!this.autoRotatePaused && this.autoRotateLastTime > 0 && timestamp > this.autoRotatePausedUntil) {
      const dt = (timestamp - this.autoRotateLastTime) / 1000
      this.isoAngle += this.autoRotateSpeed * dt
      this.updateCanvasSize()
      this.draw()
    }

    this.autoRotateLastTime = timestamp
    this.autoRotateRafId = requestAnimationFrame(t => this.autoRotateStep(t))
  }

  // === Main draw ===

  private draw() {
    const ctx = this.ctx
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

    this.drawGroundPlane()
    this.drawGridLines()
    this.drawGroundBorder()

    // Collect all objects to render
    const objects: { x: number; y: number; type: 'head' | 'body' | 'food' | 'head2' | 'body2' }[] = []

    this.snake.forEach((segment, index) => {
      objects.push({ x: segment.x, y: segment.y, type: index === 0 ? 'head' : 'body' })
    })

    if (this.isTwoSnakeMode()) {
      this.snake2.forEach((segment, index) => {
        objects.push({ x: segment.x, y: segment.y, type: index === 0 ? 'head2' : 'body2' })
      })
    }

    objects.push({ x: this.food.x, y: this.food.y, type: 'food' })

    // Sort back-to-front (painter's algorithm): lower projected Y drawn first
    objects.sort((a, b) =>
      (a.x * this.basisXy + a.y * this.basisYy) - (b.x * this.basisXy + b.y * this.basisYy)
    )

    // Draw shadows first
    for (const obj of objects) {
      this.drawBlockShadow(obj.x, obj.y)
    }

    // Draw blocks
    for (const obj of objects) {
      switch (obj.type) {
        case 'head':
          this.drawBlock(obj.x, obj.y, '#4ade80', '#22c55e', '#16a34a')
          break
        case 'body':
          this.drawBlock(obj.x, obj.y, '#22c55e', '#16a34a', '#15803d')
          break
        case 'head2':
          this.drawBlock(obj.x, obj.y, '#60a5fa', '#3b82f6', '#2563eb')
          break
        case 'body2':
          this.drawBlock(obj.x, obj.y, '#3b82f6', '#2563eb', '#1d4ed8')
          break
        case 'food':
          this.drawBlock(obj.x, obj.y, '#ef4444', '#dc2626', '#b91c1c')
          break
      }
    }
  }

  // === Event handling ===

  private setupEventListeners() {
    document.addEventListener('keydown', this.handleKeyPress.bind(this))
    this.setupBotSelectors()
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
    document.getElementById('toggle-bot')!.addEventListener('click', () => this.toggleBot())
    document.getElementById('play-again')!.addEventListener('click', () => this.startNewGame())
    document.getElementById('back-to-menu')!.addEventListener('click', () => {
      if (this.gameLoop) clearInterval(this.gameLoop)
      this.gameLoop = null
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
    // Bot 1 selectors (game screen, BvB expand panel, Demo expand panel)
    const gameSelect = document.getElementById('game-bot-select') as HTMLSelectElement | null
    const bvbBot1Select = document.getElementById('bvb-bot1-select') as HTMLSelectElement | null
    const demoBotSelect = document.getElementById('demo-bot-select') as HTMLSelectElement | null
    this.botSelectors = [gameSelect, bvbBot1Select, demoBotSelect].filter((select): select is HTMLSelectElement => select !== null)

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

    if (e.key === 'b' || e.key === 'B') {
      if (!this.isTwoSnakeMode()) {
        this.toggleBot()
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
      this.gridSize = this.initialGridSize
      this.updateCanvasSize()
      const center = Math.floor(this.gridSize / 2)
      this.snake = [{ x: center, y: center }]
      this.snakeSet = new Set([`${center},${center}`])
      this.spawnFood()
      this.updateUI()
      this.draw()
      return
    }

    if (e.key === 'q' || e.key === 'Q') {
      this.isoAngle -= Math.PI / 36  // rotate clockwise by 5°
      this.autoRotatePausedUntil = performance.now() + 3000
      this.updateCanvasSize()
      this.draw()
      return
    }

    if (e.key === 'e' || e.key === 'E') {
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
      this.perspectiveStrength = Math.max(this.perspectiveStrength - 0.05, 0)
      this.updateCanvasSize()
      this.draw()
      return
    }

    if (e.key === ']') {
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

  private toggleBot() {
    this.botEnabled = !this.botEnabled
    if (this.botEnabled) this.botEverActive = true
    this.updateBotUI()

    if (this.botEnabled) {
      this.startAutoRotate()
    } else {
      this.stopAutoRotate()
    }

    const gameScreenVisible = !document.getElementById('game')!.classList.contains('hidden')
    if (this.botEnabled && gameScreenVisible && this.snake.length > 0 && !this.isGameOver && !this.isPaused) {
      this.startLoopIfNeeded()
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
    const bot1Ids = ['game-bot-description', 'bvb-bot1-description', 'demo-bot-description']
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
    const toggle = document.getElementById('toggle-bot')
    const demoButton = document.getElementById('start-demo')
    if (!status || !toggle || !demoButton) return

    status.textContent = this.botEnabled ? `ON (${this.activeBot.name})` : `OFF (${this.activeBot.name})`
    status.classList.toggle('on', this.botEnabled)
    status.classList.toggle('off', !this.botEnabled)
    toggle.textContent = this.botEnabled ? `Disable Bot (B)` : `Enable Bot (B)`
    demoButton.textContent = 'Solo Bot'
  }

  // === Game loop ===

  private startLoopIfNeeded() {
    if (this.gameLoop !== null) return
    this.gameStarted = true
    if (this.gameStartTime === 0) this.gameStartTime = performance.now()
    this.gameLoop = window.setInterval(() => this.update(), this.gameSpeed)
  }

  startNewGame(mode?: GameMode) {
    if (mode !== undefined) this.gameMode = mode

    // Reset bot flag for two-snake modes
    if (this.isTwoSnakeMode()) {
      this.botEnabled = false
    }
    this.botEverActive = this.botEnabled

    this.gridSize = this.initialGridSize
    this.updateCanvasSize()

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
      this.score = 0

      // P2: right side, facing left
      this.snake2 = [{ x: p2x, y: center }]
      this.snakeSet2 = new Set([`${p2x},${center}`])
      this.direction2 = 'LEFT'
      this.nextDirection2 = 'LEFT'
      this.score2 = 0
    } else {
      const center = Math.floor(this.gridSize / 2)
      this.snake = [{ x: center, y: center }]
      this.snakeSet = new Set([`${center},${center}`])
      this.direction = 'RIGHT'
      this.nextDirection = 'RIGHT'
      this.score = 0
      this.snake2 = []
      this.snakeSet2 = new Set()
    }

    this.level = 1
    this.baseSpeed = 200
    this.gameSpeed = this.baseSpeed
    this.isPaused = false
    this.isGameOver = false
    this.gameStarted = false
    this.gameStartTime = 0
    this.maxLength1 = this.snake.length
    this.maxLength2 = this.snake2.length
    this.pendingEntry = null
    this.spawnFood()
    this.updateUI()
    this.showScreen('game')
    document.getElementById('pause')!.classList.add('hidden')

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
      this.endGame()
      return
    }

    this.snake.unshift(head)
    this.snakeSet.add(`${head.x},${head.y}`)

    if (head.x === this.food.x && head.y === this.food.y) {
      this.score++
      this.spawnFood()
      this.checkGridExpansion()
    } else {
      const tail = this.snake.pop()!
      this.snakeSet.delete(`${tail.x},${tail.y}`)
    }

    if (this.snake.length > this.maxLength1) this.maxLength1 = this.snake.length

    this.draw()
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

    // Check collisions for each snake
    const p1HitsWall = !this.inBounds(head1)
    const p1HitsSelf = this.snakeSet.has(`${head1.x},${head1.y}`)
    const p1HitsP2 = this.snakeSet2.has(`${head1.x},${head1.y}`)

    const p2HitsWall = !this.inBounds(head2)
    const p2HitsSelf = this.snakeSet2.has(`${head2.x},${head2.y}`)
    const p2HitsP1 = this.snakeSet.has(`${head2.x},${head2.y}`)

    // Head-to-head collision
    const headToHead = head1.x === head2.x && head1.y === head2.y

    const p1Dead = p1HitsWall || p1HitsSelf || p1HitsP2 || headToHead
    const p2Dead = p2HitsWall || p2HitsSelf || p2HitsP1 || headToHead

    if (p1Dead || p2Dead) {
      this.endGameTwoPlayer(p1Dead, p2Dead)
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
    if (p1AteFood || p2AteFood) {
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

    this.draw()
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

    const direction = this.activeBot.chooseDirection(botState, botHelpers)
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

    const direction = bot.chooseDirection(botState, botHelpers)
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

  private inBounds(position: Position): boolean {
    return position.x >= 0 && position.x < this.gridSize && position.y >= 0 && position.y < this.gridSize
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

  // === Grid expansion ===

  private checkGridExpansion() {
    const totalCells = this.gridSize * this.gridSize
    const combinedLength = this.snake.length + (this.isTwoSnakeMode() ? this.snake2.length : 0)
    const fillPercentage = combinedLength / totalCells

    if (fillPercentage >= 0.25) {
      this.expandGrid()
    }
  }

  private expandGrid() {
    this.gridSize *= 2
    this.level++
    this.gameSpeed = this.gameSpeed / 2
    this.updateCanvasSize()

    if (this.gameLoop) clearInterval(this.gameLoop)
    this.gameLoop = window.setInterval(() => this.update(), this.gameSpeed)

    this.spawnFood()
  }

  // === Food ===

  private spawnFood() {
    const totalCells = this.gridSize * this.gridSize
    const combinedLength = this.snake.length + (this.isTwoSnakeMode() ? this.snake2.length : 0)

    if (combinedLength > totalCells * 0.5) {
      // At high fill ratios, collect empty cells directly
      const emptyCells: Position[] = []
      for (let y = 0; y < this.gridSize; y++) {
        for (let x = 0; x < this.gridSize; x++) {
          const key = `${x},${y}`
          if (!this.snakeSet.has(key) && (!this.isTwoSnakeMode() || !this.snakeSet2.has(key))) {
            emptyCells.push({ x, y })
          }
        }
      }
      if (emptyCells.length > 0) {
        this.food = emptyCells[Math.floor(Math.random() * emptyCells.length)]
        return
      }
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
  }

  private updateModeUI() {
    const isTwoPlayer = this.isTwoSnakeMode()

    const scoreDisplay = document.getElementById('score-display')!
    const p1ScoreDisplay = document.getElementById('p1-score-display')!
    const p2ScoreDisplay = document.getElementById('p2-score-display')!
    const botStatusDisplay = document.getElementById('bot-status-display')!
    const gameBotSelection = document.getElementById('game-bot-selection')!
    const toggleBot = document.getElementById('toggle-bot')!
    const controlsText = document.getElementById('controls-text')!

    scoreDisplay.classList.toggle('hidden', isTwoPlayer)
    p1ScoreDisplay.classList.toggle('hidden', !isTwoPlayer)
    p2ScoreDisplay.classList.toggle('hidden', !isTwoPlayer)
    botStatusDisplay.classList.toggle('hidden', isTwoPlayer)
    gameBotSelection.classList.toggle('hidden', isTwoPlayer)
    toggleBot.classList.toggle('hidden', isTwoPlayer)

    if (this.gameMode === 'pvp') {
      controlsText.textContent = 'P1: WASD | P2: Arrow Keys | P to Pause | R to Reset | Q/E to rotate | T to pause rotation'
    } else if (this.gameMode === 'bvb') {
      controlsText.textContent = `${this.activeBot.name} vs ${this.activeBot2.name} | P to Pause | R to Reset | Q/E to rotate | T to pause rotation`
    } else {
      controlsText.textContent = 'Use Arrow Keys or WASD to move | Press P to Pause | Press R to Reset | +/- to change grid size | Press B to toggle bot | Press any direction to start'
    }
  }

  // === Game over ===

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

    document.getElementById('game-over-title')!.textContent = 'Game Over!'
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

    document.getElementById('game-over-title')!.textContent = 'Game Over!'
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
