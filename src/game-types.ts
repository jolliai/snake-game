export type Position = { x: number; y: number }
export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'

// Power-up kinds (single-player). Defined here so both the game and the bot
// layer can refer to them without a circular import through main.ts.
export type PowerUpType = 'double' | 'slow' | 'shrink'

export const DIRECTIONS: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT']

export const DIRECTION_VECTORS: Record<Direction, Position> = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 }
}

export const OPPOSITE_DIRECTIONS: Record<Direction, Direction> = {
  UP: 'DOWN',
  DOWN: 'UP',
  LEFT: 'RIGHT',
  RIGHT: 'LEFT'
}
