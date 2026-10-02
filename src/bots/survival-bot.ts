import type { Direction } from '../game-types'
import type { BotHelpers, BotState, SnakeBot } from './bot-types'
import { scorePowerUp, type PowerUpAppetite } from './power-up'

// Survival is cautious: it prizes the power-ups that aid survival — Shrink (more
// open space) and Slow-Mo — and only diverts when the move still keeps its tail
// reachable (its whole ethos). Double Points is a minor bonus at best.
const POWERUP_APPETITE: PowerUpAppetite = {
  weight: 0.7,
  typeBias: { shrink: 1.8, slow: 1.6, double: 0.6 },
  gate: ({ analysis }) => analysis.canReachTail,
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

  let score = 0
  score += analysis.reachableArea * 25
  score += analysis.canReachTail ? 100000 : -100000
  score += ateFood ? 30000 : 0
  score += analysis.pathToFood !== null ? 6000 - analysis.pathToFood * 25 : -2000
  score -= distanceToFood * 5
  if (direction === state.direction) {
    score += 10
  }
  score += scorePowerUp(state, analysis, direction, POWERUP_APPETITE)
  return score
}

export const survivalBot: SnakeBot = {
  id: 'survival',
  name: 'Survival',
  description: 'Stays alive by maximizing open space and avoiding dead ends before chasing food.',
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
