import { AVAILABLE_BOTS, DEFAULT_BOT_ID, getBotById } from './bots'
import type { BotHelpers, BotState, SnakeBot } from './bots/bot-types'
import { applyLoopGuard, createLoopMemory, resetLoopMemory, type LoopMemory } from './bots/loop-guard'
import {
  DIRECTIONS,
  DIRECTION_VECTORS,
  OPPOSITE_DIRECTIONS,
  type Direction,
  type Position
} from './game-types'

const DEMO_GRID_SIZE = 12
const DEMO_CANVAS_WIDTH = 360
const DEMO_PERSPECTIVE_RATIO = 0.5
const DEMO_PERSPECTIVE_STRENGTH = 0.4
const DEMO_ROTATE_SPEED = 0.25 // radians per second
const DEMO_MOVE_INTERVAL = 110 // ms per snake step
const DEMO_DEATH_PAUSE = 700 // ms to linger after death before restarting

export class MenuDemo {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D

  private snake: Position[] = []
  private snakeSet: Set<string> = new Set()
  private food: Position = { x: 0, y: 0 }
  private direction: Direction = 'RIGHT'
  private gridSize: number = DEMO_GRID_SIZE

  private bot: SnakeBot
  private loopMemory: LoopMemory = createLoopMemory()
  private isoAngle: number = Math.PI / 4
  private running: boolean = false
  private rafId: number | null = null
  private lastFrameTime: number = 0
  private moveAccumulator: number = 0
  private deathPauseRemaining: number = 0

  // Iso projection state
  private basisXx: number = 0
  private basisXy: number = 0
  private basisYx: number = 0
  private basisYy: number = 0
  private baseBlockHeight: number = 0
  private focalLength: number = Infinity
  private rawMaxY: number = 0
  private rawCenterX: number = 0
  private isoOriginX: number = 0
  private isoOriginY: number = 0
  private isoCache: { x: number; y: number }[][] = []

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.bot = getBotById(DEFAULT_BOT_ID) ?? AVAILABLE_BOTS[0]
    this.resetSnake()
    this.updateProjection()
  }

  start() {
    if (this.running) return
    this.running = true
    this.lastFrameTime = 0
    this.moveAccumulator = 0
    this.rafId = requestAnimationFrame(t => this.frame(t))
  }

  stop() {
    this.running = false
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  private frame(timestamp: number) {
    if (!this.running) return

    if (this.lastFrameTime === 0) {
      this.lastFrameTime = timestamp
    }
    const dt = timestamp - this.lastFrameTime
    this.lastFrameTime = timestamp

    this.isoAngle += DEMO_ROTATE_SPEED * (dt / 1000)
    this.updateProjection()

    if (this.deathPauseRemaining > 0) {
      this.deathPauseRemaining -= dt
      if (this.deathPauseRemaining <= 0) {
        this.resetSnake()
        this.moveAccumulator = 0
      }
    } else {
      this.moveAccumulator += dt
      while (this.moveAccumulator >= DEMO_MOVE_INTERVAL && this.deathPauseRemaining <= 0) {
        this.moveAccumulator -= DEMO_MOVE_INTERVAL
        this.step()
      }
    }

    this.draw()
    this.rafId = requestAnimationFrame(t => this.frame(t))
  }

  private resetSnake() {
    const center = Math.floor(this.gridSize / 2)
    this.snake = [{ x: center, y: center }]
    this.snakeSet = new Set([`${center},${center}`])
    this.direction = 'RIGHT'
    resetLoopMemory(this.loopMemory)
    this.spawnFood()
  }

  private step() {
    const nextDirection = this.chooseBotDirection() ?? this.direction
    this.direction = nextDirection
    const head = { ...this.snake[0] }
    const vec = DIRECTION_VECTORS[this.direction]
    head.x += vec.x
    head.y += vec.y

    if (!this.inBounds(head) || this.snakeSet.has(`${head.x},${head.y}`)) {
      this.deathPauseRemaining = DEMO_DEATH_PAUSE
      return
    }

    this.snake.unshift(head)
    this.snakeSet.add(`${head.x},${head.y}`)

    if (head.x === this.food.x && head.y === this.food.y) {
      resetLoopMemory(this.loopMemory)
      this.spawnFood()
    } else {
      const tail = this.snake.pop()!
      this.snakeSet.delete(`${tail.x},${tail.y}`)
    }
  }

  private chooseBotDirection(): Direction | null {
    const state: BotState = {
      snake: this.snake,
      food: this.food,
      gridSize: this.gridSize,
      direction: this.direction
    }
    const helpers: BotHelpers = {
      simulateMove: (snake, dir, food) => this.simulateMove(snake, dir, food),
      analyzePosition: (start, snake, targets) => this.analyzePosition(start, snake, targets),
      getCandidateDirections: dir =>
        DIRECTIONS.filter(d => OPPOSITE_DIRECTIONS[dir] !== d)
    }
    const botDir = this.bot.chooseDirection(state, helpers)
    const dir = applyLoopGuard(this.loopMemory, state, helpers, botDir)
    if (!dir || OPPOSITE_DIRECTIONS[this.direction] === dir) return null
    return dir
  }

  private simulateMove(snake: Position[], direction: Direction, food: Position): Position[] | null {
    const vec = DIRECTION_VECTORS[direction]
    const next = { x: snake[0].x + vec.x, y: snake[0].y + vec.y }
    if (!this.inBounds(next)) return null
    if (snake.some(s => s.x === next.x && s.y === next.y)) return null
    const nextSnake = [next, ...snake]
    if (!(next.x === food.x && next.y === food.y)) nextSnake.pop()
    return nextSnake
  }

  private analyzePosition(
    start: Position,
    snake: Position[],
    targets: { tail: Position; food: Position }
  ) {
    const startKey = `${start.x},${start.y}`
    const tailKey = `${targets.tail.x},${targets.tail.y}`
    const foodKey = `${targets.food.x},${targets.food.y}`

    const blocked = new Set<string>()
    for (const seg of snake) {
      const key = `${seg.x},${seg.y}`
      if (key === startKey) continue
      blocked.add(key)
    }

    const queue: Array<{ p: Position; d: number }> = [{ p: start, d: 0 }]
    const visited = new Set<string>([startKey])
    let head = 0
    let canReachTail = false
    let pathToFood: number | null = null

    while (head < queue.length) {
      const cur = queue[head++]
      const curKey = `${cur.p.x},${cur.p.y}`
      if (curKey === foodKey) pathToFood = cur.d
      if (!canReachTail) {
        for (const dir of DIRECTIONS) {
          const vec = DIRECTION_VECTORS[dir]
          if (`${cur.p.x + vec.x},${cur.p.y + vec.y}` === tailKey) {
            canReachTail = true
            break
          }
        }
      }
      for (const dir of DIRECTIONS) {
        const vec = DIRECTION_VECTORS[dir]
        const next = { x: cur.p.x + vec.x, y: cur.p.y + vec.y }
        const key = `${next.x},${next.y}`
        if (!this.inBounds(next) || blocked.has(key) || visited.has(key)) continue
        visited.add(key)
        queue.push({ p: next, d: cur.d + 1 })
      }
    }

    return { reachableArea: visited.size, canReachTail, pathToFood }
  }

  private inBounds(p: Position): boolean {
    return p.x >= 0 && p.x < this.gridSize && p.y >= 0 && p.y < this.gridSize
  }

  private spawnFood() {
    const empties: Position[] = []
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        if (!this.snakeSet.has(`${x},${y}`)) empties.push({ x, y })
      }
    }
    if (empties.length === 0) {
      this.food = { x: 0, y: 0 }
      return
    }
    this.food = empties[Math.floor(Math.random() * empties.length)]
  }

  // === Iso projection ===

  private updateProjection() {
    const cosA = Math.cos(this.isoAngle)
    const sinA = Math.sin(this.isoAngle)
    const pr = DEMO_PERSPECTIVE_RATIO
    const scale = DEMO_CANVAS_WIDTH / (this.gridSize * Math.SQRT2)

    this.basisXx = cosA * scale
    this.basisXy = sinA * scale * pr
    this.basisYx = -sinA * scale
    this.basisYy = cosA * scale * pr
    this.baseBlockHeight = scale * pr * Math.SQRT2 * 0.6

    const N = this.gridSize
    const corners = [
      { x: 0, y: 0 },
      { x: N * this.basisXx, y: N * this.basisXy },
      { x: N * this.basisYx, y: N * this.basisYy },
      { x: N * (this.basisXx + this.basisYx), y: N * (this.basisXy + this.basisYy) }
    ]
    this.rawMaxY = Math.max(...corners.map(c => c.y))
    const rawMinY = Math.min(...corners.map(c => c.y))
    this.rawCenterX = (Math.min(...corners.map(c => c.x)) + Math.max(...corners.map(c => c.x))) / 2
    const depthRange = Math.max(this.rawMaxY - rawMinY, 0.001)
    this.focalLength = DEMO_PERSPECTIVE_STRENGTH > 0 ? depthRange / DEMO_PERSPECTIVE_STRENGTH : Infinity

    const padding = 12
    const canvasInnerW = DEMO_CANVAS_WIDTH
    const canvasInnerH = DEMO_CANVAS_WIDTH * pr
    this.canvas.width = canvasInnerW + padding * 2
    this.canvas.height = canvasInnerH + padding * 2 + this.baseBlockHeight

    const half = this.gridSize / 2
    const gcRawX = half * (this.basisXx + this.basisYx)
    const gcRawY = half * (this.basisXy + this.basisYy)
    const gcD = this.rawMaxY - gcRawY
    const gcS = this.focalLength === Infinity ? 1 : this.focalLength / (this.focalLength + gcD)
    const gcProjX = this.rawCenterX + (gcRawX - this.rawCenterX) * gcS
    const gcProjY = this.rawMaxY - gcD * gcS
    this.isoOriginX = this.canvas.width / 2 - gcProjX
    this.isoOriginY = this.canvas.height / 2 - gcProjY

    this.isoCache = []
    for (let gy = 0; gy <= this.gridSize; gy++) {
      this.isoCache[gy] = []
      for (let gx = 0; gx <= this.gridSize; gx++) {
        this.isoCache[gy][gx] = this.toIso(gx, gy)
      }
    }
  }

  private toIso(gridX: number, gridY: number): { x: number; y: number } {
    const rawX = gridX * this.basisXx + gridY * this.basisYx
    const rawY = gridX * this.basisXy + gridY * this.basisYy
    const d = this.rawMaxY - rawY
    const s = this.focalLength === Infinity ? 1 : this.focalLength / (this.focalLength + d)
    return {
      x: (this.rawCenterX + (rawX - this.rawCenterX) * s) + this.isoOriginX,
      y: (this.rawMaxY - d * s) + this.isoOriginY
    }
  }

  private getBlockHeight(gx: number, gy: number): number {
    if (this.focalLength === Infinity) return this.baseBlockHeight
    const centerRawY = (gx + 0.5) * this.basisXy + (gy + 0.5) * this.basisYy
    const d = this.rawMaxY - centerRawY
    const s = this.focalLength / (this.focalLength + d)
    return this.baseBlockHeight * s
  }

  // === Drawing ===

  private draw() {
    const ctx = this.ctx
    ctx.fillStyle = '#141414'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

    this.drawGroundPlane()
    this.drawGridLines()
    this.drawGroundBorder()

    const objects: { x: number; y: number; type: 'head' | 'body' | 'food' }[] = []
    this.snake.forEach((seg, i) => {
      objects.push({ x: seg.x, y: seg.y, type: i === 0 ? 'head' : 'body' })
    })
    objects.push({ x: this.food.x, y: this.food.y, type: 'food' })

    objects.sort((a, b) =>
      (a.x * this.basisXy + a.y * this.basisYy) - (b.x * this.basisXy + b.y * this.basisYy)
    )

    for (const obj of objects) this.drawBlockShadow(obj.x, obj.y)
    for (const obj of objects) {
      switch (obj.type) {
        case 'head': this.drawBlock(obj.x, obj.y, '#4ade80', '#22c55e', '#16a34a'); break
        case 'body': this.drawBlock(obj.x, obj.y, '#22c55e', '#16a34a', '#15803d'); break
        case 'food': this.drawBlock(obj.x, obj.y, '#ef4444', '#dc2626', '#b91c1c'); break
      }
    }
  }

  private drawGroundPlane() {
    const ctx = this.ctx
    const light = new Path2D()
    const dark = new Path2D()
    for (let gy = 0; gy < this.gridSize; gy++) {
      for (let gx = 0; gx < this.gridSize; gx++) {
        const t = this.isoCache[gy][gx]
        const r = this.isoCache[gy][gx + 1]
        const b = this.isoCache[gy + 1][gx + 1]
        const l = this.isoCache[gy + 1][gx]
        const path = (gx + gy) % 2 === 0 ? light : dark
        path.moveTo(t.x, t.y)
        path.lineTo(r.x, r.y)
        path.lineTo(b.x, b.y)
        path.lineTo(l.x, l.y)
        path.closePath()
      }
    }
    ctx.fillStyle = '#2a2a2a'
    ctx.fill(light)
    ctx.fillStyle = '#222222'
    ctx.fill(dark)
  }

  private drawGridLines() {
    const tileScreenWidth = Math.abs(this.basisXx) + Math.abs(this.basisYx)
    if (tileScreenWidth < 5) return
    const ctx = this.ctx
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
    ctx.lineWidth = 0.5
    for (let gy = 0; gy <= this.gridSize; gy++) {
      const s = this.isoCache[gy][0]
      const e = this.isoCache[gy][this.gridSize]
      ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y)
    }
    for (let gx = 0; gx <= this.gridSize; gx++) {
      const s = this.isoCache[0][gx]
      const e = this.isoCache[this.gridSize][gx]
      ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y)
    }
    ctx.stroke()
  }

  private drawGroundBorder() {
    const ctx = this.ctx
    const a = this.isoCache[0][0]
    const b = this.isoCache[0][this.gridSize]
    const c = this.isoCache[this.gridSize][this.gridSize]
    const d = this.isoCache[this.gridSize][0]
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.lineWidth = 1.5
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y)
    ctx.closePath()
    ctx.stroke()
  }

  private drawBlockShadow(gx: number, gy: number) {
    const inset = 0.05
    const t = this.toIso(gx + inset, gy + inset)
    const r = this.toIso(gx + 1 - inset, gy + inset)
    const b = this.toIso(gx + 1 - inset, gy + 1 - inset)
    const l = this.toIso(gx + inset, gy + 1 - inset)
    const ctx = this.ctx
    ctx.beginPath()
    ctx.moveTo(t.x, t.y); ctx.lineTo(r.x, r.y); ctx.lineTo(b.x, b.y); ctx.lineTo(l.x, l.y)
    ctx.closePath()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
    ctx.fill()
  }

  private drawBlock(gx: number, gy: number, topColor: string, rightColor: string, leftColor: string) {
    const inset = 0.05
    const bh = this.getBlockHeight(gx, gy)
    const ctx = this.ctx
    const c = [
      this.toIso(gx + inset, gy + inset),
      this.toIso(gx + 1 - inset, gy + inset),
      this.toIso(gx + 1 - inset, gy + 1 - inset),
      this.toIso(gx + inset, gy + 1 - inset)
    ]
    const backFaces: number[] = []
    const frontFaces: number[] = []
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4]
      if (a.x > b.x) frontFaces.push(i)
      else if (a.x < b.x) backFaces.push(i)
    }
    for (const i of backFaces) {
      const a = c[i], b = c[(i + 1) % 4]
      ctx.beginPath()
      ctx.moveTo(a.x, a.y - bh); ctx.lineTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x, b.y - bh)
      ctx.closePath()
      ctx.fillStyle = leftColor
      ctx.fill()
    }
    for (const i of frontFaces) {
      const a = c[i], b = c[(i + 1) % 4]
      const normalX = b.y - a.y
      ctx.beginPath()
      ctx.moveTo(a.x, a.y - bh); ctx.lineTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x, b.y - bh)
      ctx.closePath()
      ctx.fillStyle = normalX > 0 ? rightColor : leftColor
      ctx.fill()
    }
    ctx.beginPath()
    ctx.moveTo(c[0].x, c[0].y - bh)
    ctx.lineTo(c[1].x, c[1].y - bh)
    ctx.lineTo(c[2].x, c[2].y - bh)
    ctx.lineTo(c[3].x, c[3].y - bh)
    ctx.closePath()
    ctx.fillStyle = topColor
    ctx.fill()
  }
}
