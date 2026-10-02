import type { Direction } from '../game-types'
import type { BotHelpers, BotState, SnakeBot } from './bot-types'
import { scorePowerUp, type PowerUpAppetite } from './power-up'

const PERPENDICULAR: Record<Direction, Direction[]> = {
  UP: ['LEFT', 'RIGHT'],
  DOWN: ['LEFT', 'RIGHT'],
  LEFT: ['UP', 'DOWN'],
  RIGHT: ['UP', 'DOWN'],
}

// Zigzag grabs a power-up that falls within its weave — a perpendicular turn (or
// landing right on it) — and, like its food logic, avoids ones jammed against a
// wall where weaving gets it trapped.
const POWERUP_APPETITE: PowerUpAppetite = {
  weight: 0.8,
  gate: ({ state, direction, pu, path }) => {
    const onWeave = path === 0 || (PERPENDICULAR[state.direction]?.includes(direction) ?? false)
    const edge = Math.min(pu.x, pu.y, state.gridSize - 1 - pu.x, state.gridSize - 1 - pu.y)
    return onWeave && edge > 1
  },
}

function scoreDirection(state: BotState, helpers: BotHelpers, direction: Direction): number {
  const simulatedSnake = helpers.simulateMove(state.snake, direction, state.food)
  if (!simulatedSnake) {
    return -Infinity
  }

  const nextHead = simulatedSnake[0]
  const ateFood = nextHead.x === state.food.x && nextHead.y === state.food.y
  const tail = simulatedSnake[simulatedSnake.length - 1]

  const analysis = helpers.analyzePosition(nextHead, simulatedSnake, { tail, food: state.food, powerUp: state.powerUp ?? undefined })
  const distanceToFood = Math.abs(nextHead.x - state.food.x) + Math.abs(nextHead.y - state.food.y)

  // Safety first — must be able to reach tail
  if (!analysis.canReachTail) {
    return -200000 + analysis.reachableArea * 20
  }

  let score = 0

  // Always eat adjacent food
  score += ateFood ? 30000 : 0

  // Pursue food via BFS path
  score += analysis.pathToFood !== null ? 8000 - analysis.pathToFood * 40 : -3000
  score -= distanceToFood * 15

  // Keep enough breathing room
  score += analysis.reachableArea * 8

  // Zigzag preference: favor perpendicular turns over continuing straight
  // This creates the distinctive weaving pattern
  const isPerpendicular = PERPENDICULAR[state.direction]?.includes(direction)
  if (isPerpendicular) {
    score += 500
  }

  // Avoid walls — zigzagging near edges gets you trapped
  const wallMargin = Math.min(
    nextHead.x,
    nextHead.y,
    state.gridSize - 1 - nextHead.x,
    state.gridSize - 1 - nextHead.y,
  )
  if (wallMargin <= 1) {
    score -= 300
  }

  score += scorePowerUp(state, analysis, direction, POWERUP_APPETITE)

  return score
}

export const zigzagBot: SnakeBot = {
  id: 'zigzag',
  name: 'Zigzag',
  description: 'Weaves back and forth in a sawtooth pattern, alternating perpendicular turns while advancing toward food.',
  chooseDirection(state, helpers) {
    const candidates = helpers.getCandidateDirections(state.direction)
    let bestDirection: Direction | null = null
    let bestScore = -Infinity

    for (const direction of candidates) {
      const score = scoreDirection(state, helpers, direction)
      if (score > bestScore) {
        bestScore = score
        bestDirection = direction
      }
    }

    return bestDirection
  },
}
