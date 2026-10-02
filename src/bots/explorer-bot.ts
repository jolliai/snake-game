import type { Direction } from '../game-types'
import type { BotHelpers, BotState, SnakeBot } from './bot-types'
import { distToEdge, scorePowerUp, type PowerUpAppetite } from './power-up'

// Explorer roams open lanes and keeps off the walls, so a power-up is a natural
// waypoint — but only one out in the open. It skips pickups hugging a wall
// (consistent with its wall-margin aversion) and favours the calm effects.
const POWERUP_APPETITE: PowerUpAppetite = {
  weight: 1,
  typeBias: { slow: 1.3, shrink: 1.3 },
  gate: ({ state, pu }) => distToEdge(pu, state.gridSize) > Math.floor(state.gridSize * 0.15),
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
  const marginToWall = Math.min(
    nextHead.x,
    nextHead.y,
    state.gridSize - 1 - nextHead.x,
    state.gridSize - 1 - nextHead.y
  )

  let score = 0
  score += analysis.reachableArea * 35
  score += marginToWall * 120
  score += analysis.canReachTail ? 90000 : -100000
  score += ateFood ? 8000 : 0
  score += analysis.pathToFood !== null ? 2500 - analysis.pathToFood * 8 : -1500
  score += scorePowerUp(state, analysis, direction, POWERUP_APPETITE)
  return score
}

export const explorerBot: SnakeBot = {
  id: 'explorer',
  name: 'Explorer',
  description: 'Roams open lanes and keeps distance from walls for a calmer, lower-risk style.',
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
