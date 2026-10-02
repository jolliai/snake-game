import type { Direction } from '../game-types'
import type { BotHelpers, BotState, SnakeBot } from './bot-types'
import { scorePowerUp, type PowerUpAppetite } from './power-up'

/**
 * Determines the ideal sweep direction for a given row.
 * Even rows sweep RIGHT, odd rows sweep LEFT — creating a lawnmower pattern.
 */
function sweepDirection(row: number): Direction {
  return row % 2 === 0 ? 'RIGHT' : 'LEFT'
}

// Sweeper's lawnmower already covers every cell, so it'll pass over power-ups on
// its own — it just gets a light nudge onto one on the current or adjacent row,
// never breaking coverage to chase a distant one. Values Shrink most.
const POWERUP_APPETITE: PowerUpAppetite = {
  weight: 0.6,
  typeBias: { shrink: 1.5 },
  gate: ({ state, pu }) => Math.abs(pu.y - state.snake[0].y) <= 1,
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

  // Safety first — must be able to reach tail
  if (!analysis.canReachTail) {
    return -200000 + analysis.reachableArea * 20
  }

  let score = 0

  // Always eat adjacent food
  score += ateFood ? 30000 : 0

  // Pursue food with moderate urgency
  score += analysis.pathToFood !== null ? 6000 - analysis.pathToFood * 30 : -2000

  // Keep breathing room
  score += analysis.reachableArea * 8

  // Sweep pattern preference: favor the lawnmower direction for current row
  const head = state.snake[0]
  const idealHorizontal = sweepDirection(head.y)

  // At the end of a row, prefer moving DOWN to the next row
  const atRowEnd =
    (idealHorizontal === 'RIGHT' && head.x >= state.gridSize - 2) ||
    (idealHorizontal === 'LEFT' && head.x <= 1)

  if (atRowEnd && direction === 'DOWN') {
    // Turn down to next row
    score += 400
  } else if (!atRowEnd && direction === idealHorizontal) {
    // Continue sweeping across the row
    score += 400
  }

  // Mild penalty for going UP — we want to sweep top-to-bottom
  if (direction === 'UP') {
    score -= 150
  }

  score += scorePowerUp(state, analysis, direction, POWERUP_APPETITE)

  return score
}

export const sweeperBot: SnakeBot = {
  id: 'sweeper',
  name: 'Sweeper',
  description: 'Methodically covers the grid in a back-and-forth lawnmower pattern, sweeping rows from top to bottom.',
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
