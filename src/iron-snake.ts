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
const TARGET_FILL_MID = (TARGET_FILL_LO + TARGET_FILL_HI) / 2 // typical playable fraction (~0.575)
const MIN_GRID = 6 // below this a meaningful irregular shape can't be carved

// Interior holes (JOE-6). After a solid, valid shape is carved we punch a few
// small holes into its middle that the snake must navigate around. Holes are
// kept subtle — small footprints, count scaled to the board area — and every
// candidate is validated against the SAME two invariants the base shape
// guarantees: the playable region stays a single 4-connected component (so all
// food is reachable) and no <3-wide corridor is created (passesMinWidth).
// Because passesMinWidth rejects any hole placed within a cell of another wall,
// surviving holes are always genuine, well-separated interior gaps. Area scales
// with Iron Snake level, so later boards get more holes for free.
const HOLE_MAX = 8 // absolute cap on holes attempted per board
const HOLE_RETRY_CAP = 40 // placement tries per target hole; deep-interior anchors are a
// minority on a lean board and larger footprints fail the invariants often, so
// a generous budget is needed to reliably hit the target. Attempts are ~O(n^2)
// and sub-millisecond, and the loop stops as soon as `target` holes are placed.
const HOLE_MAX_DIM = 5 // largest hole side; reached only at higher levels
const HOLE_SPACING_CELLS = 22 // ~playable cells a hole+margin consumes; caps count on small boards

// Holes scale with the Iron Snake level: later (larger) boards get more of them,
// and their max footprint grows too, so the interior stays interesting as the
// arena expands. Each hole's actual size is randomised up to the per-level cap,
// giving a mix of small gaps and larger cavities.
function holeCountForLevel(level: number, area: number): number {
  const byLevel = 1 + Math.floor(level / 2) // L1:1, L2:2, L4:3, L6:4, ...
  const areaCap = Math.max(1, Math.floor(area / HOLE_SPACING_CELLS))
  return Math.min(HOLE_MAX, byLevel, areaCap)
}

function holeMaxDimForLevel(level: number): number {
  return Math.min(HOLE_MAX_DIM, 3 + Math.floor((level - 1) / 2)) // L1-2:3, L3-4:4, L5+:5
}

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

// True iff every playable cell forms a single 4-connected component. Used to
// reject a hole that would orphan part of the board (making some food
// unreachable). Non-mutating, unlike keepLargestComponent.
function isConnected(mask: Uint8Array, n: number): boolean {
  const total = n * n
  let start = -1
  let count = 0
  for (let i = 0; i < total; i++) {
    if (mask[i] === 1) {
      count++
      if (start < 0) start = i
    }
  }
  if (count === 0) return false

  const seen = new Uint8Array(total)
  const stack = [start]
  seen[start] = 1
  let reached = 0
  while (stack.length > 0) {
    const cell = stack.pop()!
    reached++
    const x = cell % n
    const y = (cell - x) / n
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue
      const ni = ny * n + nx
      if (mask[ni] === 1 && seen[ni] === 0) {
        seen[ni] = 1
        stack.push(ni)
      }
    }
  }
  return reached === count
}

/**
 * Punch a few small interior holes into an already-valid solid board. Holes are
 * area-scaled and each is validated before it sticks: the region must stay a
 * single 4-connected component and pass the min-width open, so no hole ever
 * isolates food or carves a thin corridor. `protectedCells` (flat indices) are
 * never carved — callers pass the snakes' cells (plus a neighbour margin) on a
 * level transition so a hole never opens under, or immediately in front of, a
 * snake. Mutates `mask` in place.
 */
function carveHoles(mask: Uint8Array, n: number, rng: Rng, level: number, protectedCells?: Set<number>): void {
  const target = holeCountForLevel(level, onBoardCells(mask).length)
  if (target <= 0) return

  // Cap the footprint by BOTH the level and the board size: a hole needs ~2
  // cells of clearance to survive the min-width open, so a big hole can't fit a
  // small board. This keeps small early boards attempting placeable holes while
  // large late boards host genuine cavities. Size is still randomised up to the
  // cap for variety.
  const maxDim = Math.min(holeMaxDimForLevel(level), Math.max(1, Math.floor(n / 5)))

  // Anchor each attempt on an actual on-board cell (like the room generator
  // does) instead of a random grid position — the playable region is only ~57%
  // of the bounding box, so fully-random anchors waste most of the budget on
  // off-board cells. This makes placement reliable even on tight boards.
  const anchors = onBoardCells(mask)
  if (anchors.length === 0) return

  // Keep trying until `target` holes are actually placed (or the budget runs
  // out) rather than giving each slot a single shot — some attempts still land
  // on protected cells or fail the invariants, so a single try under-delivers.
  let placed = 0
  const budget = target * HOLE_RETRY_CAP
  for (let attempt = 0; attempt < budget && placed < target; attempt++) {
    const hw = randInt(rng, 1, maxDim)
    const hh = randInt(rng, 1, maxDim)
    const anchor = anchors[randInt(rng, 0, anchors.length - 1)]
    const ax = anchor % n
    const ay = (anchor - ax) / n
    // Place the footprint so it covers the (on-board) anchor, offset randomly.
    const x0 = clamp(ax - randInt(rng, 0, hw - 1), 0, n - hw)
    const y0 = clamp(ay - randInt(rng, 0, hh - 1), 0, n - hh)

    // Footprint must be entirely playable and clear of protected cells.
    const cells: number[] = []
    let ok = true
    for (let y = y0; y < y0 + hh && ok; y++) {
      for (let x = x0; x < x0 + hw; x++) {
        const idx = y * n + x
        if (mask[idx] !== 1 || (protectedCells !== undefined && protectedCells.has(idx))) {
          ok = false
          break
        }
        cells.push(idx)
      }
    }
    if (!ok) continue

    // Require the footprint to be fully interior: every cell orthogonally
    // bordering it must be on-board. Otherwise the "hole" is just a bite out of
    // the board's edge (it merges with the outer void) rather than a hole in the
    // middle — which is the whole point. Most on-board cells sit on the lean
    // blob's perimeter, so this is the constraint that actually matters.
    const inFootprint = (x: number, y: number) => x >= x0 && x < x0 + hw && y >= y0 && y < y0 + hh
    let interior = true
    for (const idx of cells) {
      const cx = idx % n
      const cy = (idx - cx) / n
      for (const [dx, dy] of NEIGHBORS) {
        const nx = cx + dx
        const ny = cy + dy
        if (inFootprint(nx, ny)) continue
        if (nx < 0 || nx >= n || ny < 0 || ny >= n || mask[ny * n + nx] !== 1) {
          interior = false
          break
        }
      }
      if (!interior) break
    }
    if (!interior) continue

    // Tentatively carve; keep only if both invariants still hold.
    for (const idx of cells) mask[idx] = 0
    if (isConnected(mask, n) && passesMinWidth(mask, n)) {
      placed++
      continue
    }
    for (const idx of cells) mask[idx] = 1 // revert and try elsewhere
  }
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

    // Solid shape is valid — punch interior holes and report the reduced area.
    // generateIronSnakeBoard only builds the level-1 board (advances use grow).
    carveHoles(mask, n, rng, 1)
    return { mask, area: onBoardCells(mask).length }
  }

  return null
}

export type Cell = { x: number; y: number }

/**
 * Build a fresh Iron Snake board for the next level that keeps the given snake
 * cells exactly where they are (they must not move between levels).
 *
 * A clear room is seeded around the snakes' combined bounding box (padded by 1),
 * guaranteeing every snake cell stays playable, connected, and with room for the
 * heads to move. Fresh overlapping rooms then grow outward from it until the
 * board reaches the size's typical fill — so the shape genuinely changes every
 * level (unlike growing the previous board, which is a no-op once it is already
 * at target fill). Never fails: the seed room always yields a valid region.
 */
export function growIronSnakeBoard(
  gridSize: number,
  snakeCells: Cell[],
  level: number = 1,
  rng: Rng = Math.random
): IronSnakeBoard {
  const n = gridSize
  const total = n * n
  const mask = new Uint8Array(total)

  // Seed: a clear rectangle around the snake(s), padded by 1 so heads can move.
  if (snakeCells.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const c of snakeCells) {
      if (c.x < minX) minX = c.x
      if (c.x > maxX) maxX = c.x
      if (c.y < minY) minY = c.y
      if (c.y > maxY) maxY = c.y
    }
    let x0 = Math.max(0, minX - 1)
    let y0 = Math.max(0, minY - 1)
    let w = Math.min(n, maxX + 1 - x0 + 1)
    let h = Math.min(n, maxY + 1 - y0 + 1)
    // Keep the seed at least MIN_ROOM on each side, staying within the grid.
    if (w < MIN_ROOM) { w = Math.min(MIN_ROOM, n); x0 = clamp(x0, 0, n - w) }
    if (h < MIN_ROOM) { h = Math.min(MIN_ROOM, n); y0 = clamp(y0, 0, n - h) }
    fillRoom(mask, n, x0, y0, w, h)
  } else {
    const s = Math.min(MIN_ROOM, n)
    fillRoom(mask, n, Math.floor((n - s) / 2), Math.floor((n - s) / 2), s, s)
  }

  // Grow outward: union overlapping rooms anchored on existing cells (so the
  // region stays connected) until we reach the typical fill for this size.
  const maxRoom = Math.max(MIN_ROOM, Math.floor(n * 0.6))
  const targetArea = Math.round(TARGET_FILL_MID * total)
  let guard = 0
  while (onBoardCells(mask).length < targetArea && guard < 80) {
    guard++
    const cells = onBoardCells(mask)
    const anchor = cells[randInt(rng, 0, cells.length - 1)]
    const ax = anchor % n
    const ay = (anchor - ax) / n
    const w = randInt(rng, MIN_ROOM, Math.min(maxRoom, n))
    const h = randInt(rng, MIN_ROOM, Math.min(maxRoom, n))
    // Cover the anchor cell so the new room overlaps the existing region.
    const x0 = clamp(ax - randInt(rng, 0, w - 1), 0, n - w)
    const y0 = clamp(ay - randInt(rng, 0, h - 1), 0, n - h)
    fillRoom(mask, n, x0, y0, w, h)
  }

  keepLargestComponent(mask, n)

  // Protect every snake cell plus its orthogonal neighbours so a hole never
  // opens under a snake on a level transition, nor immediately in front of a
  // head (which would be an unfair death the instant the loop resumes).
  const protectedCells = new Set<number>()
  for (const c of snakeCells) {
    const mark = (x: number, y: number) => {
      if (x >= 0 && x < n && y >= 0 && y < n) protectedCells.add(y * n + x)
    }
    mark(c.x, c.y)
    for (const [dx, dy] of NEIGHBORS) mark(c.x + dx, c.y + dy)
  }
  carveHoles(mask, n, rng, level, protectedCells)

  return { mask, area: onBoardCells(mask).length }
}

/**
 * Bounding-box `gridSize` whose generated shapes tend to yield roughly
 * `targetArea` playable cells. Since a generated shape fills ~`TARGET_FILL_MID`
 * of its bounding box, invert that: `gridSize ≈ sqrt(targetArea / midFill)`.
 * Clamped to `MIN_GRID`. Callers (Iron Snake level scaling) use this to grow the
 * board in proportion to how long the snake will be by the level's goal.
 */
export function ironSnakeGridSizeForArea(targetArea: number): number {
  const g = Math.ceil(Math.sqrt(Math.max(1, targetArea) / TARGET_FILL_MID))
  return Math.max(MIN_GRID, g)
}
