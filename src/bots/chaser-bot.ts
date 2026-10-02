import type { Direction } from '../game-types'
import type { BotHelpers, BotState, SnakeBot } from './bot-types'
import { scorePowerUp, type PowerUpAppetite } from './power-up'

// Chaser is a shortest-path aggressor, so a power-up is just another target to
// race toward — the helper naturally favours whichever (food or power-up) the
// move heads toward more cheaply. Leans on Double Points / Slow-Mo.
const POWERUP_APPETITE: PowerUpAppetite = {
  weight: 1.3,
  typeBias: { double: 1.2, slow: 1.2 },
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
  const distanceToTail = Math.abs(nextHead.x - tail.x) + Math.abs(nextHead.y - tail.y)

  // If we can't reach the tail after this move, the path to food is a trap.
  // Fall back to tail-chasing: prefer moves that keep the tail reachable and
  // maximise open space so the snake can survive until food becomes safe.
  if (!analysis.canReachTail) {
    return -200000 + analysis.reachableArea * 20 - distanceToTail * 5
  }

  let score = 0

  // Big reward for eating food
  score += ateFood ? 30000 : 0

  // Strongly prefer the shortest BFS path to food
  score += analysis.pathToFood !== null ? 15000 - analysis.pathToFood * 80 : -8000

  // Tie-break by manhattan distance so we always close the gap
  score -= distanceToFood * 15

  // Keep enough space to manoeuvre, but weigh it less than food pursuit
  score += analysis.reachableArea * 4

  // Tail-chasing fallback bonus: when no clear food path, drift toward tail
  if (analysis.pathToFood === null) {
    score -= distanceToTail * 10
  }

  // Slight momentum bonus to avoid unnecessary wiggling
  if (direction === state.direction) {
    score += 3
  }

  // Chase a reachable power-up as hard as food.
  score += scorePowerUp(state, analysis, direction, POWERUP_APPETITE)

  return score
}

export const chaserBot: SnakeBot = {
  id: 'chaser',
  name: 'Chaser',
  description: 'Follows the shortest path to food aggressively, falling back to tail-chasing when the path is unsafe.',
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
