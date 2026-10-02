import type { Direction } from '../game-types'
import type { BotHelpers, BotState, SnakeBot } from './bot-types'
import { scorePowerUp, type PowerUpAppetite } from './power-up'

// Edge Runner patrols the perimeter, so it grabs a power-up eagerly when it sits
// near a wall (on its route) and stays disciplined when one spawns deep in the
// interior — the same logic it applies to food via `foodNearWall`.
const POWERUP_APPETITE: PowerUpAppetite = {
  weight: 1,
  gate: ({ state, pu }) => {
    const edge = Math.min(pu.x, pu.y, state.gridSize - 1 - pu.x, state.gridSize - 1 - pu.y)
    return edge <= Math.floor(state.gridSize * 0.2)
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

  // Reward proximity to walls — minimum distance to any edge.
  const distToEdge = Math.min(
    nextHead.x,
    nextHead.y,
    state.gridSize - 1 - nextHead.x,
    state.gridSize - 1 - nextHead.y
  )
  const wallProximity = Math.max(0, 3 - distToEdge) // 3 when on edge, 0 when 3+ cells away

  // Scale wall bonus down when food is far from edges — allows inward dives.
  const foodDistToEdge = Math.min(
    state.food.x,
    state.food.y,
    state.gridSize - 1 - state.food.x,
    state.gridSize - 1 - state.food.y
  )
  const edgeZone = Math.floor(state.gridSize * 0.2)
  const foodNearWall = foodDistToEdge <= edgeZone

  let score = 0
  score += analysis.reachableArea * 18
  score += analysis.canReachTail ? 85000 : -100000
  score += ateFood ? 25000 : 0
  score += analysis.pathToFood !== null ? 5000 - analysis.pathToFood * 20 : -2500
  score -= distanceToFood * 10
  // Only hug walls when food is nearby on the perimeter; otherwise chase food.
  if (foodNearWall) {
    score += wallProximity * 2500
    if (direction === state.direction) {
      score += 500
    }
  }
  score += scorePowerUp(state, analysis, direction, POWERUP_APPETITE)
  return score
}

export const edgeRunnerBot: SnakeBot = {
  id: 'edge-runner',
  name: 'Edge Runner',
  description: 'Patrols the perimeter and hugs walls, sweeping inward only to grab food.',
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
