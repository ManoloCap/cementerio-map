// ─── CemeteryMap2D ────────────────────────────────────────────────────
// Minimalistic top-down 2D map of Cementerio Jardines de la Paz.
// Section polygons traced from the per-layer CAD screenshots in docs/
// (see scripts/trace_section_layers.py). All coordinates live in the
// shared 1280x535 CAD viewport pixel space.
//
// Current scope: detailed filled polygons + name labels + legend.
// Next: overlay cemetery points per section, then 360 viewer links.

import { useMemo, useState, useRef } from 'react'
import sectionsData from '../data/sections2d.json'
import overlays from '../data/overlays2d.json'

const { sections } = sectionsData

// viewBox covers sections plus the property perimeter / próximamente fan
const allPts = [
  ...overlays.perimeter,
  ...overlays.proximamente,
  ...sections.flatMap(s => s.polygons.flat()),
]
const PAD = 14
const bx0 = Math.min(...allPts.map(p => p[0]))
const bx1 = Math.max(...allPts.map(p => p[0]))
const by0 = Math.min(...allPts.map(p => p[1]))
const by1 = Math.max(...allPts.map(p => p[1]))
const VB_X = bx0 - PAD
const VB_Y = by0 - PAD
const VB_W = bx1 - bx0 + PAD * 2
const VB_H = by1 - by0 + PAD * 2
const VIEWBOX = `${VB_X} ${VB_Y} ${VB_W} ${VB_H}`

const MIN_SCALE = 1
const MAX_SCALE = 4
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

// Darken a #rrggbb color by `f` (0..1) for strokes/labels.
function darken(hex, f = 0.45) {
  const n = parseInt(hex.slice(1), 16)
  const ch = s => Math.round(((n >> s) & 255) * (1 - f))
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`
}

function pointInPolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function distToEdges(x, y, poly) {
  let min = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j]
    const [x2, y2] = poly[i]
    const dx = x2 - x1
    const dy = y2 - y1
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)))
    min = Math.min(min, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)))
  }
  return min
}

// Straight-edged closed path for one or more rings. The sections partition
// the land like puzzle pieces, so edges stay crisp and rectilinear.
function ringsToPath(rings) {
  return rings
    .map(ring => `M ${ring.map(p => `${p[0]} ${p[1]}`).join(' L ')} Z`)
    .join(' ')
}

// Smooth closed Catmull-Rom path -- used for the organic overlay shapes
// (barranco contour rings, perimeter, próximamente) where hand-drawn curves
// should read as soft lines, unlike the rectilinear section pieces.
function smoothClosedPath(poly) {
  const n = poly.length
  const pt = i => poly[(i + n) % n]
  let d = `M ${pt(0)[0]} ${pt(0)[1]}`
  for (let i = 0; i < n; i++) {
    const p0 = pt(i - 1)
    const p1 = pt(i)
    const p2 = pt(i + 1)
    const p3 = pt(i + 2)
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0]} ${p2[1]}`
  }
  return d + ' Z'
}

// Open (non-closed) Catmull-Rom path -- for the perimeter, which is now just
// the main property's own arc (the fan's outer edge is excluded so it isn't
// double-drawn against the fan's own dotted border).
function smoothOpenPath(poly) {
  const n = poly.length
  if (n < 2) return ''
  const pt = i => poly[Math.max(0, Math.min(n - 1, i))]
  let d = `M ${pt(0)[0]} ${pt(0)[1]}`
  for (let i = 0; i < n - 1; i++) {
    const p0 = pt(i - 1)
    const p1 = pt(i)
    const p2 = pt(i + 1)
    const p3 = pt(i + 2)
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0]} ${p2[1]}`
  }
  return d
}

// Approximate pole of inaccessibility: the interior grid point farthest from
// any edge. Thin curved sections make the plain centroid land outside.
function labelPoint(poly) {
  const xs = poly.map(p => p[0])
  const ys = poly.map(p => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const steps = 40
  let best = null
  let bestD = -1
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const x = x0 + ((x1 - x0) * i) / steps
      const y = y0 + ((y1 - y0) * j) / steps
      if (!pointInPolygon(x, y, poly)) continue
      const d = distToEdges(x, y, poly)
      if (d > bestD) {
        bestD = d
        best = [x, y]
      }
    }
  }
  return best ?? [(x0 + x1) / 2, (y0 + y1) / 2]
}

// Push overlapping labels apart vertically so nested thin bands (whose widest
// spots coincide) don't stack their names on top of each other.
const FONT = 5.5
function separateLabels(items) {
  const halfW = s => (s.label.length * FONT * 0.55) / 2
  const minGap = FONT + 2
  for (let pass = 0; pass < 30; pass++) {
    let moved = false
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]
        const b = items[j]
        const dx = Math.abs(a.labelPos[0] - b.labelPos[0])
        const dy = a.labelPos[1] - b.labelPos[1]
        if (dx < halfW(a) + halfW(b) && Math.abs(dy) < minGap) {
          const push = (minGap - Math.abs(dy)) / 2 + 0.2
          const dir = dy >= 0 ? 1 : -1
          a.labelPos[1] += dir * push
          b.labelPos[1] -= dir * push
          moved = true
        }
      }
    }
    if (!moved) break
  }
}

// Layout: desktop keeps the SVG filling the map area with the legend
// floating bottom-right; mobile stacks the map (upper ~50vh) above a
// scrollable legend column so the two never overlap.
const RESPONSIVE_CSS = `
  .cm2d-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }
  .cm2d-map-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    position: relative;
  }
  .cm2d-legend {
    position: absolute;
    right: 20px;
    bottom: 20px;
    background: rgba(255,255,255,0.92);
    border: 1px solid #e6e3dc;
    border-radius: 10px;
    padding: 10px 12px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cm2d-zoom-controls {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cm2d-zoom-btn {
    width: 36px;
    height: 36px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    line-height: 1;
    color: #3d3a34;
    background: rgba(255,255,255,0.92);
    border: 1px solid #e6e3dc;
    border-radius: 8px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.08);
    cursor: pointer;
    touch-action: manipulation;
  }
  .cm2d-zoom-btn:active {
    background: #f0efeb;
  }

  @media (max-width: 768px) {
    .cm2d-body {
      flex-direction: column;
    }
    .cm2d-map-wrap {
      flex: none;
      height: 50vh;
      min-height: 320px;
      padding: 8px;
    }
    .cm2d-legend {
      position: static;
      width: 100%;
      height: 50vh;
      overflow-y: auto;
      border-radius: 0;
      border: none;
      border-top: 1px solid #e6e3dc;
      box-shadow: none;
      padding: 10px 14px;
    }
  }
`

export default function CemeteryMap2D() {
  const [hovered, setHovered] = useState(null)

  const labeled = useMemo(() => {
    const items = sections.map(s => ({
      ...s,
      labelPos: labelPoint(s.polygons[0]),
      path: ringsToPath(s.polygons),
    }))
    separateLabels(items)
    return items
  }, [])

  const extras = useMemo(
    () => ({
      perimeterPath: smoothOpenPath(overlays.perimeter),
      fanPath: smoothClosedPath(overlays.proximamente),
      fanLabel: labelPoint(overlays.proximamente),
      barrancoPaths: overlays.barranco.map(smoothClosedPath),
      missingPath: smoothClosedPath(overlays.missing_3a2a),
      missingLabel: labelPoint(overlays.missing_3a2a),
    }),
    []
  )

  // ─── pinch-zoom + pan ──────────────────────────────────────────────
  const svgRef = useRef(null)
  const pointers = useRef(new Map()) // pointerId -> {x, y} in client coords
  const pinch = useRef(null) // {startDist, mid: [vbX, vbY], startScale, startTx, startTy}
  const pan = useRef(null) // {startClientX, startClientY, startTx, startTy}
  const lastTap = useRef(0)
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })

  // uniform client-px -> viewBox-unit factor for the svg's current on-screen
  // size, accounting for the letterboxing from preserveAspectRatio="meet"
  function screenToViewBoxFactor() {
    const svg = svgRef.current
    if (!svg) return 1
    const rect = svg.getBoundingClientRect()
    const rectAspect = rect.width / rect.height
    const vbAspect = VB_W / VB_H
    return rectAspect > vbAspect ? rect.height / VB_H : rect.width / VB_W
  }

  function clientToViewBox(clientX, clientY) {
    const svg = svgRef.current
    const factor = screenToViewBoxFactor()
    const rect = svg.getBoundingClientRect()
    const offsetX = (rect.width - VB_W * factor) / 2
    const offsetY = (rect.height - VB_H * factor) / 2
    return [VB_X + (clientX - rect.left - offsetX) / factor, VB_Y + (clientY - rect.top - offsetY) / factor]
  }

  function resetTransform() {
    setTransform({ scale: 1, x: 0, y: 0 })
  }

  function zoomBy(factor) {
    setTransform(t => {
      const newScale = clamp(t.scale * factor, MIN_SCALE, MAX_SCALE)
      const cx = VB_X + VB_W / 2
      const cy = VB_Y + VB_H / 2
      return {
        scale: newScale,
        x: cx - (newScale * (cx - t.x)) / t.scale,
        y: cy - (newScale * (cy - t.y)) / t.scale,
      }
    })
  }

  function handlePointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 1) {
      const now = Date.now()
      if (now - lastTap.current < 300) {
        resetTransform()
        lastTap.current = 0
        pan.current = { startClientX: e.clientX, startClientY: e.clientY, startTx: 0, startTy: 0 }
      } else {
        lastTap.current = now
        pan.current = { startClientX: e.clientX, startClientY: e.clientY, startTx: transform.x, startTy: transform.y }
      }
    } else if (pointers.current.size === 2) {
      pan.current = null
      const [p0, p1] = Array.from(pointers.current.values())
      const dist = Math.hypot(p0.x - p1.x, p0.y - p1.y)
      const mid = clientToViewBox((p0.x + p1.x) / 2, (p0.y + p1.y) / 2)
      pinch.current = { startDist: dist || 1, mid, startScale: transform.scale, startTx: transform.x, startTy: transform.y }
    }
  }

  function handlePointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2 && pinch.current) {
      const [p0, p1] = Array.from(pointers.current.values())
      const dist = Math.hypot(p0.x - p1.x, p0.y - p1.y)
      const { startDist, mid, startScale, startTx, startTy } = pinch.current
      const newScale = clamp(startScale * (dist / startDist), MIN_SCALE, MAX_SCALE)
      const [mx, my] = mid
      setTransform({
        scale: newScale,
        x: mx - (newScale * (mx - startTx)) / startScale,
        y: my - (newScale * (my - startTy)) / startScale,
      })
    } else if (pointers.current.size === 1 && pan.current) {
      const { startClientX, startClientY, startTx, startTy } = pan.current
      setTransform(t => {
        if (t.scale <= MIN_SCALE) return t
        const factor = screenToViewBoxFactor()
        return {
          ...t,
          x: startTx + (e.clientX - startClientX) / factor,
          y: startTy + (e.clientY - startClientY) / factor,
        }
      })
    }
  }

  function handlePointerUp(e) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) {
      pan.current = null
      pinch.current = null
    } else if (pointers.current.size === 1) {
      pinch.current = null
      const [remaining] = pointers.current.values()
      pan.current = { startClientX: remaining.x, startClientY: remaining.y, startTx: transform.x, startTy: transform.y }
    }
  }

  const groupTransform = `translate(${transform.x} ${transform.y}) scale(${transform.scale})`

  return (
    <div style={styles.page}>
      <style>{RESPONSIVE_CSS}</style>
      <header style={styles.header}>
        <h1 style={styles.title}>Cementerio Jardines de la Paz</h1>
        <p style={styles.subtitle}>Mapa de secciones</p>
      </header>

      <div className="cm2d-body">
        <div className="cm2d-map-wrap">
          <div className="cm2d-zoom-controls">
            <button
              type="button"
              className="cm2d-zoom-btn"
              aria-label="Acercar"
              onClick={() => zoomBy(1.4)}
            >
              +
            </button>
            <button
              type="button"
              className="cm2d-zoom-btn"
              aria-label="Alejar"
              onClick={() => zoomBy(1 / 1.4)}
            >
              −
            </button>
          </div>
          <svg
            ref={svgRef}
            viewBox={VIEWBOX}
            style={{ ...styles.svg, touchAction: 'none' }}
            role="img"
            aria-label="Mapa 2D del cementerio"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
          <g transform={groupTransform}>
          {/* property perimeter — solid line */}
          <path
            d={extras.perimeterPath}
            fill="none"
            stroke="#1a1a1a"
            strokeWidth={1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Próximamente area — dotted border in the same blue as the fill;
              no separate division line against the main property (the
              perimeter arc already stops exactly at the fan's edge) */}
          <path
            d={extras.fanPath}
            fill="#dbe5f2"
            fillOpacity={0.55}
            stroke="#dbe5f2"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeDasharray="0.5 4"
          />
          {overlays.circle && (
            <circle
              cx={overlays.circle.cx}
              cy={overlays.circle.cy}
              r={overlays.circle.r}
              fill="none"
              stroke="#dbe5f2"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeDasharray="0.5 4"
            />
          )}
          <text
            x={extras.fanLabel[0]}
            y={extras.fanLabel[1]}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{
              fontSize: 15,
              fontStyle: 'italic',
              fontWeight: 700,
              letterSpacing: '0.08em',
              fill: '#7791b5',
              pointerEvents: 'none',
              fontFamily: 'inherit',
            }}
          >
            Próximamente
          </text>

          {/* barranco: evenly-spaced curvas de nivel (synthesized from a
              distance field, so they taper naturally like a real topo map) */}
          <g fill="none" stroke="#a8977f" strokeLinejoin="round">
            {extras.barrancoPaths.map((d, i) => (
              <path
                key={i}
                d={d}
                strokeWidth={i === 0 ? 0.8 : 0.45}
                strokeOpacity={i === 0 ? 0.85 : 0.55}
              />
            ))}
          </g>

          {/* unmapped strip of 3A + 2A */}
          <path
            d={extras.missingPath}
            fill="#f0b35c"
            fillOpacity={0.35}
            stroke="#cd8f3d"
            strokeWidth={0.7}
            strokeDasharray="4 2.5"
            strokeLinejoin="round"
          />
          <text
            x={extras.missingLabel[0]}
            y={extras.missingLabel[1]}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{
              fontSize: 4.5,
              fontStyle: 'italic',
              fill: '#a06f27',
              paintOrder: 'stroke',
              stroke: '#faf9f6',
              strokeWidth: 1.3,
              pointerEvents: 'none',
              fontFamily: 'inherit',
            }}
          >
            3A + 2A · sin mapear
          </text>

          {labeled.map(s => {
            const active = hovered === s.id
            const dim = hovered && !active
            return (
              <g
                key={s.id}
                onMouseEnter={() => setHovered(s.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'pointer' }}
              >
                <path
                  d={s.path}
                  fill={s.color}
                  fillOpacity={active ? 1 : dim ? 0.4 : 0.9}
                  stroke={active ? darken(s.color) : '#faf9f6'}
                  strokeWidth={1.2}
                  strokeLinejoin="miter"
                  style={{ transition: 'fill-opacity 160ms, stroke 160ms' }}
                />
              </g>
            )
          })}
          {labeled.map(s => {
            const dim = hovered && hovered !== s.id
            return (
              <text
                key={`label-${s.id}`}
                x={s.labelPos[0]}
                y={s.labelPos[1]}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fontSize: 5.5,
                  fontWeight: 600,
                  fill: darken(s.color, 0.6),
                  paintOrder: 'stroke',
                  stroke: '#faf9f6',
                  strokeWidth: 1.6,
                  strokeLinejoin: 'round',
                  opacity: dim ? 0.25 : 1,
                  pointerEvents: 'none',
                  transition: 'opacity 160ms',
                  fontFamily: 'inherit',
                }}
              >
                {s.label}
              </text>
            )
          })}
          </g>
          </svg>
        </div>

        <aside className="cm2d-legend">
        {labeled.map(s => (
          <div
            key={s.id}
            onMouseEnter={() => setHovered(s.id)}
            onMouseLeave={() => setHovered(null)}
            style={{
              ...styles.legendRow,
              background: hovered === s.id ? '#f0efeb' : 'transparent',
            }}
          >
            <span style={{ ...styles.swatch, background: s.color, borderColor: darken(s.color, 0.3) }} />
            <span style={styles.legendText}>{s.label}</span>
          </div>
        ))}
        <div style={styles.legendDivider} />
        {[
          { key: 'prox', color: '#dbe5f2', border: '#dbe5f2', text: 'Próximamente' },
          { key: 'barranco', color: 'transparent', border: '#a29a8e', text: 'Barranco' },
          { key: 'missing', color: '#f8dcae', border: '#cd8f3d', text: '3A + 2A · sin mapear' },
        ].map(e => (
          <div key={e.key} style={styles.legendRow}>
            <span
              style={{
                ...styles.swatch,
                background: e.color,
                borderColor: e.border,
                borderStyle: 'dashed',
              }}
            />
            <span style={styles.legendText}>{e.text}</span>
          </div>
        ))}
        </aside>
      </div>
    </div>
  )
}

const styles = {
  page: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: '#faf9f6',
    color: '#3d3a34',
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    position: 'relative',
    overflow: 'hidden',
  },
  header: {
    padding: '20px 28px 0',
    flexShrink: 0,
  },
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: '0.02em',
  },
  subtitle: {
    margin: '2px 0 0',
    fontSize: 13,
    color: '#8a857b',
  },
  svg: {
    width: '100%',
    height: '100%',
    display: 'block',
  },
  legendDivider: {
    height: 1,
    background: '#e6e3dc',
    margin: '4px 6px',
  },
  legendRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 8px',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'background 120ms',
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
    border: '1px solid',
    flexShrink: 0,
  },
  legendText: {
    fontSize: 12.5,
    whiteSpace: 'nowrap',
  },
}
