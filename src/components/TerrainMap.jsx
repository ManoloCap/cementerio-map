import { useRef, useState, useEffect, useCallback } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Text, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

// ─── Config ───────────────────────────────────────────────────────────
const ZONES = [
  {
    id: 'A',
    position: [-5, 0, -5],
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
    position: [5, 0, -5],
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
    position: [-5, 0, 5],
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
    position: [5, 0, 5],
    color: '#9b59b6',
    label: 'D',
    title: 'Servicios administrativos',
    description: 'Oficinas, chapelle y sala de velación',
    connections: ['B', 'C'],
    panorama: 'https://pannellum.org/images/cerro.jpg',
    heading: 270,
  },
]

// ─── 3D Components ─────────────────────────────────────────────────────

function Terrain() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[20, 20, 32, 32]} />
      <meshStandardMaterial color="#4a7c59" wireframe={false} />
    </mesh>
  )
}

function GridLines() {
  return (
    <gridHelper args={[20, 20, '#2d5a3d', '#2d5a3d']} position={[0, 0.01, 0]} />
  )
}

function HoverCircle({ zone, onHover }) {
  const meshRef = useRef()
  const [hovered, setHovered] = useState(false)

  useFrame((state) => {
    if (hovered) {
      meshRef.current.position.y = 0.35 + Math.sin(state.clock.elapsedTime * 3) * 0.1
    } else {
      meshRef.current.position.y = 0.15
    }
  })

  return (
    <group position={zone.position}>
      <mesh
        ref={meshRef}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); onHover(zone) }}
        onPointerOut={() => setHovered(false)}
        position={[0, 0.15, 0]}
      >
        <cylinderGeometry args={[0.85, 0.85, 0.12, 32]} />
        <meshStandardMaterial
          color={hovered ? zone.color : '#8b4513'}
          emissive={hovered ? zone.color : '#000000'}
          emissiveIntensity={hovered ? 0.6 : 0}
        />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.95, 1.05, 0.05, 32]} />
        <meshStandardMaterial color="#654321" />
      </mesh>
      <Text
        position={[0, 0.55, 0]}
        fontSize={0.32}
        color="white"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.025}
        outlineColor="#000000"
      >
        {zone.label}
      </Text>
    </group>
  )
}

function Scene({ onHover }) {
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[10, 12, 5]} intensity={1.2} castShadow />
      <pointLight position={[-8, 5, -8]} intensity={0.4} color="#fffae6" />
      <pointLight position={[8, 5, 8]} intensity={0.3} color="#e6f0ff" />
      <fog attach="fog" args={['#1a1a2e', 25, 50]} />
      <Terrain />
      <GridLines />
      {ZONES.map(zone => (
        <HoverCircle key={zone.id} zone={zone} onHover={onHover} />
      ))}
    </>
  )
}

// ─── 360 Viewer (vanilla Pannellum) ────────────────────────────────────

function PanoramaViewer({ zone, onNavigate }) {
  const containerRef = useRef()
  const viewerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Destroy previous viewer
    if (viewerRef.current) {
      try { viewerRef.current.destroy() } catch (e) {}
      viewerRef.current = null
    }

    // Clear container
    containerRef.current.innerHTML = ''

    // Create new Pannellum viewer
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
      onLoad: () => {
        console.log('Panorama loaded:', zone.id)
      },
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
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Pannellum container */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Current zone label – top center */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        background: `${zone.color}dd`,
        padding: '12px 28px',
        borderRadius: '0 0 16px 16px',
        color: 'white',
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 'bold',
        fontSize: '15px',
        textAlign: 'center',
        boxShadow: `0 4px 24px ${zone.color}66`,
        zIndex: 10,
      }}>
        <div style={{ fontSize: '11px', opacity: 0.85, marginBottom: '2px', letterSpacing: '1px' }}>
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
        gap: '16px',
        zIndex: 10,
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
                borderRadius: '12px',
                padding: '10px 22px',
                color: 'white',
                fontFamily: 'system-ui, sans-serif',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
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
              <span style={{ fontSize: '20px' }}>→</span>
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
        maxWidth: '260px',
        borderLeft: `4px solid ${zone.color}`,
        backdropFilter: 'blur(8px)',
      }}>
        <div style={{ fontSize: '11px', color: zone.color, fontWeight: 'bold', letterSpacing: '1px', marginBottom: '4px' }}>
          ZONA {zone.id}
        </div>
        <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '4px' }}>{zone.title}</div>
        <div style={{ fontSize: '13px', color: '#bbb', lineHeight: '1.4' }}>{zone.description}</div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────

export default function TerrainMap() {
  const [viewMode, setViewMode] = useState('map') // 'map' | '360'
  const [selectedZone, setSelectedZone] = useState(null)
  const [hoveredInfo, setHoveredInfo] = useState(null)

  const handleZoneHover = useCallback((zone) => setHoveredInfo(zone), [])
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
      background: viewMode === '360' ? '#000' : 'linear-gradient(to bottom, #1a1a2e, #16213e)',
      fontFamily: 'system-ui, sans-serif',
    }}>

      {/* ── MODE TOGGLE ── */}
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        zIndex: 100,
        display: 'flex',
        gap: '6px',
        background: 'rgba(0,0,0,0.6)',
        padding: '6px',
        borderRadius: '12px',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.1)',
      }}>
        {[
          { id: 'map', label: '🗺️  Mapa 3D' },
          { id: '360', label: '📸  Vista 360' },
        ].map(mode => (
          <button
            key={mode.id}
            onClick={() => {
              if (mode.id === '360' && !selectedZone) setSelectedZone(ZONES[0])
              setViewMode(mode.id)
            }}
            style={{
              background: viewMode === mode.id ? 'rgba(255,255,255,0.2)' : 'transparent',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 16px',
              color: viewMode === mode.id ? 'white' : '#aaa',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: viewMode === mode.id ? 'bold' : 'normal',
              transition: 'all 0.2s',
            }}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {/* ── 3D MAP VIEW ── */}
      {viewMode === 'map' && (
        <>
          <Canvas
            shadows
            camera={{ position: [14, 11, 14], fov: 50 }}
            style={{ width: '100%', height: '100%' }}
            onPointerMissed={() => setHoveredInfo(null)}
          >
            <Scene onHover={handleZoneHover} />
            <OrbitControls
              enablePan
              enableZoom
              enableRotate
              minDistance={8}
              maxDistance={30}
              maxPolarAngle={Math.PI / 2.2}
            />
          </Canvas>

          {/* Hover info panel */}
          <div style={{
            position: 'absolute',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: hoveredInfo ? 'rgba(0,0,0,0.88)' : 'rgba(0,0,0,0.45)',
            padding: hoveredInfo ? '16px 28px' : '10px 20px',
            borderRadius: '14px',
            color: 'white',
            minWidth: '260px',
            textAlign: 'center',
            border: hoveredInfo ? `2px solid ${hoveredInfo.color}` : '2px solid transparent',
            transition: 'all 0.3s ease',
            backdropFilter: 'blur(8px)',
          }}>
            {hoveredInfo ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '6px' }}>
                  <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: hoveredInfo.color, boxShadow: `0 0 8px ${hoveredInfo.color}` }} />
                  <strong style={{ fontSize: '20px' }}>Zona {hoveredInfo.label}</strong>
                </div>
                <div style={{ color: hoveredInfo.color, fontSize: '13px', marginBottom: '4px' }}>{hoveredInfo.title}</div>
                <div style={{ color: '#aaa', fontSize: '12px' }}>{hoveredInfo.description}</div>
                <button
                  onClick={() => handleZoneClick(hoveredInfo)}
                  style={{
                    marginTop: '10px',
                    background: hoveredInfo.color,
                    border: 'none',
                    borderRadius: '8px',
                    padding: '7px 18px',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 'bold',
                  }}
                >
                  📸 Ver en 360
                </button>
              </>
            ) : (
              <span style={{ color: '#888', fontSize: '13px' }}>✋ Hover over a circle to see details</span>
            )}
          </div>

          {/* Legend */}
          <div style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: 'rgba(0,0,0,0.7)',
            padding: '14px 18px',
            borderRadius: '12px',
            color: 'white',
            fontSize: '13px',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{ marginBottom: '10px', fontWeight: 'bold', fontSize: '11px', color: '#aaa', letterSpacing: '1px' }}>PUNTOS DE INTERÉS</div>
            {ZONES.map(zone => (
              <div
                key={zone.id}
                onClick={() => handleZoneClick(zone)}
                onMouseEnter={e => e.currentTarget.style.background = `${zone.color}33`}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '6px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: zone.color, boxShadow: `0 0 6px ${zone.color}` }} />
                <span style={{ fontWeight: 'bold', color: zone.color }}>{zone.id}</span>
                <span style={{ color: '#ddd' }}>{zone.title}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── 360 VIEW ── */}
      {viewMode === '360' && selectedZone && (
        <>
          <PanoramaViewer
            zone={selectedZone}
            onNavigate={handleNavigate}
          />

          {/* Exit button */}
          <button
            onClick={exit360}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              zIndex: 200,
              background: 'rgba(0,0,0,0.7)',
              border: '2px solid rgba(255,255,255,0.25)',
              borderRadius: '12px',
              padding: '10px 20px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            ✕ Volver al mapa
          </button>
        </>
      )}
    </div>
  )
}