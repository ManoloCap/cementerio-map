import { useRef, useState, useEffect, useCallback } from 'react'

// ─── Config ───────────────────────────────────────────────────────────
const ZONES = [
  {
    id: 'A',
    position: { x: 28, y: 30 },   // % positions for top-down view
    color: '#e74c3c',
    label: 'A',
    title: 'Zona de lápidas antiguas',
    description: 'Área histórica con lápidas del siglo XIX',
    connections: ['B', 'C'],
    panorama: 'https://pannellum.org/images/alma.jpg',
    heading: 0,
  },
  {
    id: 'B',
    position: { x: 68, y: 28 },
    color: '#3498db',
    label: 'B',
    title: 'Área de mausoleos',
    description: 'Mausoleos familiares de arquitectura neoclásica',
    connections: ['A', 'D'],
    panorama: 'https://pannellum.org/images/cerro.jpg',
    heading: 90,
  },
  {
    id: 'C',
    position: { x: 25, y: 68 },
    color: '#f39c12',
    label: 'C',
    title: 'Jardín memorial',
    description: 'Espacio ajardinado con bancos y fuentes',
    connections: ['A', 'D'],
    panorama: 'https://pannellum.org/images/alma.jpg',
    heading: 180,
  },
  {
    id: 'D',
    position: { x: 70, y: 70 },
    color: '#9b59b6',
    label: 'D',
    title: 'Servicios administrativos',
    description: 'Oficinas, chapelle y sala de velación',
    connections: ['B', 'C'],
    panorama: 'https://pannellum.org/images/cerro.jpg',
    heading: 270,
  },
]

// ─── 360 Viewer (vanilla Pannellum) ────────────────────────────────────

function PanoramaViewer({ zone, onNavigate, onExit }) {
  const containerRef = useRef()
  const viewerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return
    if (viewerRef.current) {
      try { viewerRef.current.destroy() } catch (e) {}
      viewerRef.current = null
    }
    containerRef.current.innerHTML = ''

    const viewer = window.pannellum.viewer(containerRef.current, {
      type: 'equirectangular',
      panorama: zone.panorama,
      autoLoad: true,
      showControls: true,
      compass: true,
      showZoomCtrl: false,
      mouseZoom: true,
      friction: 0.15,
      yaw: zone.heading,
      pitch: 0,
      hfov: 100,
    })

    viewerRef.current = viewer

    return () => {
      if (viewerRef.current) {
        try { viewerRef.current.destroy() } catch (e) {}
        viewerRef.current = null
      }
    }
  }, [zone])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#000' }}>
      {/* Pannellum container */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Zone label – top center */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        background: `${zone.color}dd`,
        padding: '10px 28px',
        borderRadius: '0 0 16px 16px',
        color: 'white',
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 'bold',
        fontSize: '14px',
        textAlign: 'center',
        boxShadow: `0 4px 24px ${zone.color}66`,
        zIndex: 10,
      }}>
        <div style={{ fontSize: '10px', opacity: 0.85, marginBottom: '2px', letterSpacing: '1.5px' }}>
          PUNTO {zone.id}
        </div>
        {zone.title}
      </div>

      {/* Navigation buttons – bottom center */}
      <div style={{
        position: 'absolute',
        bottom: '90px',
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        gap: '12px',
        zIndex: 10,
        flexWrap: 'wrap',
        padding: '0 20px',
      }}>
        {zone.connections.map(targetId => {
          const target = ZONES.find(z => z.id === targetId)
          return (
            <button
              key={targetId}
              onClick={() => onNavigate(targetId)}
              style={{
                background: `${target.color}cc`,
                border: `2px solid ${target.color}`,
                borderRadius: '10px',
                padding: '9px 20px',
                color: 'white',
                fontFamily: 'system-ui, sans-serif',
                fontSize: '13px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backdropFilter: 'blur(10px)',
                transition: 'transform 0.15s, box-shadow 0.15s',
                boxShadow: `0 4px 20px ${target.color}55`,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'scale(1.06)'
                e.currentTarget.style.boxShadow = `0 8px 32px ${target.color}88`
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'scale(1)'
                e.currentTarget.style.boxShadow = `0 4px 20px ${target.color}55`
              }}
            >
              <span style={{ fontSize: '18px' }}>→</span>
<span>{targetId}: {target.title}</span>
            </button>
          )
        })}
      </div>

      {/* Zone info – bottom left */}
      <div style={{
        position: 'absolute',
        bottom: '24px',
        left: '24px',
        zIndex: 10,
        background: 'rgba(0,0,0,0.75)',
        padding: '14px 18px',
        borderRadius: '12px',
        color: 'white',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: '240px',
        borderLeft: `4px solid ${zone.color}`,
        backdropFilter: 'blur(8px)',
      }}>
        <div style={{ fontSize: '10px', color: zone.color, fontWeight: 'bold', letterSpacing: '1px', marginBottom: '4px' }}>
          ZONA {zone.id}
        </div>
        <div style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '4px' }}>{zone.title}</div>
        <div style={{ fontSize: '12px', color: '#bbb', lineHeight: '1.4' }}>{zone.description}</div>
      </div>

      {/* Exit button */}
      <button
        onClick={onExit}
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          zIndex: 200,
          background: 'rgba(0,0,0,0.7)',
          border: '2px solid rgba(255,255,255,0.25)',
          borderRadius: '10px',
          padding: '9px 18px',
          color: 'white',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 'bold',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        ✕ Volver al mapa
      </button>
    </div>
  )
}

// ─── Top-Down Map View ─────────────────────────────────────────────────

function TopDownMap({ onZoneClick, activeZone }) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      position: 'relative',
      background: '#f0efe9', // warm concrete
      overflow: 'hidden',
    }}>
      {/* Subtle map background pattern */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.07 }}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <defs>
          <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#333" strokeWidth="0.3" />
          </pattern>
        </defs>
        <rect width="100" height="100" fill="url(#grid)" />
      </svg>

      {/* Paths connecting zones */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
 viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {/* A-B path */}
        <line x1="28" y1="30" x2="68" y2="28" stroke="#c5c0b5" strokeWidth="1.2" strokeDasharray="2,2" />
        {/* A-C path */}
        <line x1="28" y1="30" x2="25" y2="68" stroke="#c5c0b5" strokeWidth="1.2" strokeDasharray="2,2" />
        {/* B-D path */}
        <line x1="68" y1="28" x2="70" y2="70" stroke="#c5c0b5" strokeWidth="1.2" strokeDasharray="2,2" />
        {/* C-D path */}
        <line x1="25" y1="68" x2="70" y2="70" stroke="#c5c0b5" strokeWidth="1.2" strokeDasharray="2,2" />
      </svg>

      {/* Zone markers */}
      {ZONES.map(zone => {
        const isActive = activeZone?.id === zone.id
        return (
          <div
            key={zone.id}
            onClick={() => onZoneClick(zone)}
            style={{
              position: 'absolute',
              left: `${zone.position.x}%`,
              top: `${zone.position.y}%`,
              transform: 'translate(-50%, -50%)',
              cursor: 'pointer',
              zIndex: 10,
            }}
          >
            {/* Outer ring */}
            <div style={{
              width: isActive ? '72px' : '60px',
              height: isActive ? '72px' : '60px',
              borderRadius: '50%',
              background: zone.color,
              opacity: isActive ? 1 : 0.85,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: isActive
                ? `0 0 0 6px ${zone.color}44, 0 0 24px ${zone.color}88`
                : `0 4px 16px ${zone.color}55`,
              transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
              border: isActive ? '3px solid white' : '3px solid transparent',
            }}>
              <span style={{
                color: 'white',
                fontSize: isActive ? '22px' : '18px',
                fontWeight: 'bold',
                fontFamily: 'system-ui, sans-serif',
                textShadow: '0 1px 4px rgba(0,0,0,0.4)',
 }}>
                {zone.label}
              </span>
            </div>

            {/* Zone title below */}
<div style={{
              marginTop: '8px',
              textAlign: 'center',
              maxWidth: '90px',
              fontSize: '11px',
              fontWeight: 'bold',
              color: zone.color,
              fontFamily: 'system-ui, sans-serif',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              textShadow: '0 1px 4px rgba(255,255,255,0.9)',
              opacity: isActive ? 1 : 0.8,
              transition: 'opacity 0.2s',
            }}>
              {zone.title}
            </div>
          </div>
        )
      })}

      {/* Map title */}
      <div style={{
        position: 'absolute',
        top: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        textAlign: 'center',
        zIndex: 10,
      }}>
        <div style={{
          fontSize: '22px',
          fontWeight: 'bold',
          color: '#2c2c2c',
          fontFamily: 'system-ui, sans-serif',
          letterSpacing: '2px',
          textTransform: 'uppercase',
        }}>
          Cementerio General
        </div>
        <div style={{
          fontSize: '11px',
          color: '#888',
          fontFamily: 'system-ui, sans-serif',
          marginTop: '4px',
          letterSpacing: '1px',
        }}>
          Guatemala City
        </div>
      </div>

      {/* Hint */}
<div style={{
        position: 'absolute',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: '12px',
        color: '#aaa',
        fontFamily: 'system-ui, sans-serif',
        zIndex: 10,
      }}>
        Toca un punto para ver la foto 360
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────

export default function TerrainMap() {
  const [viewMode, setViewMode] = useState('map') // 'map' | '360'
  const [selectedZone, setSelectedZone] = useState(null)

  const handleZoneClick = useCallback((zone) => {
    setSelectedZone(zone)
    setViewMode('360')
  }, [])

  const handleNavigate = useCallback((targetId) => {
    const target = ZONES.find(z => z.id === targetId)
    if (target) setSelectedZone(target)
  }, [])

  const exit360 = useCallback(() => {
    setViewMode('map')
    setSelectedZone(null)
  }, [])

  return (
<div style={{
      width: '100%',
      height: '100vh',
      position: 'relative',
      background: '#f0efe9',
      fontFamily: 'system-ui, sans-serif',
    }}>

      {/* ── MODE TOGGLE ── */}
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        zIndex: 100,
        display: 'flex',
        gap: '4px',
        background: 'rgba(255,255,255,0.9)',
        padding: '5px',
        borderRadius: '12px',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(0,0,0,0.08)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
      }}>
        {[
          { id: 'map', label: '🗺️  Planta' },
          { id: '360', label: '📸  360°' },
        ].map(mode => (
<button
            key={mode.id}
            onClick={() => {
              if (mode.id === '360' && !selectedZone) setSelectedZone(ZONES[0])
              setViewMode(mode.id)
            }}
            style={{
              background: viewMode === mode.id ? '#2c2c2c' : 'transparent',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 18px',
              color: viewMode === mode.id ? 'white' : '#666',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: viewMode === mode.id ? 'bold' : 'normal',
              transition: 'all 0.2s',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {/* ── TOP-DOWN MAP VIEW ── */}
      {viewMode === 'map' && (
        <TopDownMap onZoneClick={handleZoneClick} activeZone={null} />
      )}

      {/* ── 360 VIEW ── */}
      {viewMode === '360' && selectedZone && (
        <PanoramaViewer
          zone={selectedZone}
          onNavigate={handleNavigate}
          onExit={exit360}
        />
      )}
    </div>
  )
}
