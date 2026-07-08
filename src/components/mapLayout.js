// ─── mapLayout.js ──────────────────────────────────────────────────────
// Auto-layout engine for the Cementerio Map.
// Takes a list of point definitions and arranges them in a square grid
// that fills the canvas right-to-left, with `spacing` percentage points
// of breathing room between each marker.
//
// Output positions are in % units (0–100) suitable for absolute CSS positioning.

import { utmToLocal } from '../utils/geo.js'

const DEFAULT_SPACING = 10
const MARGIN = 10 // % padding from canvas edges

/**
 * Resolve a point's render position in the map's real-aspect viewBox space.
 * Prefers real geo (point.geo.utmX/utmY, snapped from the DWG survey),
 * falling back to the legacy 0-100% position for points/areas that haven't
 * been snapped to real geometry yet (e.g. unmapped areas, the demo area).
 * @param {object} point
 * @param {{viewboxW:number, viewboxH:number}} transform  from computeTransform() in src/utils/geo.js
 * @returns {{x:number, y:number, hasRealGeo:boolean}}
 */
export function resolveRenderPosition(point, transform) {
  if (point.geo) {
    const { x, y } = utmToLocal(point.geo.utmX, point.geo.utmY, transform)
    return { x, y, hasRealGeo: true }
  }
  const legacy = point.position || { x: 50, y: 50 }
  return {
    x: (legacy.x / 100) * transform.viewboxW,
    y: (legacy.y / 100) * transform.viewboxH,
    hasRealGeo: false,
  }
}

/**
 * Monotone-chain convex hull, used to draw a real-shaped area block around
 * a group of snapped points instead of a hand-guessed rectangle.
 * @param {{x:number,y:number}[]} points
 * @returns {{x:number,y:number}[]}
 */
export function convexHull(points) {
  const pts = [...new Map(points.map((p) => [`${p.x},${p.y}`, p])).values()].sort(
    (a, b) => a.x - b.x || a.y - b.y
  )
  if (pts.length <= 2) return pts

  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const lower = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/**
 * Push each hull vertex outward from the polygon's centroid by `amount`,
 * so an area block drawn around a thin line of points (e.g. a path-snapped
 * sequence) reads as a visible region instead of a sliver.
 * @param {{x:number,y:number}[]} points
 * @param {number} amount
 */
export function inflatePolygon(points, amount) {
  if (points.length < 3) return points
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  return points.map((p) => {
    const dx = p.x - cx
    const dy = p.y - cy
    const len = Math.hypot(dx, dy) || 1
    return { x: p.x + (dx / len) * amount, y: p.y + (dy / len) * amount }
  })
}

/**
 * Centroid of a polygon given as [[x,y], ...] pairs.
 * @param {number[][]} polygon
 * @returns {{x:number, y:number}}
 */
export function polygonCentroid(polygon) {
  return {
    x: polygon.reduce((s, p) => s + p[0], 0) / polygon.length,
    y: polygon.reduce((s, p) => s + p[1], 0) / polygon.length,
  }
}

/**
 * Distribute `count` positions inside `polygon` along its longest diagonal.
 * Returns [{x, y}] in the same coordinate space as the polygon vertices.
 * For thin strip-shaped sections this places points evenly along the spine.
 * @param {number[][]} polygon  vertices as [[x,y], ...]
 * @param {number}     count
 * @returns {{x:number, y:number}[]}
 */
export function placePointsInPolygon(polygon, count) {
  if (count <= 0) return []
  const cx = polygon.reduce((s, p) => s + p[0], 0) / polygon.length
  const cy = polygon.reduce((s, p) => s + p[1], 0) / polygon.length
  if (count === 1) return [{ x: cx, y: cy }]

  // Find the two most-distant vertices to define the spine.
  let maxDist = 0
  let pA = polygon[0]
  let pB = polygon[polygon.length - 1]
  for (let i = 0; i < polygon.length; i++) {
    for (let j = i + 1; j < polygon.length; j++) {
      const d = Math.hypot(polygon[j][0] - polygon[i][0], polygon[j][1] - polygon[i][1])
      if (d > maxDist) { maxDist = d; pA = polygon[i]; pB = polygon[j] }
    }
  }

  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    return { x: pA[0] + (pB[0] - pA[0]) * t, y: pA[1] + (pB[1] - pA[1]) * t }
  })
}

// Pre-defined palette of distinct, cemetery-appropriate colors
export const PALETTE = [
  '#e74c3c', // crimson
  '#3498db', // ocean blue
  '#f39c12', // amber
  '#9b59b6', // amethyst
  '#16a085', // patina green
  '#d35400', // burnt orange
  '#2c3e50', // midnight slate
  '#c0392b', // deep red
  '#27ae60', // forest
  '#8e44ad', // royal purple
  '#7f8c8d', // ash gray
  '#a0522d', // sienna
]

/**
 * Compute a square grid layout.
 * - Given N points and spacing, picks cols × rows such that cols*rows >= N
 *   and the grid is as close to square as possible.
 * - Fills rows top→bottom, but within each row fills right→left per the spec.
 *
 * @param {number} count    number of points
 * @param {number} spacing  % between markers (default 10)
 * @returns {{cols:number, rows:number, cellW:number, cellH:number, positions:{x:number,y:number}[]}}
 */
export function computeSquareLayout(count, spacing = DEFAULT_SPACING) {
  if (count <= 0) return { cols: 0, rows: 0, cellW: 0, cellH: 0, positions: [] }

  // Pick a square-ish grid
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)

  // Available canvas (after margin) and step between cell centers
  const usable = 100 - MARGIN * 2
  // Step is spacing + 1 cell-width; we want even spacing, so step = usable / (cols-1) or fallback to spacing
  const stepX = cols > 1 ? usable / (cols - 1) : 0
  const stepY = rows > 1 ? usable / (rows - 1) : 0

  // Sanity check: if user-supplied spacing is larger than the computed step, honor the larger.
  // But we still try to fill the canvas. We'll use the larger of the two for a stable look.
  const finalStepX = Math.max(stepX, spacing)
  const finalStepY = Math.max(stepY, spacing)

  // Recompute usable space using final step
  const finalUsableX = finalStepX * (cols - 1)
  const finalUsableY = finalStepY * (rows - 1)

  // Center within canvas
  const startX = (100 - finalUsableX) / 2
  const startY = (100 - finalUsableY) / 2

  // Generate positions: fill row-by-row, but in each row go right→left
  const positions = []
  let i = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (i >= count) break
      // Right-to-left: invert column index
      const colIndexFromRight = cols - 1 - c
      positions.push({
        x: +(startX + colIndexFromRight * finalStepX).toFixed(2),
        y: +(startY + r * finalStepY).toFixed(2),
      })
      i++
    }
    if (i >= count) break
  }

  return {
    cols,
    rows,
    cellW: finalStepX,
    cellH: finalStepY,
    positions,
  }
}

/**
 * Build zone records from a list of point definitions + layout.
 * Each point gets:
 *   - auto-assigned id (A, B, C, ... or A1, A2, ... for >26)
 *   - auto-assigned color from the palette
 *   - auto-assigned position from the square layout
 *   - auto-assigned connections to its 4-neighbors in the grid
 *
 * @param {Array<{title?:string, description?:string, panorama?:string, heading?:number}>} points
 * @param {object} opts { spacing, startLetter }
 * @returns {Array} zones ready to drop into ZONES
 */
export function buildZones(points, opts = {}) {
  const { spacing = DEFAULT_SPACING, startLetter = 'A' } = opts
  const layout = computeSquareLayout(points.length, spacing)
  const startCode = startLetter.charCodeAt(0)

  return points.map((p, i) => {
    const id =
      i < 26
        ? String.fromCharCode(startCode + i)
        : `${String.fromCharCode(startCode + Math.floor(i / 26) - 1)}${String.fromCharCode(startCode + (i % 26))}`

    const connections = []
    const { cols } = layout
    // Each row is filled cols wide; the i-th point sits at (row=i/cols, col=i%cols)
    // Within the row, "col" here is the visual column from the LEFT.
    // Since we render right→left, the i%cols index in the layout array is already left-to-right.
    // Find neighbors in the actual grid (logical left→right order):
    const logicalCol = i % cols
    const logicalRow = Math.floor(i / cols)
    const totalInRow = Math.min(cols, points.length - logicalRow * cols)
    const leftNeighbor = logicalCol > 0 ? i - 1 : null
    const rightNeighbor = logicalCol < totalInRow - 1 ? i + 1 : null
    const upNeighbor = logicalRow > 0 ? i - cols : null
    const downNeighbor = (i + cols < points.length) ? i + cols : null

    if (leftNeighbor !== null) connections.push(leftNeighbor)
    if (rightNeighbor !== null) connections.push(rightNeighbor)
    if (upNeighbor !== null) connections.push(upNeighbor)
    if (downNeighbor !== null) connections.push(downNeighbor)

    return {
      id,
      position: p.position || layout.positions[i] || { x: 50, y: 50 },
      position3D: p.position3D || [0, 0, 0],
      color: PALETTE[i % PALETTE.length],
      label: id,
      title: p.title || `Punto ${id}`,
      description: p.description || '',
      connections: p.connections || connections.map(idx => {
        // Resolve the neighbor's id at build time (we know all points already)
        const ni = idx
        if (ni < 26) return String.fromCharCode(startCode + ni)
        return `${String.fromCharCode(startCode + Math.floor(ni / 26) - 1)}${String.fromCharCode(startCode + (ni % 26))}`
      }),
      panorama: p.panorama || '',
      heading: typeof p.heading === 'number' ? p.heading : 0,
      hotspots: p.hotspots || [],
    }
  })
}
/**
 * Ingest a "points" array from a ZIP manifest. Each entry can be:
 *   { id, title, description, panorama, heading, x?, y? }
 * If x/y are provided, they override the auto-layout. If not, the point
 * is appended in order and the layout is recomputed across all points.
 */
export function ingestManifest(manifest, opts = {}) {
  /* eslint-disable-next-line no-unused-vars */
  const overrides = manifest.filter(p => typeof p.x === 'number' && typeof p.y === 'number')
  const auto = manifest.filter(p => !(typeof p.x === 'number' && typeof p.y === 'number'))

  // Build auto-zones
  const autoZones = buildZones(auto, opts)

  // Map id → zone for auto, then re-stitch by id
  const allZones = []
  let autoIdx = 0
  manifest.forEach(p => {
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      // Manually placed: use provided coords, fall back color/connections later
      allZones.push({
        id: p.id || `M${allZones.length + 1}`,
        position: { x: p.x, y: p.y },
        color: p.color || PALETTE[allZones.length % PALETTE.length],
        label: p.id || `M${allZones.length + 1}`,
        title: p.title || `Punto ${p.id || allZones.length + 1}`,
        description: p.description || '',
        connections: [],
        panorama: p.panorama || '',
        heading: typeof p.heading === 'number' ? p.heading : 0,
      })
    } else {
      allZones.push(autoZones[autoIdx++])
    }
  })

  // Build connections: for each zone, find spatial neighbors within 2× spacing
  const spacing = opts.spacing || DEFAULT_SPACING
  const maxDist = spacing * 1.6
  for (let i = 0; i < allZones.length; i++) {
    const a = allZones[i]
    const ids = []
    for (let j = 0; j < allZones.length; j++) {
      if (i === j) continue
      const b = allZones[j]
      const dx = a.position.x - b.position.x
      const dy = a.position.y - b.position.y
      if (Math.sqrt(dx * dx + dy * dy) <= maxDist) ids.push(b.id)
    }
    a.connections = ids
  }

  return allZones
}
