export type LeaderboardMode = 'single' | 'pvp' | 'bvb' | 'rainbow'

export type GameResult = 'win' | 'loss' | 'draw'

export type LeaderboardEntry = {
  name: string
  score: number
  longestSnake: number
  survivalSeconds: number
  timestamp: number
  result?: GameResult
  opponent?: string
}

export const MAX_ENTRIES = 10
export const MAX_NAME_LENGTH = 16

const STORAGE_PREFIX = 'snake-leaderboard-v1'

const storageKey = (mode: LeaderboardMode) => `${STORAGE_PREFIX}:${mode}`

export function getLeaderboard(mode: LeaderboardMode): LeaderboardEntry[] {
  const raw = localStorage.getItem(storageKey(mode))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isLeaderboardEntry)
  } catch {
    return []
  }
}

function isLeaderboardEntry(value: unknown): value is LeaderboardEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.name === 'string' &&
    typeof entry.score === 'number' &&
    typeof entry.longestSnake === 'number' &&
    typeof entry.survivalSeconds === 'number' &&
    typeof entry.timestamp === 'number'
  )
}

// Entries sort by score desc, then longestSnake desc, then survivalSeconds desc.
function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  if (b.score !== a.score) return b.score - a.score
  if (b.longestSnake !== a.longestSnake) return b.longestSnake - a.longestSnake
  return b.survivalSeconds - a.survivalSeconds
}

// Returns the new rank (1-based) if the entry made the board, else null.
export function addEntry(mode: LeaderboardMode, entry: LeaderboardEntry): number | null {
  const entries = getLeaderboard(mode)
  entries.push(entry)
  entries.sort(compareEntries)
  const trimmed = entries.slice(0, MAX_ENTRIES)
  const rank = trimmed.indexOf(entry)
  if (rank === -1) return null
  localStorage.setItem(storageKey(mode), JSON.stringify(trimmed))
  return rank + 1
}

// Whether an entry with this score (and tiebreakers) would make the top N.
export function qualifies(
  mode: LeaderboardMode,
  score: number,
  longestSnake: number,
  survivalSeconds: number
): boolean {
  const entries = getLeaderboard(mode)
  if (entries.length < MAX_ENTRIES) return true
  const candidate: LeaderboardEntry = {
    name: '',
    score,
    longestSnake,
    survivalSeconds,
    timestamp: 0
  }
  return compareEntries(candidate, entries[MAX_ENTRIES - 1]) < 0
}

export function clearLeaderboard(mode: LeaderboardMode) {
  localStorage.removeItem(storageKey(mode))
}

export function sanitizeName(input: string): string {
  return input.trim().slice(0, MAX_NAME_LENGTH) || 'Anonymous'
}

export const MODE_LABELS: Record<LeaderboardMode, string> = {
  single: 'Single Player',
  pvp: 'Two Player',
  bvb: 'Bot vs Bot',
  // Hidden Rainbow Snake board (JOE-7): collects every score made during a rare
  // rainbow game, across all modes. Its tab stays hidden until it has an entry.
  rainbow: '🌈 Rainbow Snake'
}
