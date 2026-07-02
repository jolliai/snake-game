import type { Direction, Position } from '../game-types'
import type { BotHelpers, BotState } from './bot-types'

// The bots are stateless, per-tick greedy scorers with no memory, no randomness,
// and no tie-breaking. Given an identical board configuration they always pick
// the same direction, so any positional cycle is stable: a bot that approaches a
// tight pocket, correctly refuses to enter, and retreats will re-select the exact
// same losing approach forever. Iron Snake's irregular boards create many such
// pockets, so the oscillation shows up there most.
//
// The loop guard is the memory + variation the bot layer lacks. It lives at the
// harness level so all bots benefit without being rewritten. It tracks recently
// visited head cells, detects when the snake keeps returning to the same cell,
// and — only then — overrides the bot's choice with a move toward the
// least-recently-visited safe cell to break the cycle. Normal play is untouched.

const HISTORY_WINDOW = 40
// A cell revisited this many times inside the window is a tight loop, not progress.
const REVISIT_THRESHOLD = 3
// Confinement detection catches larger circuits that the revisit count misses:
// on a period-P loop no cell recurs 3x until 3P moves, so a ~20-cell "approach,
// give up, wander back, repeat" cycle would slip past a pure revisit counter.
// Instead, once we have enough samples, a low ratio of distinct cells to moves
// means the snake is circling/backtracking rather than making progress.
const CONFINEMENT_SAMPLES = 24
const CONFINEMENT_RATIO = 0.7
// Once escaping, commit for a few ticks so the snake actually leaves the pocket
// instead of immediately being pulled back by the bot's deterministic scoring.
export const ESCAPE_DURATION = 8

export type LoopMemory = {
  recentHeads: string[]
  escapeTicks: number
}

export function createLoopMemory(): LoopMemory {
  return { recentHeads: [], escapeTicks: 0 }
}

// Called on progress (food eaten, level advance, reposition, restart): the
// situation has genuinely changed, so past oscillation history is irrelevant.
export function resetLoopMemory(mem: LoopMemory): void {
  mem.recentHeads.length = 0
  mem.escapeTicks = 0
}

export function recordHead(mem: LoopMemory, head: Position): void {
  mem.recentHeads.push(`${head.x},${head.y}`)
  if (mem.recentHeads.length > HISTORY_WINDOW) {
    mem.recentHeads.shift()
  }
}

// True when the snake is cycling rather than progressing. Two signals: a tight
// oscillation (some cell hit REVISIT_THRESHOLD+ times), or confinement (over a
// full window, too few distinct cells relative to moves — a larger circuit or
// approach/retreat loop). During normal forward play each move reaches a new
// cell, so the distinct ratio stays near 1 and neither signal fires.
export function isLooping(mem: LoopMemory): boolean {
  const heads = mem.recentHeads
  if (heads.length < REVISIT_THRESHOLD) return false

  const current = heads[heads.length - 1]
  let count = 0
  for (const key of heads) {
    if (key === current) count++
  }
  if (count >= REVISIT_THRESHOLD) return true

  if (heads.length >= CONFINEMENT_SAMPLES) {
    const distinct = new Set(heads).size
    if (distinct / heads.length <= CONFINEMENT_RATIO) return true
  }
  return false
}

// The variation step. Among legal, non-suicidal candidate directions, pick the
// one whose resulting head cell has been visited least recently, driving the
// snake toward unexplored space. Ties broken randomly so identical
// configurations no longer resolve identically. Returns null if no safe move
// exists, in which case the harness keeps the bot's original pick.
export function chooseEscapeDirection(
  state: BotState,
  helpers: BotHelpers,
  mem: LoopMemory
): Direction | null {
  const visitCounts = new Map<string, number>()
  for (const key of mem.recentHeads) {
    visitCounts.set(key, (visitCounts.get(key) ?? 0) + 1)
  }

  type Candidate = { direction: Direction; visits: number; area: number; canReachTail: boolean }
  const candidates: Candidate[] = []

  for (const direction of helpers.getCandidateDirections(state.direction)) {
    const simulated = helpers.simulateMove(state.snake, direction, state.food)
    if (!simulated) continue

    const nextHead = simulated[0]
    const tail = simulated[simulated.length - 1]
    const analysis = helpers.analyzePosition(nextHead, simulated, { tail, food: state.food })
    candidates.push({
      direction,
      visits: visitCounts.get(`${nextHead.x},${nextHead.y}`) ?? 0,
      area: analysis.reachableArea,
      canReachTail: analysis.canReachTail
    })
  }

  if (candidates.length === 0) return null

  // Prefer moves that don't trap the snake; only if none can reach the tail do
  // we fall back to the whole set (and lean on open space instead).
  const safe = candidates.filter(c => c.canReachTail)
  const pool = safe.length > 0 ? safe : candidates

  let best: Candidate[] = []
  let bestVisits = Infinity
  let bestArea = -Infinity
  for (const c of pool) {
    if (c.visits < bestVisits || (c.visits === bestVisits && c.area > bestArea)) {
      best = [c]
      bestVisits = c.visits
      bestArea = c.area
    } else if (c.visits === bestVisits && c.area === bestArea) {
      best.push(c)
    }
  }

  const pick = best[Math.floor(Math.random() * best.length)]
  return pick.direction
}

// Wraps a bot's chosen direction with loop detection. The escape is a temporary
// detour, not a new permanent mode: on a fresh loop detection the guard commits
// to escape moves for ESCAPE_DURATION ticks, then hands control straight back to
// the bot's own algorithm. Returns the direction to use (never null when
// `botDirection` is non-null).
export function applyLoopGuard(
  mem: LoopMemory,
  state: BotState,
  helpers: BotHelpers,
  botDirection: Direction | null
): Direction | null {
  recordHead(mem, state.snake[0])

  // Only *start* an escape when a new loop is detected and we're not already in
  // one — otherwise the timer would reset every tick and the escape would never
  // end, trapping the snake in escape mode instead of returning to the bot.
  if (mem.escapeTicks === 0 && isLooping(mem)) {
    mem.escapeTicks = ESCAPE_DURATION
  }

  if (mem.escapeTicks > 0) {
    const escape = chooseEscapeDirection(state, helpers, mem)
    mem.escapeTicks--
    // Escape window just closed: wipe the visit history so the bot resumes its
    // own algorithm with a clean slate rather than immediately re-detecting the
    // same stale loop and escaping again. It can still re-trigger later if a
    // genuinely new loop forms.
    if (mem.escapeTicks === 0) mem.recentHeads.length = 0
    return escape ?? botDirection
  }

  return botDirection
}
