import type { Direction } from '../game-types'
import type { BotHelpers, BotState, SnakeBot } from './bot-types'
import { minDistToBody, scorePowerUp, type PowerUpAppetite } from './power-up'

// Nomad craves fresh territory, so it detours for a power-up sitting out in the
// open but declines one hugging its own trail (consistent with its bodyProximity
// aversion).
const POWERUP_APPETITE: PowerUpAppetite = {
  weight: 0.9,
  gate: ({ state, pu }) => minDistToBody(pu, state.snake) > 1,
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

  // Count how many body segments are near the candidate position.
  // The nomad wants to move AWAY from its own body trail.
  let bodyProximity = 0
  for (const segment of state.snake) {
    const dist = Math.abs(nextHead.x - segment.x) + Math.abs(nextHead.y - segment.y)
    if (dist <= 2) {
      bodyProximity += 3 - dist // closer segments penalized more (3, 2, 1)
    }
  }

  let score = 0

  // Always eat food we land on
  score += ateFood ? 25000 : 0

  // Pursue food but not as aggressively as a hunter
  score += analysis.pathToFood !== null ? 6000 - analysis.pathToFood * 40 : -5000
  score -= distanceToFood * 8

  // Core nomad behavior: strongly penalize moves near our own body trail
  score -= bodyProximity * 400

  // Reward open space — nomads love freedom
  score += analysis.reachableArea * 15

  // Slight momentum to keep moving forward into new territory
  if (direction === state.direction) {
    score += 8
  }

  score += scorePowerUp(state, analysis, direction, POWERUP_APPETITE)

  return score
}

export const nomadBot: SnakeBot = {
  id: 'nomad',
  name: 'Nomad',
  description: 'Avoids its own trail to explore fresh territory, grabbing food along the way.',
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
