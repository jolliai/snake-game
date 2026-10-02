import type { Direction, Position, PowerUpType } from '../game-types'

// A power-up collectible visible to the bots, plus how many ticks it will remain
// on the board before it despawns (used to discount pursuit of one that will
// vanish before the snake can reach it).
export type BotPowerUp = {
  x: number
  y: number
  type: PowerUpType
  ticksLeft: number
}

export type BotState = {
  snake: Position[]
  food: Position
  gridSize: number
  direction: Direction
  opponentSnake?: Position[]
  // The on-board power-up, if any (single-player only). Absent/null means none.
  powerUp?: BotPowerUp | null
}

export type AnalysisResult = {
  reachableArea: number
  canReachTail: boolean
  pathToFood: number | null
  // BFS steps from `start` to the power-up, or null if none / unreachable. Only
  // populated when a `powerUp` target is passed to analyzePosition.
  pathToPowerUp: number | null
}

export type BotHelpers = {
  simulateMove: (snake: Position[], direction: Direction, food: Position) => Position[] | null
  analyzePosition: (
    start: Position,
    snake: Position[],
    targets: { tail: Position; food: Position; powerUp?: Position }
  ) => AnalysisResult
  getCandidateDirections: (currentDirection: Direction) => Direction[]
}

export type SnakeBot = {
  id: string
  name: string
  description: string
  chooseDirection: (state: BotState, helpers: BotHelpers) => Direction | null
}
