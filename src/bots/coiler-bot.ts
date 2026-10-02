import type { Direction } from '../game-types'
import type { BotHelpers, BotState, SnakeBot } from './bot-types'
import { scorePowerUp, type PowerUpAppetite } from './power-up'

// Coiling packs the body tight, which is exactly what makes a growing snake
// self-trap — so Shrink is gold to the Coiler (and the helper scales it further
// with length). Double Points / Slow-Mo don't help its compactness, so they're
// heavily discounted.
const POWERUP_APPETITE: PowerUpAppetite = {
  weight: 0.8,
  typeBias: { shrink: 2.2, double: 0.3, slow: 0.3 },
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

  // Count how many of the 4 neighbors are occupied by the snake's own body.
  // Higher adjacency = tighter coil, keeping the body compact and organized.
  let bodyAdjacency = 0
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const nx = nextHead.x + dx
    const ny = nextHead.y + dy
    for (let i = 1; i < simulatedSnake.length; i++) {
      if (simulatedSnake[i].x === nx && simulatedSnake[i].y === ny) {
        bodyAdjacency++
        break
      }
    }
  }

  let score = 0
  score += analysis.reachableArea * 15
  score += analysis.canReachTail ? 80000 : -100000
  score += ateFood ? 20000 : 0
  score += analysis.pathToFood !== null ? 4000 - analysis.pathToFood * 15 : -3000
  score -= distanceToFood * 8
  score += bodyAdjacency * 3000
  score += scorePowerUp(state, analysis, direction, POWERUP_APPETITE)
  return score
}

export const coilerBot: SnakeBot = {
  id: 'coiler',
  name: 'Coiler',
  description: 'Hugs its own body to stay compact and methodical, coiling tightly while collecting food.',
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
