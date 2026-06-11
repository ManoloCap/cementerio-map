import { useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Text, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

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

function HoverCircle({ position, label, color, description, onHover }) {
  const meshRef = useRef()
  const [hovered, setHovered] = useState(false)
  const [scale, setScale] = useState(1)

  useFrame((state) => {
    if (hovered) {
      setScale(prev => Math.min(prev + 0.05, 1.4))
      meshRef.current.position.y = 0.3 + Math.sin(state.clock.elapsedTime * 3) * 0.1
    } else {
      setScale(prev => Math.max(prev - 0.05, 1))
      meshRef.current.position.y = 0.15
    }
  })

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); onHover({ label, description, color }) }}
        onPointerOut={() => setHovered(false)}
        position={[0, 0.15, 0]}
      >
        <cylinderGeometry args={[0.8, 0.8, 0.1, 32]} />
        <meshStandardMaterial
          color={hovered ? color : '#8b4513'}
          emissive={hovered ? color : '#000000'}
          emissiveIntensity={hovered ? 0.5 : 0}
        />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.9, 1, 0.05, 32]} />
        <meshStandardMaterial color="#654321" />
      </mesh>
      <Text
        position={[0, 0.5, 0]}
        fontSize={0.3}
        color="white"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#000000"
      >
        {label}
      </Text>
    </group>
  )
}

function Scene({ onHover }) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
      <pointLight position={[-10, 5, -10]} intensity={0.5} color="#fffae6" />
      <Terrain />
      <GridLines />
      <HoverCircle
        position={[-5, 0, -5]}
        label="A"
        color="#e74c3c"
        description="Zona de lápidas antiguas"
        onHover={onHover}
      />
      <HoverCircle
        position={[5, 0, -5]}
        label="B"
        color="#3498db"
        description="Área de mausoleos"
        onHover={onHover}
      />
      <HoverCircle
        position={[-5, 0, 5]}
        label="C"
        color="#f39c12"
        description="Jardín memorial"
        onHover={onHover}
      />
      <HoverCircle
        position={[5, 0, 5]}
        label="D"
        color="#9b59b6"
        description="Servicios administrativos"
        onHover={onHover}
      />
    </>
  )
}

export default function TerrainMap() {
  const [hoveredInfo, setHoveredInfo] = useState(null)

  return (
    <div style={{ width: '100%', height: '500px', position: 'relative' }}>
      <Canvas
        shadows
        camera={{ position: [12, 10, 12], fov: 50 }}
        style={{ background: 'linear-gradient(to bottom, #1a1a2e, #16213e)' }}
      >
        <Scene onHover={setHoveredInfo} />
        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          minDistance={8}
          maxDistance={30}
          maxPolarAngle={Math.PI / 2.2}
        />
      </Canvas>

      {/* Info panel */}
      <div style={{
        position: 'absolute',
        bottom: '20px',
        left: '20px',
        background: 'rgba(0,0,0,0.85)',
        padding: '16px 24px',
        borderRadius: '12px',
        color: 'white',
        fontFamily: 'system-ui, sans-serif',
        minWidth: '200px',
        transition: 'all 0.3s ease',
        border: hoveredInfo ? `2px solid ${hoveredInfo.color}` : '2px solid transparent',
      }}>
        {hoveredInfo ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <div style={{
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                background: hoveredInfo.color,
                boxShadow: `0 0 8px ${hoveredInfo.color}`,
              }} />
              <strong style={{ fontSize: '18px' }}>{hoveredInfo.label}</strong>
            </div>
            <p style={{ margin: 0, color: '#ccc', fontSize: '14px' }}>{hoveredInfo.description}</p>
          </>
        ) : (
          <p style={{ margin: 0, color: '#888', fontSize: '14px' }}>
            ✋ Haz hover sobre un círculo para más info
          </p>
        )}
      </div>

      {/* Legend */}
      <div style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        background: 'rgba(0,0,0,0.7)',
        padding: '12px 16px',
        borderRadius: '8px',
        color: 'white',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
      }}>
        <div style={{ marginBottom: '6px', fontWeight: 'bold' }}>Leyenda</div>
        {[
          { label: 'A', color: '#e74c3c' },
          { label: 'B', color: '#3498db' },
          { label: 'C', color: '#f39c12' },
          { label: 'D', color: '#9b59b6' },
        ].map(({ label, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: color }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}