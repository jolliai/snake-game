import type { Direction, PowerUpType } from '../game-types'
import type { AnalysisResult, BotPowerUp, BotState } from './bot-types'

// Shared power-up pursuit layer for the bots. Each bot adds ONE line —
// `score += scorePowerUp(state, analysis, direction, APPETITE)` — with its own
// personality-tuned APPETITE, so the roster's distinct styles are preserved
// instead of every bot beelining for the shiny thing.
//
// Three inviolable rules (see the values below):
//   1. The bonus never overrides survival. Every bot hard-gates `canReachTail`
//      at ±100000/200000; the max bonus here stays well under that, so a
//      power-up can bias a choice but never justify a self-trap.
//   2. Value = typeValue × proximity × weight, discounted to zero when the
//      pickup is unreachable or will despawn before the snake can arrive.
//   3. A bot with weight 0 (or that gates the pickup out) simply scores 0 and
//      behaves exactly as it did before power-ups existed.

// Base per-type worth, before a bot's own typeBias. Shrink is additionally
// scaled by snake length (see shrinkLengthFactor): the longer the snake, the
// more a shrink is worth for escaping self-trapping.
const BASE_TYPE_VALUE: Record<PowerUpType, number> = {
  double: 1,
  slow: 1,
  shrink: 1,
}

const EAT_BONUS = 3500 // landing on the power-up with this move
const REACH_BASE = 2600 // worth of a power-up one step away...
const REACH_DECAY = 55 // ...decaying per BFS step, so distant pickups fade out

export type PowerUpGateCtx = {
  state: BotState
  analysis: AnalysisResult
  direction: Direction
  pu: BotPowerUp
  path: number // BFS steps from the candidate head to the power-up (0 = on it)
}

export type PowerUpAppetite = {
  // Overall pursuit strength. 0 ignores power-ups; ~1 pursues about as hard as
  // food; >1 will divert off food for them.
  weight: number
  // Per-type multiplier on top of the base value (absent types default to 1).
  typeBias?: Partial<Record<PowerUpType, number>>
  // Optional personality gate: return false to decline pursuit for this move.
  gate?: (ctx: PowerUpGateCtx) => boolean
}

// 1.0 for a short snake, ramping to ~2.5 once it's long enough to fear itself.
function shrinkLengthFactor(len: number): number {
  return 1 + Math.min(1.5, len / 12)
}

/** Manhattan distance from a point to the nearest board edge. */
export function distToEdge(p: { x: number; y: number }, gridSize: number): number {
  return Math.min(p.x, p.y, gridSize - 1 - p.x, gridSize - 1 - p.y)
}

/** Manhattan distance from a point to the closest snake segment. */
export function minDistToBody(p: { x: number; y: number }, snake: { x: number; y: number }[]): number {
  let min = Infinity
  for (const s of snake) {
    const d = Math.abs(p.x - s.x) + Math.abs(p.y - s.y)
    if (d < min) min = d
  }
  return min
}

/**
 * The pursuit bonus a candidate move earns for heading toward (or onto) the
 * on-board power-up. Returns 0 when there is no power-up, it's unreachable after
 * this move, it will vanish before the snake arrives, or the bot's gate declines
 * it. `analysis` must have been produced with the power-up passed as a target
 * (so `pathToPowerUp` is populated).
 */
export function scorePowerUp(
  state: BotState,
  analysis: AnalysisResult,
  direction: Direction,
  appetite: PowerUpAppetite
): number {
  const pu = state.powerUp
  if (!pu || appetite.weight <= 0) return 0

  const path = analysis.pathToPowerUp
  if (path === null) return 0 // unreachable after this move
  if (path > pu.ticksLeft) return 0 // it will blink out before we get there

  if (appetite.gate && !appetite.gate({ state, analysis, direction, pu, path })) {
    return 0
  }

  let typeValue = BASE_TYPE_VALUE[pu.type] * (appetite.typeBias?.[pu.type] ?? 1)
  if (pu.type === 'shrink') typeValue *= shrinkLengthFactor(state.snake.length)

  const proximity = path === 0 ? EAT_BONUS : Math.max(0, REACH_BASE - path * REACH_DECAY)
  return appetite.weight * typeValue * proximity
}
