// Iron Snake Mode board-shape generator.
//
// Produces an irregular, playable board shape inside a `gridSize x gridSize`
// bounding box. The result is a flat mask (`1` = playable, `0` = off-board /
// wall) that is guaranteed to be (a) a single 4-connected region and (b) free
// of corridors only 1-2 cells wide.
//
// Strategy: union of several overlapping rectangular "rooms", each with a
// minimum side of 3 (so nothing is thinner than 3 by construction), then prune
// to the largest connected component and reject any shape a 3x3 morphological
// open would alter (which happens exactly when a <3-wide sliver exists).

export type IronSnakeBoard = { mask: Uint8Array; area: number }

type Rng = () => number

const RETRY_CAP = 30
const MIN_ROOM = 3 // side >= 3 keeps every room wider than a 1-2 cell corridor
const TARGET_FILL_LO = 0.4
const TARGET_FILL_HI = 0.75
const MIN_GRID = 6 // below this a meaningful irregular shape can't be carved

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

function randInt(rng: Rng, lo: number, hi: number): number {
  // inclusive on both ends
  return lo + Math.floor(rng() * (hi - lo + 1))
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function fillRoom(mask: Uint8Array, n: number, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      mask[y * n + x] = 1
    }
  }
}

// Keep only the largest 4-connected component; return its cell count.
function keepLargestComponent(mask: Uint8Array, n: number): number {
  const total = n * n
  const comp = new Int32Array(total)
  comp.fill(-1)
  const stack: number[] = []
  let bestId = -1
  let bestSize = 0
  let curId = 0

  for (let i = 0; i < total; i++) {
    if (mask[i] !== 1 || comp[i] !== -1) continue
    let size = 0
    comp[i] = curId
    stack.length = 0
    stack.push(i)
    while (stack.length > 0) {
      const cell = stack.pop()!
      size++
      const x = cell % n
      const y = (cell - x) / n
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue
        const ni = ny * n + nx
        if (mask[ni] === 1 && comp[ni] === -1) {
          comp[ni] = curId
          stack.push(ni)
        }
      }
    }
    if (size > bestSize) {
      bestSize = size
      bestId = curId
    }
    curId++
  }

  for (let i = 0; i < total; i++) {
    if (mask[i] === 1 && comp[i] !== bestId) mask[i] = 0
  }
  return bestSize
}

// A 3x3 morphological open (erode then dilate). Cells outside the grid count as
// off-board, so the bounding-box edge behaves as a wall. `true` means the open
// left the mask unchanged, i.e. no cell sits in a corridor narrower than 3.
function passesMinWidth(mask: Uint8Array, n: number): boolean {
  const total = n * n
  const eroded = new Uint8Array(total)

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let all = true
      for (let dy = -1; dy <= 1 && all; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= n || ny < 0 || ny >= n || mask[ny * n + nx] !== 1) {
            all = false
            break
          }
        }
      }
      eroded[y * n + x] = all ? 1 : 0
    }
  }

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let any = false
      for (let dy = -1; dy <= 1 && !any; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue
          if (eroded[ny * n + nx] === 1) {
            any = true
            break
          }
        }
      }
      const opened = any ? 1 : 0
      if (opened !== mask[y * n + x]) return false
    }
  }
  return true
}

// Collect indices of all currently on-board cells (for anchor selection).
function onBoardCells(mask: Uint8Array): number[] {
  const cells: number[] = []
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1) cells.push(i)
  }
  return cells
}

/**
 * Generate a random Iron Snake board mask for a `gridSize x gridSize` board.
 * Returns `null` if no valid shape could be produced within the retry budget;
 * callers should fall back to a full rectangle in that case.
 */
export function generateIronSnakeBoard(gridSize: number, rng: Rng = Math.random): IronSnakeBoard | null {
  const n = gridSize
  if (n < MIN_GRID) return null

  const total = n * n
  const maxRoom = Math.max(MIN_ROOM, Math.floor(n * 0.6))

  for (let attempt = 0; attempt < RETRY_CAP; attempt++) {
    const mask = new Uint8Array(total)

    // First room near the center so the shape is roughly centered.
    const fw = randInt(rng, MIN_ROOM, Math.min(maxRoom, n))
    const fh = randInt(rng, MIN_ROOM, Math.min(maxRoom, n))
    const fx = clamp(Math.floor(n / 2 - fw / 2) + randInt(rng, -1, 1), 0, n - fw)
    const fy = clamp(Math.floor(n / 2 - fh / 2) + randInt(rng, -1, 1), 0, n - fh)
    fillRoom(mask, n, fx, fy, fw, fh)

    const roomCount = randInt(rng, 3, 6)
    for (let r = 1; r < roomCount; r++) {
      const cells = onBoardCells(mask)
      const anchor = cells[randInt(rng, 0, cells.length - 1)]
      const ax = anchor % n
      const ay = (anchor - ax) / n
      const w = randInt(rng, MIN_ROOM, Math.min(maxRoom, n))
      const h = randInt(rng, MIN_ROOM, Math.min(maxRoom, n))
      // Position the room so it covers the anchor cell -> guaranteed overlap.
      const x0 = clamp(ax - randInt(rng, 0, w - 1), 0, n - w)
      const y0 = clamp(ay - randInt(rng, 0, h - 1), 0, n - h)
      fillRoom(mask, n, x0, y0, w, h)
    }

    const area = keepLargestComponent(mask, n)
    const fill = area / total
    if (fill < TARGET_FILL_LO || fill > TARGET_FILL_HI) continue
    if (!passesMinWidth(mask, n)) continue

    return { mask, area }
  }

  return null
}
