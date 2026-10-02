import type { Direction } from '../game-types'
import type { BotHelpers, BotState, SnakeBot } from './bot-types'
import { scorePowerUp, type PowerUpAppetite } from './power-up'

// Clockwise turn order: UP -> RIGHT -> DOWN -> LEFT -> UP
const CLOCKWISE: Record<Direction, Direction> = {
  UP: 'RIGHT',
  RIGHT: 'DOWN',
  DOWN: 'LEFT',
  LEFT: 'UP'
}

// Spiral won't break its arc for a power-up: it only grabs one when landing on
// it, or when the clockwise/straight move it would make anyway also heads toward
// it. Low weight keeps the sweep intact.
const POWERUP_APPETITE: PowerUpAppetite = {
  weight: 0.5,
  gate: ({ state, direction, path }) =>
    path === 0 || direction === state.direction || direction === CLOCKWISE[state.direction],
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

  if (!analysis.canReachTail) {
    return -200000 + analysis.reachableArea * 20
  }

  // How close is the head to the nearest wall? Spiral wants to hug inward.
  const distToWallX = Math.min(nextHead.x, state.gridSize - 1 - nextHead.x)
  const distToWallY = Math.min(nextHead.y, state.gridSize - 1 - nextHead.y)
  const minWallDist = Math.min(distToWallX, distToWallY)

  let score = 0

  // Always eat food
  score += ateFood ? 25000 : 0

  // Moderate food pursuit
  score += analysis.pathToFood !== null ? 7000 - analysis.pathToFood * 40 : -5000
  score -= distanceToFood * 8

  // Core spiral behavior: prefer clockwise turns to create spiral movement.
  // Going straight is second best, counter-clockwise is last resort.
  const clockwiseTurn = CLOCKWISE[state.direction]
  if (direction === clockwiseTurn) {
    score += 800
  } else if (direction === state.direction) {
    score += 1200 // Prefer straight until we need to turn
  }
  // Counter-clockwise gets no bonus, naturally deprioritized

  // When near a wall, strongly prefer the clockwise turn to spiral inward
  if (minWallDist <= 1 && direction === clockwiseTurn) {
    score += 2000
  }

  // Keep enough space
  score += analysis.reachableArea * 8

  score += scorePowerUp(state, analysis, direction, POWERUP_APPETITE)

  return score
}

export const spiralBot: SnakeBot = {
  id: 'spiral',
  name: 'Spiral',
  description: 'Moves in clockwise spiral patterns, turning inward at walls to sweep the grid.',
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
  }
}
