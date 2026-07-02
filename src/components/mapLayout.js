// ─── mapLayout.js ──────────────────────────────────────────────────────
// Auto-layout engine for the Cementerio Map.
// Takes a list of point definitions and arranges them in a square grid
// that fills the canvas right-to-left, with `spacing` percentage points
// of breathing room between each marker.
//
// Output positions are in % units (0–100) suitable for absolute CSS positioning.

const DEFAULT_SPACING = 10
const MARGIN = 10 // % padding from canvas edges

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
