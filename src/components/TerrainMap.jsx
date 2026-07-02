import { useRef, useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF, Html } from '@react-three/drei'
import * as THREE from 'three'
import CEMETERY_POINTS from './cemetery_points.json'

// ─── Config ───────────────────────────────────────────────────────────

const AREAS = {
  demo: {
    id: 'demo',
    name: 'Área 0 (Demo)',
    color: '#e74c3c', // crimson
    points: CEMETERY_POINTS.demo,
    boundary: { xMin: 47, xMax: 53, yMin: 25, yMax: 75, label: 'ÁREA 0: Demo' }
  },
  cipreses: {
    id: 'cipreses',
    name: 'Cipreses',
    color: '#16a085', // patina green
    points: CEMETERY_POINTS.cipreses,
    boundary: { xMin: 12, xMax: 18, yMin: 10, yMax: 92, label: 'Cipreses' }
  },
  bugambilias: {
    id: 'bugambilias',
    name: 'Bugambilias',
    color: '#9b59b6', // amethyst
    points: CEMETERY_POINTS.bugambilias,
    boundary: { xMin: 19, xMax: 25, yMin: 10, yMax: 87, label: 'Bugambilias' }
  },
  encinos: {
    id: 'encinos',
    name: 'Encinos',
    color: '#3498db', // ocean blue
    points: CEMETERY_POINTS.encinos,
    boundary: [
      { xMin: 37, xMax: 43, yMin: 55, yMax: 80, label: 'Encinos (Patio)' },
      { xMin: 27, xMax: 33, yMin: 15, yMax: 85, label: 'Encinos (Camino)' }
    ]
  },
  unknown_section_1: {
    id: 'unknown_section_1',
    name: 'Sección Desconocida 1',
    color: '#7f8c8d', // ash gray
    points: CEMETERY_POINTS.unknown_section_1,
    boundary: { xMin: 67, xMax: 78, yMin: 15, yMax: 90, label: 'Sección Desconocida 1' }
  },
  unknown_section_2: {
    id: 'unknown_section_2',
    name: 'Sección Desconocida 2',
    color: '#7f8c8d',
    points: CEMETERY_POINTS.unknown_section_2,
    boundary: { xMin: 79, xMax: 88, yMin: 15, yMax: 90, label: 'Sección Desconocida 2' }
  },
  comoding_1: {
    id: 'comoding_1',
    name: 'Comodín 1',
    color: '#f39c12', // amber
    points: CEMETERY_POINTS.comoding_1,
    boundary: { xMin: 42, xMax: 48, yMin: 20, yMax: 85, label: 'Comodín 1' }
  },
  paseo_cipreses: {
    id: 'paseo_cipreses',
    name: 'Paseo Cipreses',
    color: '#d35400', // burnt orange
    points: CEMETERY_POINTS.paseo_cipreses,
    boundary: { xMin: 57, xMax: 63, yMin: 15, yMax: 90, label: 'Paseo Cipreses' }
  },
  comoding_2: {
    id: 'comoding_2',
    name: 'Comodín 2',
    color: '#27ae60', // forest green
    points: CEMETERY_POINTS.comoding_2,
    boundary: { xMin: 89, xMax: 95, yMin: 20, yMax: 85, label: 'Comodín 2' }
  },
  area7: {
    id: 'area7',
    name: '7A (Sección Desconocida)',
    color: '#7f8c8d',
    points: CEMETERY_POINTS.area7,
    boundary: { xMin: 3, xMax: 10, yMin: 10, yMax: 92, label: '7A (Sección Desconocida)' }
  }
}

// ─── Connection & Hotspot Engine ──────────────────────────────────────
function getNeighbors(points, idx, areaId) {
  const neighbors = []
  if (idx > 0) neighbors.push(points[idx - 1])
  if (idx < points.length - 1) neighbors.push(points[idx + 1])
  return neighbors
}

function prepareZones(points, areaId) {
  const areaColor = AREAS[areaId]?.color || '#7f8c8d'
  return points.map((p, idx) => {
    const neighbors = getNeighbors(points, idx, areaId)
    const hotspots = neighbors.map(n => {
      // Check for manual overrides in JSON
      const override = p.hotspotOverrides && p.hotspotOverrides[n.id]
      
      let yaw, pitch
      if (override) {
        yaw = override.yaw
        pitch = override.pitch !== undefined ? override.pitch : -15
      } else {
        const dx = n.position.x - p.position.x
        const dy = p.position.y - n.position.y // smaller y is North (up)
        
        let theta = Math.atan2(dy, dx) * (180 / Math.PI)
        if (theta < 0) theta += 360
        
        // Camera heading offset calculation
        yaw = Math.round((360 - theta) % 360)
        pitch = -15
      }
      
      return {
        yaw,
        pitch,
        targetId: n.id,
        label: `Avanzar a ${n.title}`
      }
    })
    
    return {
      ...p,
      label: p.id,
      color: areaColor,
      connections: neighbors.map(n => n.id),
      hotspots
    }
  })
}

function prepareAllZones(cemeteryPoints) {
  let allZones = []
  Object.keys(cemeteryPoints).forEach(areaId => {
    const points = cemeteryPoints[areaId]
    const areaZones = prepareZones(points, areaId)
    const zonesWithArea = areaZones.map(z => ({
      ...z,
      areaId
    }))
    allZones = allZones.concat(zonesWithArea)
  })
  return allZones
}

// ─── Image Preloader ──────────────────────────────────────────────────
const imageCache = {
  status: {},   // url -> 'loading' | 'loaded' | 'error'
  promises: {}, // url -> Promise
}

function preloadImage(url) {
  if (imageCache.promises[url]) return imageCache.promises[url]
  console.log(`[Preloader] Started preloading image: ${url}`)
  imageCache.status[url] = 'loading'
  imageCache.promises[url] = new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      console.log(`[Preloader] Successfully preloaded image: ${url}`)
      imageCache.status[url] = 'loaded'
      resolve(true)
    }
    img.onerror = (e) => {
      console.error(`[Preloader] Failed to preload image: ${url}`, e)
      imageCache.status[url] = 'error'
      resolve(false)
    }
    img.src = url
  })
  return imageCache.promises[url]
}

function preloadAllImages(zones) {
  return Promise.all(zones.filter(z => z.panorama).map(z => preloadImage(z.panorama)))
}

function refreshImageCache(zones) {
  zones.forEach(z => {
    if (z.panorama) {
      delete imageCache.promises[z.panorama]
      delete imageCache.status[z.panorama]
    }
  })
  return preloadAllImages(zones)
}

function getCacheStatus(zones) {
  const total = zones.filter(z => z.panorama).length
  const loaded = zones.filter(z => imageCache.status[z.panorama] === 'loaded').length
  const loading = zones.filter(z => imageCache.status[z.panorama] === 'loading').length
  const errors = zones.filter(z => imageCache.status[z.panorama] === 'error').length
  return { total, loaded, loading, errors }
}

// ─── 360 Viewer Helper ────────────────────────────────────────────────
function createHotspotConfig(hs, sourceId, onNavigate, zonesList, onHotspotRightClick, navigatingRef, pendingOrientationRef, setIsTransitioning, viewerRef) {
  return {
    pitch: hs.pitch,
    yaw: hs.yaw,
    type: 'info',
    cssClass: 'nav-arrow-hotspot',
    id: `${sourceId}-to-${hs.targetId}`,
    clickHandlerFunc: (e, args) => {
      if (e) {
        e.stopPropagation()
        e.preventDefault()
      }
      if (navigatingRef.current) return
      navigatingRef.current = true

      setIsTransitioning(true)
      
      if (viewerRef.current) {
        pendingOrientationRef.current = {
          pitch: viewerRef.current.getPitch(),
          yaw: viewerRef.current.getYaw(),
          hfov: viewerRef.current.getHfov()
        }
      }

      setTimeout(() => {
        onNavigate(args.targetId)
      }, 400)
    },
    clickHandlerArgs: { targetId: hs.targetId },
    createTooltipFunc: (hotSpotDiv, args) => {
      hotSpotDiv.innerHTML = ''
      hotSpotDiv.style.width = '60px'
      hotSpotDiv.style.height = '60px'
      hotSpotDiv.style.cursor = 'pointer'

      const arrowIcon = document.createElement('div')
      arrowIcon.className = 'custom-streetview-arrow-icon'
      arrowIcon.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
        </svg>
      `
      hotSpotDiv.appendChild(arrowIcon)

      // Context menu (Right click) to trigger moving the hotspot
      hotSpotDiv.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        e.stopPropagation()
        onHotspotRightClick(sourceId, args.targetId)
      })

      const targetZone = zonesList.find(z => z.id === args.targetId)
      const targetTitle = targetZone ? targetZone.title : `Punto ${args.targetId}`

      const cloud = document.createElement('div')
      cloud.className = 'nav-arrow-cloud'
      cloud.innerHTML = `
        <div class="nav-arrow-cloud-subtitle">Siguiente Paso · ${args.targetId}</div>
        <div class="nav-arrow-cloud-title">${targetTitle}</div>
        <div class="nav-arrow-cloud-caret"></div>
      `
      hotSpotDiv.appendChild(cloud)
    },
    createTooltipArgs: { targetId: hs.targetId },
  }
}

// ─── 360 Viewer ───────────────────────────────────────────────────────
function PanoramaViewer({ zone, onNavigate, onExit, zonesList, movingHotspot, onHotspotRightClick, onMoveHotspot }) {
  const containerRef = useRef()
  const viewerRef = useRef(null)
  const [viewerInstance, setViewerInstance] = useState(null)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const navigatingRef = useRef(false)
  const pendingOrientationRef = useRef(null)

  const onNavigateRef = useRef(onNavigate)
  const zonesListRef = useRef(zonesList)
  const onHotspotRightClickRef = useRef(onHotspotRightClick)
  const onMoveHotspotRef = useRef(onMoveHotspot)
  const movingHotspotRef = useRef(movingHotspot)

  useEffect(() => { onNavigateRef.current = onNavigate }, [onNavigate])
  useEffect(() => { zonesListRef.current = zonesList }, [zonesList])
  useEffect(() => { onHotspotRightClickRef.current = onHotspotRightClick }, [onHotspotRightClick])
  useEffect(() => { onMoveHotspotRef.current = onMoveHotspot }, [onMoveHotspot])
  useEffect(() => { movingHotspotRef.current = movingHotspot }, [movingHotspot])

  const zoneId = zone.id

  // 1. Initialize Pannellum
  useEffect(() => {
    if (!containerRef.current) return

    if (!viewerRef.current) {
      const scenes = {}
      zonesListRef.current.forEach(z => {
        scenes[z.id] = {
          type: 'equirectangular',
          panorama: z.panorama,
          yaw: z.heading || 0,
          pitch: 0,
          hfov: 120,
          maxHfov: 120,
          hotSpots: (z.hotspots || []).map(hs => 
            createHotspotConfig(
              hs, 
              z.id, 
              onNavigateRef.current, 
              zonesListRef.current, 
              onHotspotRightClickRef.current, 
              navigatingRef, 
              pendingOrientationRef, 
              setIsTransitioning, 
              viewerRef
            )
          )
        }
      })

      console.log(`[Pannellum] Initializing viewer. First scene: ${zoneId}`)
      const viewer = window.pannellum.viewer(containerRef.current, {
        default: {
          firstScene: zoneId,
          sceneFadeDuration: 0,
          showControls: true,
          compass: true,
          showZoomCtrl: false,
          mouseZoom: true,
          friction: 0.15,
        },
        scenes: scenes
      })

      viewer.on('load', () => {
        console.log(`[Pannellum] Scene loaded successfully: ${viewer.getScene()}`)
        setIsTransitioning(false)
        navigatingRef.current = false
      })

      viewer.on('error', (errMsg) => {
        console.error(`[Pannellum] Viewer error:`, errMsg)
      })

      viewerRef.current = viewer
      setViewerInstance(viewer)
    } else {
      if (viewerRef.current.getScene() !== zoneId) {
        console.log(`[Pannellum] Switching scene from ${viewerRef.current.getScene()} to ${zoneId}`)
        if (pendingOrientationRef.current) {
          const { pitch, yaw, hfov } = pendingOrientationRef.current
          viewerRef.current.loadScene(zoneId, pitch, yaw, hfov)
          pendingOrientationRef.current = null
        } else {
          viewerRef.current.loadScene(zoneId)
        }
      }
    }
  }, [zoneId])

  // 2. Dynamic Hotspot Overrides (updates hotspot locations without reloading the scene)
  useEffect(() => {
    if (!viewerInstance) return
    const currentZoneData = zonesList.find(z => z.id === zoneId)
    if (!currentZoneData) return

    // 1. Clear Pannellum's internal scene hotspots from config and DOM cleanly to prevent duplicates
    const config = viewerInstance.getConfig()
    if (config && config.scenes && config.scenes[zoneId]) {
      const currentHsList = [...(config.scenes[zoneId].hotSpots || [])]
      currentHsList.forEach(hs => {
        try {
          viewerInstance.removeHotSpot(hs.id)
        } catch {
          // ignore
        }
      })
      config.scenes[zoneId].hotSpots = []
    }

    // 2. Re-generate the hotspot configurations based on current zonesList
    const newConfigs = (currentZoneData.hotspots || []).map(hs => 
      createHotspotConfig(
        hs, 
        zoneId, 
        onNavigateRef.current, 
        zonesListRef.current, 
        onHotspotRightClickRef.current, 
        navigatingRef, 
        pendingOrientationRef, 
        setIsTransitioning, 
        viewerRef
      )
    )

    // 3. Add updated hotspots to the active scene (Pannellum automatically pushes to scenes[zoneId].hotSpots)
    newConfigs.forEach(newHsConfig => {
      try {
        viewerInstance.addHotSpot(newHsConfig)
        console.log(`[Pannellum] In-place updated hotspot: ${newHsConfig.id} (yaw: ${newHsConfig.yaw}, pitch: ${newHsConfig.pitch})`)
      } catch (err) {
        console.error(`[Pannellum] Error updating active hotspot:`, err)
      }
    })
  }, [viewerInstance, zonesList, zoneId])

  // 3. Mouse Click listener to handle moving target coordinates
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let startX = 0, startY = 0, startTime = 0

    const handleMouseDown = (e) => {
      if (e.button !== 0) return // Left click only!
      startX = e.clientX
      startY = e.clientY
      startTime = Date.now()
    }

    const handleMouseUp = (e) => {
      if (e.button !== 0) return // Left click only!
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      const dt = Date.now() - startTime

      // Detect quick click (not a drag)
      if (Math.sqrt(dx * dx + dy * dy) < 5 && dt < 300) {
        if (movingHotspotRef.current && viewerInstance) {
          const coords = viewerInstance.mouseEventToCoords(e)
          if (coords) {
            const [pitch, yaw] = coords
            console.log(`[Pannellum] Relocating hotspot target connection ${movingHotspotRef.current.targetId} to pitch: ${pitch}, yaw: ${yaw}`)
            onMoveHotspotRef.current(
              movingHotspotRef.current.sourceId,
              movingHotspotRef.current.targetId,
              pitch,
              yaw
            )
          }
        }
      }
    }

    container.addEventListener('mousedown', handleMouseDown)
    container.addEventListener('mouseup', handleMouseUp)

    return () => {
      container.removeEventListener('mousedown', handleMouseDown)
      container.removeEventListener('mouseup', handleMouseUp)
    }
  }, [viewerInstance])

  useEffect(() => {
    return () => {
      if (viewerRef.current) {
        try { viewerRef.current.destroy() } catch {
          // ignore
        }
        viewerRef.current = null
        setViewerInstance(null)
      }
    }
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#000', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Styled cursor when moving hotspot */}
      {movingHotspot && (
        <style dangerouslySetInnerHTML={{__html: `
          .pnlm-grab, .pnlm-container, .pnlm-render-container {
            cursor: crosshair !important;
          }
        `}} />
      )}

      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(240,239,233,0.45)',
        backdropFilter: isTransitioning ? 'blur(15px)' : 'blur(0px)',
        opacity: isTransitioning ? 1 : 0,
        pointerEvents: isTransitioning ? 'all' : 'none',
        transition: 'opacity 0.4s ease, backdrop-filter 0.4s ease',
        zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {isTransitioning && (
          <div style={{ color: 'rgba(0,0,0,0.3)', fontSize: '13px', fontFamily: 'system-ui,sans-serif', letterSpacing: '2px', textTransform: 'uppercase' }}>
            Cargando…
          </div>
        )}
      </div>

      <div style={{
        position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
        background: `${zone.color}dd`, padding: '10px 28px',
        borderRadius: '0 0 16px 16px', color: 'white',
        fontFamily: 'system-ui,sans-serif', fontWeight: 'bold', fontSize: '14px',
        textAlign: 'center', boxShadow: `0 4px 24px ${zone.color}66`, zIndex: 10,
      }}>
        <div style={{ fontSize: '10px', opacity: 0.85, marginBottom: '2px', letterSpacing: '1.5px' }}>PUNTO {zone.id}</div>
        {zone.title}
      </div>

      <div style={{
        position: 'absolute', bottom: '24px', left: '24px', zIndex: 10,
        background: 'rgba(0,0,0,0.75)', padding: '14px 18px', borderRadius: '12px',
        color: 'white', fontFamily: 'system-ui,sans-serif', maxWidth: '240px',
        borderLeft: `4px solid ${zone.color}`, backdropFilter: 'blur(8px)',
      }}>
        <div style={{ fontSize: '10px', color: zone.color, fontWeight: 'bold', letterSpacing: '1px', marginBottom: '4px' }}>ZONA {zone.id}</div>
        <div style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '4px' }}>{zone.title}</div>
        <div style={{ fontSize: '12px', color: '#bbb', lineHeight: '1.4' }}>{zone.description}</div>
      </div>

      <button onClick={onExit} style={{
        position: 'absolute', top: '20px', right: '20px', zIndex: 200,
        background: 'rgba(0,0,0,0.7)', border: '2px solid rgba(255,255,255,0.25)',
        borderRadius: '10px', padding: '9px 18px', color: 'white', cursor: 'pointer',
        fontSize: '13px', fontWeight: 'bold', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'system-ui,sans-serif',
      }}>
        ✕ Volver al mapa
      </button>

      <style dangerouslySetInnerHTML={{__html: `
        .pnlm-hotspot.nav-arrow-hotspot,
        div.nav-arrow-hotspot {
          background: transparent !important;
          border: none !important;
          padding: 0 !important;
          width: 60px !important;
          height: 60px !important;
          overflow: visible !important;
        }
        .nav-arrow-hotspot .pnlm-pointer,
        .nav-arrow-hotspot .pnlm-tooltip,
        .nav-arrow-hotspot > span {
          display: none !important;
        }
        .custom-streetview-arrow-icon {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 0.2s ease, filter 0.2s ease;
          filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6));
        }
        .custom-streetview-arrow-icon svg {
          width: 80%;
          height: 80%;
          fill: #3498db;
        }
        .custom-streetview-arrow-icon:hover {
          transform: scale(1.3);
          filter: drop-shadow(0 0 12px rgba(52,152,219,0.9)) drop-shadow(0 4px 10px rgba(0,0,0,0.7));
        }
        .nav-arrow-cloud {
          position: absolute;
          background: white;
          padding: 8px 14px;
          border-radius: 10px;
          box-shadow: 0 6px 20px rgba(0,0,0,0.15);
          font-family: system-ui, sans-serif;
          text-align: center;
          top: -10px;
          left: 50%;
          pointer-events: none;
          visibility: hidden;
          opacity: 0;
          transform: translate(-50%, -90%) scale(0.9);
          transition: opacity 0.25s cubic-bezier(0.34,1.56,0.64,1), transform 0.25s cubic-bezier(0.34,1.56,0.64,1);
          z-index: 9999 !important;
        }
        .nav-arrow-hotspot:hover .nav-arrow-cloud {
          visibility: visible;
          opacity: 1;
          transform: translate(-50%, -100%) scale(1);
        }
        .nav-arrow-cloud-subtitle {
          font-size: 10px; color: #3498db; font-weight: 800;
          text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px;
        }
        .nav-arrow-cloud-title {
          font-size: 13px; color: #2c2c2c; font-weight: bold; white-space: nowrap;
        }
        .nav-arrow-cloud-caret {
          position: absolute; bottom: -6px; left: 50%;
          transform: translateX(-50%);
          width: 0; height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 6px solid white;
        }
      `}} />
    </div>
  )
}

// ─── Top-Down Map View ─────────────────────────────────────────────────
function TopDownMap({ zones, onZoneClick, activeZone }) {
  const [scale, setScale] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const containerRef = useRef(null)

  const handleMouseDown = (e) => {
    // Left click only, ignore when clicking zone markers (so they can be selected without starting a drag click)
    if (e.button !== 0) return
    setIsPanning(true)
    setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y })
  }

  const handleMouseMove = (e) => {
    if (!isPanning) return
    setPanOffset({
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y
    })
  }

  const handleMouseUp = () => {
    setIsPanning(false)
  }

  const handleWheel = (e) => {
    e.preventDefault()
    const zoomFactor = 1.1
    const nextScale = e.deltaY < 0 ? scale * zoomFactor : scale / zoomFactor
    const boundedScale = Math.max(0.5, Math.min(8, nextScale))
    
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      
      const newOffsetX = mouseX - (mouseX - panOffset.x) * (boundedScale / scale)
      const newOffsetY = mouseY - (mouseY - panOffset.y) * (boundedScale / scale)
      
      setScale(boundedScale)
      setPanOffset({ x: newOffsetX, y: newOffsetY })
    }
  }

  const resetView = () => {
    setScale(1)
    setPanOffset({ x: 0, y: 0 })
  }

  return (
    <div 
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      style={{ 
        width: '100%', height: '100%', position: 'relative', background: '#f0efe9', 
        overflow: 'hidden', cursor: isPanning ? 'grabbing' : 'grab', userSelect: 'none' 
      }}
    >
      {/* Zoom / Pan Inner Canvas */}
      <div style={{
        width: '100%', height: '100%',
        transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${scale})`,
        transformOrigin: '0 0',
        position: 'absolute', inset: 0,
        transition: isPanning ? 'none' : 'transform 0.1s ease-out'
      }}>
        {/* Grid pattern */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.07 }}
          viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#333" strokeWidth="0.3" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#grid)" />
        </svg>

        {/* Marked boundary areas of all areas */}
        {Object.values(AREAS).map(area => {
          if (!area.boundary) return null
          const color = area.color
          return (
            <svg key={area.id} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
              viewBox="0 0 100 100" preserveAspectRatio="none">
              {Array.isArray(area.boundary) ? (
                area.boundary.map((b, idx) => (
                  <g key={idx}>
                    <rect
                      x={b.xMin}
                      y={b.yMin}
                      width={b.xMax - b.xMin}
                      height={b.yMax - b.yMin}
                      fill={`${color}06`}
                      stroke={color}
                      strokeWidth="0.4"
                      strokeDasharray="1,1"
                      rx="2"
                    />
                    <text
                      x={b.xMin + 1}
                      y={b.yMin + 3.5}
                      fill={color}
                      fontSize="2.2px"
                      fontWeight="bold"
                      fontFamily="system-ui,sans-serif"
                      letterSpacing="0.1px"
                    >
                      {b.label}
                    </text>
                  </g>
                ))
              ) : (
                <g>
                  <rect
                    x={area.boundary.xMin}
                    y={area.boundary.yMin}
                    width={area.boundary.xMax - area.boundary.xMin}
                    height={area.boundary.yMax - area.boundary.yMin}
                    fill={`${color}06`}
                    stroke={color}
                    strokeWidth="0.4"
                    strokeDasharray="1,1"
                    rx="2"
                  />
                  <text
                    x={area.boundary.xMin + 1}
                    y={area.boundary.yMin + 3.5}
                    fill={color}
                    fontSize="2.2px"
                    fontWeight="bold"
                    fontFamily="system-ui,sans-serif"
                    letterSpacing="0.1px"
                  >
                    {area.boundary.label}
                  </text>
                </g>
              )}
            </svg>
          )
        })}

        {/* Connection lines */}
        {zones.length >= 2 && (
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            viewBox="0 0 100 100" preserveAspectRatio="none">
            {zones.flatMap(zone =>
              (zone.connections || []).map(targetId => {
                const target = zones.find(z => z.id === targetId)
                if (!target) return null
                return (
                  <line key={`${zone.id}-${targetId}`}
                    x1={zone.position.x} y1={zone.position.y}
                    x2={target.position.x} y2={target.position.y}
                    stroke={`${zone.color}bb`} strokeWidth="1.2" strokeDasharray="2,2" />
                )
              })
            )}
          </svg>
        )}

        {/* Zone markers */}
        {zones.map(zone => {
          const isActive = activeZone?.id === zone.id
          return (
            <div key={zone.id} 
              onClick={(e) => {
                e.stopPropagation();
                onZoneClick(zone);
              }}
              style={{
                position: 'absolute', left: `${zone.position.x}%`, top: `${zone.position.y}%`,
                transform: 'translate(-50%, -50%)', cursor: 'pointer', zIndex: 10,
              }}>
              <div style={{
                width: isActive ? '72px' : '60px', height: isActive ? '72px' : '60px',
                borderRadius: '50%', background: zone.color, opacity: isActive ? 1 : 0.85,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: isActive ? `0 0 0 6px ${zone.color}44, 0 0 24px ${zone.color}88` : `0 4px 16px ${zone.color}55`,
                transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                border: isActive ? '3px solid white' : '3px solid transparent',
              }}>
                <span style={{ color: 'white', fontSize: isActive ? '22px' : '18px', fontWeight: 'bold',
                  fontFamily: 'system-ui,sans-serif', textShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
                  {zone.label}
                </span>
              </div>
              <div style={{
                marginTop: '8px', textAlign: 'center', maxWidth: '90px', fontSize: '11px',
                fontWeight: 'bold', color: zone.color, fontFamily: 'system-ui,sans-serif',
                textTransform: 'uppercase', letterSpacing: '0.5px',
                textShadow: '0 1px 4px rgba(255,255,255,0.9)', opacity: isActive ? 1 : 0.8,
                transition: 'opacity 0.2s',
              }}>
                {zone.title}
              </div>
            </div>
          )
        })}
      </div>

      {/* Floating UI Elements (Unscaled / Stationary) */}
      
      {/* Map title */}
      <div style={{ position: 'absolute', top: '24px', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', zIndex: 10, pointerEvents: 'none' }}>
        <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#2c2c2c', fontFamily: 'system-ui,sans-serif', letterSpacing: '2px', textTransform: 'uppercase' }}>
          Cementerio General
        </div>
        <div style={{ fontSize: '11px', color: '#888', fontFamily: 'system-ui,sans-serif', marginTop: '4px', letterSpacing: '1px' }}>
          Guatemala City · {zones.length} {zones.length === 1 ? 'punto' : 'puntos'}
        </div>
      </div>

      {/* Floating Zoom Controls */}
      <div style={{ position: 'absolute', bottom: '24px', right: '24px', display: 'flex', gap: '8px', zIndex: 20 }}>
        <button onClick={() => setScale(s => Math.min(8, s * 1.25))} style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'white', border: '1px solid rgba(0,0,0,0.15)', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>+</button>
        <button onClick={() => setScale(s => Math.max(0.5, s / 1.25))} style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'white', border: '1px solid rgba(0,0,0,0.15)', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>-</button>
        <button onClick={resetView} style={{ padding: '0 12px', height: '36px', borderRadius: '10px', background: 'white', border: '1px solid rgba(0,0,0,0.15)', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>Reset</button>
      </div>

      {/* Hint */}
      {zones.length > 0 && (
        <div style={{ position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          fontSize: '12px', color: '#888', fontFamily: 'system-ui,sans-serif', zIndex: 10, pointerEvents: 'none', background: 'rgba(255,255,255,0.7)', padding: '4px 12px', borderRadius: '12px' }}>
          Arrastra para mover · Rueda para hacer zoom · Toca un punto para ver la foto 360
        </div>
      )}
    </div>
  )
}

// ─── CAD Map View Component ───────────────────────────────────────────
function CadMap({ zones, onZoneClick, activeZone }) {
  const [scale, setScale] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const containerRef = useRef(null)

  const [bgImageSrc, setBgImageSrc] = useState('/map_images/cemetery_cad_map.png')
  const [bgLoadError, setBgLoadError] = useState(false)

  const handleMouseDown = (e) => {
    if (e.button !== 0) return
    setIsPanning(true)
    setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y })
  }

  const handleMouseMove = (e) => {
    if (!isPanning) return
    setPanOffset({
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y
    })
  }

  const handleMouseUp = () => {
    setIsPanning(false)
  }

  const handleWheel = (e) => {
    e.preventDefault()
    const zoomFactor = 1.1
    const nextScale = e.deltaY < 0 ? scale * zoomFactor : scale / zoomFactor
    const boundedScale = Math.max(0.5, Math.min(8, nextScale))
    
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      
      const newOffsetX = mouseX - (mouseX - panOffset.x) * (boundedScale / scale)
      const newOffsetY = mouseY - (mouseY - panOffset.y) * (boundedScale / scale)
      
      setScale(boundedScale)
      setPanOffset({ x: newOffsetX, y: newOffsetY })
    }
  }

  const resetView = () => {
    setScale(1)
    setPanOffset({ x: 0, y: 0 })
  }

  const handleBgError = () => {
    if (bgImageSrc === '/map_images/cemetery_cad_map.png') {
      setBgImageSrc('/map_images/cemetery_cad_map.svg')
    } else {
      setBgLoadError(true)
    }
  }

  return (
    <div 
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      style={{
        width: '100%', height: '100%', position: 'relative',
        background: '#0B1D33', overflow: 'hidden', cursor: isPanning ? 'grabbing' : 'grab',
        userSelect: 'none'
      }}
    >
      {/* Zoom / Pan Inner Canvas */}
      <div style={{
        width: '100%', height: '100%',
        transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${scale})`,
        transformOrigin: '0 0',
        position: 'absolute', inset: 0,
        transition: isPanning ? 'none' : 'transform 0.1s ease-out'
      }}>
        {/* Blueprint Grid background */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <pattern id="cadGrid" width="5" height="5" patternUnits="userSpaceOnUse">
              <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#1A2F4C" strokeWidth="0.1" />
            </pattern>
            <pattern id="cadGridMajor" width="25" height="25" patternUnits="userSpaceOnUse">
              <rect width="25" height="25" fill="url(#cadGrid)" />
              <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#253E61" strokeWidth="0.25" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#cadGridMajor)" />
        </svg>

        {/* CAD image layer */}
        {!bgLoadError && (
          <img 
            src={bgImageSrc}
            onError={handleBgError}
            alt="Plano CAD Cementerio"
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'contain', pointerEvents: 'none', opacity: 0.85
            }}
          />
        )}

        {/* Connection lines */}
        {zones.length >= 2 && (
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            viewBox="0 0 100 100" preserveAspectRatio="none">
            {zones.flatMap(zone =>
              (zone.connections || []).map(targetId => {
                const target = zones.find(z => z.id === targetId)
                if (!target) return null
                const zPos = zone.cadPosition || zone.position
                const tPos = target.cadPosition || target.position
                return (
                  <line key={`${zone.id}-${targetId}`}
                    x1={zPos.x} y1={zPos.y}
                    x2={tPos.x} y2={tPos.y}
                    stroke={`${zone.color}cc`} strokeWidth="0.8" strokeDasharray="1,1" />
                )
              })
            )}
          </svg>
        )}

        {/* CAD Point markers */}
        {zones.map(zone => {
          const isActive = activeZone?.id === zone.id
          const pos = zone.cadPosition || zone.position
          return (
            <div 
              key={zone.id}
              onClick={(e) => {
                e.stopPropagation()
                onZoneClick(zone)
              }}
              style={{
                position: 'absolute', left: `${pos.x}%`, top: `${pos.y}%`,
                transform: 'translate(-50%, -50%)', cursor: 'pointer', zIndex: 10
              }}
            >
              {/* CAD Crosshair design for markers */}
              <div style={{
                width: isActive ? '32px' : '24px', height: isActive ? '32px' : '24px',
                borderRadius: '50%', border: `2px solid ${zone.color}`,
                background: isActive ? `${zone.color}33` : 'rgba(11,29,51,0.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: isActive ? `0 0 16px ${zone.color}` : 'none',
                transition: 'all 0.2s ease-in-out'
              }}>
                {/* Crosshair lines */}
                <div style={{ position: 'absolute', width: '120%', height: '1px', background: `${zone.color}aa` }} />
                <div style={{ position: 'absolute', height: '120%', width: '1px', background: `${zone.color}aa` }} />
                
                {/* Center dot */}
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: zone.color }} />
              </div>
              {/* Label */}
              <div style={{
                position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                marginTop: '4px', fontSize: '9px', fontWeight: 'bold', color: '#8AB4F8',
                background: 'rgba(11,29,51,0.85)', padding: '1px 4px', borderRadius: '3px',
                border: '0.5px solid #253E61', whiteSpace: 'nowrap',
                textShadow: 'none', pointerEvents: 'none'
              }}>
                {zone.id}
              </div>
            </div>
          )
        })}
      </div>

      {/* Floating Zoom controls overlay */}
      <div style={{
        position: 'absolute', bottom: '20px', right: '20px', zIndex: 100,
        display: 'flex', flexDirection: 'column', gap: '8px'
      }}>
        <button 
          onClick={resetView}
          style={{
            background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.1)',
            borderRadius: '8px', padding: '8px 12px', fontSize: '12px', fontWeight: 'bold',
            color: '#2c2c2c', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
            fontFamily: 'system-ui,sans-serif'
          }}
        >
          🔍 Ajustar Vista
        </button>
      </div>

      {/* Upload Instruction Banner */}
      {bgLoadError && (
        <div style={{
          position: 'absolute', top: '120px', left: '50%', transform: 'translateX(-50%)',
          width: '80%', maxWidth: '520px', background: 'rgba(235, 87, 87, 0.95)',
          color: 'white', padding: '16px 24px', borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)',
          fontFamily: 'system-ui, sans-serif', zIndex: 99
        }}>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 'bold' }}>
            ⚠️ Plano CAD no encontrado
          </h4>
          <p style={{ margin: '0 0 12px 0', fontSize: '12px', lineHeight: '1.4', opacity: 0.9 }}>
            Para ver el plano, por favor exporta tu archivo CAD <strong>ARCHIVO PARA FOTO (1).dwg</strong> como una imagen <strong>cemetery_cad_map.svg</strong> o <strong>cemetery_cad_map.png</strong> y colócala en:
          </p>
          <code style={{
            background: 'rgba(0,0,0,0.3)', padding: '6px 12px', borderRadius: '6px',
            fontSize: '11px', display: 'block', wordBreak: 'break-all', fontFamily: 'monospace'
          }}>
            public/map_images/cemetery_cad_map.svg
          </code>
          <p style={{ margin: '12px 0 0 0', fontSize: '11px', fontStyle: 'italic', opacity: 0.8 }}>
            * Mientras tanto, puedes usar esta cuadrícula virtual como referencia para pre-organizar y guardar los puntos.
          </p>
        </div>
      )}

      {/* Blueprint Title Block */}
      <div style={{
        position: 'absolute', bottom: '20px', left: '20px', zIndex: 100,
        background: 'rgba(11,29,51,0.85)', padding: '12px 18px', borderRadius: '8px',
        border: '1px solid #253E61', backdropFilter: 'blur(8px)',
        color: '#8AB4F8', fontFamily: 'monospace', fontSize: '11px', pointerEvents: 'none'
      }}>
        <div style={{ color: '#fff', fontWeight: 'bold', marginBottom: '4px' }}>DIBUJO DE CAD REFERENCIAL</div>
        <div>PROYECTO: CEMENTERIO GRAL</div>
        <div>PLANO: VISTA_ALINEACION_CAD</div>
        <div>ESCALA: 1:1 · UNIT: %</div>
      </div>
    </div>
  )
}

// ─── 3D View Components ────────────────────────────────────────────────
function CemeteryModel() {
  const { scene } = useGLTF('/test-v3.glb')
  return <primitive object={scene} />
}

function Connections3D({ zones }) {
  const lines = []
  zones.forEach(zone => {
    (zone.connections || []).forEach(targetId => {
      const target = zones.find(z => z.id === targetId)
      if (!target) return
      
      const x1 = (zone.position.x - 48) * 0.25
      const z1 = (zone.position.y - 50) * 0.25
      const x2 = (target.position.x - 48) * 0.25
      const z2 = (target.position.y - 50) * 0.25
      
      lines.push({
        key: `${zone.id}-${targetId}`,
        points: [new THREE.Vector3(x1, 0.2, z1), new THREE.Vector3(x2, 0.2, z2)],
        color: zone.color
      })
    })
  })
  
  return (
    <>
      {lines.map(l => {
        const geometry = new THREE.BufferGeometry().setFromPoints(l.points)
        return (
          <line key={l.key} geometry={geometry}>
            <lineBasicMaterial color={l.color} linewidth={2} opacity={0.6} transparent />
          </line>
        )
      })}
    </>
  )
}

function Marker3D({ zone, isActive, onClick }) {
  const meshRef = useRef()
  const [hovered, setHovered] = useState(false)
  
  // Map 2D percentage coordinates to 3D coords
  const x3d = (zone.position.x - 48) * 0.25
  const z3d = (zone.position.y - 50) * 0.25
  const y3d = 0.2 // Slightly above floor level

  return (
    <group position={[x3d, y3d, z3d]}>
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation()
          onClick(zone)
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <cylinderGeometry args={[0.2, 0.2, 0.05, 16]} />
        <meshStandardMaterial
          color={zone.color}
          emissive={zone.color}
          emissiveIntensity={hovered || isActive ? 0.8 : 0.2}
        />
      </mesh>
      
      <mesh position={[0, 0.3, 0]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial
          color={zone.color}
          emissive={zone.color}
          emissiveIntensity={hovered || isActive ? 1.0 : 0.3}
        />
      </mesh>
      
      <Html distanceFactor={8} position={[0, 0.6, 0]} center>
        <div style={{
          background: 'rgba(0,0,0,0.85)',
          color: 'white',
          padding: '3px 8px',
          borderRadius: '6px',
          fontSize: '10px',
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 'bold',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          border: `1.5px solid ${zone.color}`,
          boxShadow: `0 2px 8px ${zone.color}66`
        }}>
          {zone.label}
        </div>
      </Html>
    </group>
  )
}

// ─── Main Component ───────────────────────────────────────────────────
export default function TerrainMap() {
  const [viewMode, setViewMode] = useState('map') // 'map' | 'map3d' | '360'
  const [selectedZone, setSelectedZone] = useState(null)
  const [activeAreaId, setActiveAreaId] = useState('demo')

  // Global state for cemetery points to persist coordinate/hotspot edits across areas
  const [cemeteryPoints, setCemeteryPoints] = useState(() => CEMETERY_POINTS)
  const zones = useMemo(() => prepareAllZones(cemeteryPoints), [cemeteryPoints])
  const [editingPointId, setEditingPointId] = useState('A')

  // ── Image cache state ──
  const [cacheInfo, setCacheInfo] = useState(() => getCacheStatus(zones))
  const [isRefreshing, setIsRefreshing] = useState(false)

  // ── Hotspot relocation mode ──
  const [movingHotspot, setMovingHotspot] = useState(null) // { sourceId, targetId }

  // Preload panoramas for the active area when activeAreaId changes
  useEffect(() => {
    const activeAreaZones = zones.filter(z => z.areaId === activeAreaId)
    preloadAllImages(activeAreaZones).then(() => setCacheInfo(getCacheStatus(zones)))
    const iv = setInterval(() => {
      const s = getCacheStatus(zones)
      setCacheInfo(s)
      if (s.loading === 0) clearInterval(iv)
    }, 500)
    return () => clearInterval(iv)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAreaId, zones])

  const handleAreaChange = (areaId) => {
    setActiveAreaId(areaId)
    setSelectedZone(null)
    const nextPoints = cemeteryPoints[areaId]
    if (nextPoints && nextPoints.length > 0) {
      setEditingPointId(nextPoints[0].id)
    }
    setMovingHotspot(null)
    const nextZones = prepareZones(nextPoints, areaId)
    setCacheInfo(getCacheStatus(nextZones))
  }

  const handleRefreshCache = useCallback(() => {
    setIsRefreshing(true)
    refreshImageCache(zones).then(() => {
      setCacheInfo(getCacheStatus(zones))
      setIsRefreshing(false)
    })
  }, [zones])

  const handleZoneClick = useCallback((zone) => {
    setSelectedZone(zone)
    setViewMode('360')
  }, [])

  const handleNavigate = useCallback((targetId) => {
    const target = zones.find(z => z.id === targetId)
    if (target) setSelectedZone(target)
  }, [zones])

  const exit360 = useCallback(() => {
    setViewMode('map')
    setSelectedZone(null)
    setMovingHotspot(null)
  }, [])

  // Auto-save points configuration to disk
  const savePointsToDisk = (areaId, points) => {
    fetch('/api/save-coordinates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ areaId, points })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        console.log(`[Auto-Save] Successfully saved updated configuration for area: ${areaId}`)
      } else {
        console.error(`[Auto-Save] Error saving configuration:`, data.error)
      }
    })
    .catch(err => {
      console.error(`[Auto-Save] Fetch error while saving:`, err)
    })
  }

  const handleHotspotRightClick = useCallback((sourceId, targetId) => {
    setMovingHotspot({ sourceId, targetId })
  }, [])

  const handleMoveHotspot = useCallback((sourceId, targetId, pitch, yaw) => {
    // Find which area sourceId belongs to
    const targetPoint = zones.find(z => z.id === sourceId)
    if (!targetPoint) return
    const pointAreaId = targetPoint.areaId

    setCemeteryPoints(prev => {
      const updatedPoints = prev[pointAreaId].map(p => {
        if (p.id === sourceId) {
          const overrides = p.hotspotOverrides || {}
          return {
            ...p,
            hotspotOverrides: {
              ...overrides,
              [targetId]: { yaw: Math.round(yaw), pitch: Math.round(pitch) }
            }
          }
        }
        return p
      })
      savePointsToDisk(pointAreaId, updatedPoints)
      return {
        ...prev,
        [pointAreaId]: updatedPoints
      }
    })
    setMovingHotspot(null)
  }, [zones])

  const activeEditPoint = zones.find(z => z.id === editingPointId)

  const updateCoord = (axis, amount) => {
    const targetPoint = zones.find(z => z.id === editingPointId)
    if (!targetPoint) return
    const pointAreaId = targetPoint.areaId
    const isCadMode = viewMode === 'cad'

    setCemeteryPoints(prev => {
      const updatedPoints = prev[pointAreaId].map(p => {
        if (p.id === editingPointId) {
          if (isCadMode) {
            const newCadPos = p.cadPosition ? { ...p.cadPosition } : { ...p.position }
            newCadPos[axis] = +(newCadPos[axis] + amount).toFixed(1)
            newCadPos[axis] = Math.max(0, Math.min(100, newCadPos[axis]))
            return { ...p, cadPosition: newCadPos }
          } else {
            const newPos = { ...p.position }
            newPos[axis] = +(newPos[axis] + amount).toFixed(1)
            newPos[axis] = Math.max(0, Math.min(100, newPos[axis]))
            return { ...p, position: newPos }
          }
        }
        return p
      })
      savePointsToDisk(pointAreaId, updatedPoints)
      return {
        ...prev,
        [pointAreaId]: updatedPoints
      }
    })
  }

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative', background: '#f0efe9', fontFamily: 'system-ui,sans-serif' }}>

      {/* ── Mode Toggle ── */}
      <div style={{
        position: 'absolute', top: '20px', left: '20px', zIndex: 100,
        display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.9)',
        padding: '5px', borderRadius: '12px', backdropFilter: 'blur(10px)',
        border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
      }}>
        {[
          { id: 'map', label: '🗺️  Planta' },
          { id: 'cad', label: '📐  Plano CAD' },
          { id: 'map3d', label: '🌐  Modelo 3D' },
          { id: '360', label: '📸  360°' },
        ].map(mode => (
          <button key={mode.id}
            onClick={() => {
              if (mode.id === '360' && !selectedZone && zones.length > 0) setSelectedZone(zones[0])
              setViewMode(mode.id)
            }}
            style={{
              background: viewMode === mode.id ? '#2c2c2c' : 'transparent',
              border: 'none', borderRadius: '8px', padding: '8px 18px',
              color: viewMode === mode.id ? 'white' : '#666', cursor: 'pointer',
              fontSize: '13px', fontWeight: viewMode === mode.id ? 'bold' : 'normal',
              transition: 'all 0.2s', fontFamily: 'system-ui,sans-serif',
            }}>
            {mode.label}
          </button>
        ))}
      </div>

      {/* ── Area Selector Sidebar (only visible when not in 360 view) ── */}
      {viewMode !== '360' && (
        <div style={{
          position: 'absolute', top: '80px', left: '20px', zIndex: 100,
          width: '180px', background: 'rgba(255,255,255,0.95)',
          border: '1px solid rgba(0,0,0,0.08)', borderRadius: '14px',
          padding: '12px', backdropFilter: 'blur(10px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
        }}>
          <div style={{ fontSize: '10px', color: '#888', fontWeight: 'bold', letterSpacing: '1px', marginBottom: '8px', textTransform: 'uppercase' }}>
            Seleccionar Sección
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {Object.values(AREAS).map(area => {
              const isSelected = activeAreaId === area.id
              return (
                <button
                  key={area.id}
                  onClick={() => handleAreaChange(area.id)}
                  style={{
                    textAlign: 'left', padding: '8px 10px',
                    background: isSelected ? '#2c2c2c' : 'rgba(0,0,0,0.03)',
                    color: isSelected ? 'white' : '#2c2c2c',
                    border: 'none', borderRadius: '8px',
                    cursor: 'pointer', transition: 'all 0.2s',
                    display: 'flex', flexDirection: 'column', gap: '2px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span style={{ fontSize: '12px', fontWeight: 'bold' }}>
                      {area.id === 'demo' ? '🗺️ Área 0' : `🗺️ Área ${area.id.replace('area', '')}`}
                    </span>
                    <span style={{ fontSize: '9px', opacity: 0.7 }}>
                      {area.points.length} pts
                    </span>
                  </div>
                  <div style={{ fontSize: '9px', opacity: isSelected ? 0.8 : 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
                    {area.name.includes(' - ') ? area.name.split(' - ')[1] : area.name.replace(/Área \d+ /, '')}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Cache Status Pill ── */}
      <div style={{
        position: 'absolute', bottom: '60px', left: '20px', zIndex: 100,
        display: 'flex', alignItems: 'center', gap: '8px',
        background: 'rgba(255,255,255,0.92)', padding: '6px 12px',
        borderRadius: '10px', backdropFilter: 'blur(10px)',
        border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
        fontFamily: 'system-ui,sans-serif', fontSize: '11px', color: '#666',
      }}>
        <div style={{
          width: '8px', height: '8px', borderRadius: '50%',
          background: cacheInfo.loading > 0 ? '#f39c12' : cacheInfo.errors > 0 ? '#e74c3c' : '#27ae60',
          boxShadow: `0 0 6px ${cacheInfo.loading > 0 ? '#f39c1288' : cacheInfo.errors > 0 ? '#e74c3c88' : '#27ae6088'}`,
          animation: cacheInfo.loading > 0 ? 'cacheLoadPulse 1.5s infinite' : 'none',
        }} />
        <span>
          {cacheInfo.loading > 0
            ? `Cargando ${cacheInfo.loaded}/${cacheInfo.total}…`
            : cacheInfo.errors > 0
              ? `${cacheInfo.loaded}/${cacheInfo.total} (${cacheInfo.errors} error)`
              : `${cacheInfo.loaded}/${cacheInfo.total} en caché ✓`}
        </span>
        <button onClick={handleRefreshCache} disabled={isRefreshing}
          title="Actualizar caché de imágenes"
          style={{
            background: 'none', border: 'none',
            cursor: isRefreshing ? 'wait' : 'pointer',
            padding: '2px 4px', fontSize: '13px',
            opacity: isRefreshing ? 0.4 : 0.7,
            transition: 'opacity 0.2s', borderRadius: '4px', lineHeight: 1,
          }}>
          🔄
        </button>
      </div>
      <style dangerouslySetInnerHTML={{__html: `@keyframes cacheLoadPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}} />

      {/* ── 2D MAP ── */}
      {viewMode === 'map' && (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
          <TopDownMap zones={zones} onZoneClick={handleZoneClick} activeZone={activeEditPoint} />
        </div>
      )}

      {/* ── CAD MAP ── */}
      {viewMode === 'cad' && (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
          <CadMap zones={zones} onZoneClick={handleZoneClick} activeZone={activeEditPoint} />
        </div>
      )}

      {/* ── 3D MODEL VIEW ── */}
      {viewMode === 'map3d' && (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
          <Canvas
            shadows
            camera={{ position: [0, 8, 12], fov: 50 }}
            style={{ width: '100%', height: '100%' }}
          >
            <ambientLight intensity={0.8} />
            <directionalLight position={[10, 15, 5]} intensity={1.2} castShadow />
            <pointLight position={[-8, 5, -8]} intensity={0.4} color="#fffae6" />
            <pointLight position={[8, 5, 8]} intensity={0.3} color="#e6f0ff" />
            
            <Suspense fallback={
              <Html center>
                <div style={{
                  background: 'rgba(255,255,255,0.9)',
                  border: '1px solid rgba(0,0,0,0.1)',
                  borderRadius: '10px',
                  padding: '12px 24px',
                  fontSize: '14px',
                  fontFamily: 'sans-serif',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                  color: '#333',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <span style={{ fontSize: '16px' }}>🔄</span> Cargando Modelo 3D...
                </div>
              </Html>
            }>
              <CemeteryModel />
              <Connections3D zones={zones} />
              {zones.map(zone => (
                <Marker3D
                  key={zone.id}
                  zone={zone}
                  isActive={editingPointId === zone.id}
                  onClick={(z) => {
                    setEditingPointId(z.id)
                    handleZoneClick(z)
                  }}
                />
              ))}
            </Suspense>
            
            <OrbitControls
              enablePan
              enableZoom
              enableRotate
              minDistance={3}
              maxDistance={25}
              maxPolarAngle={Math.PI / 2.1}
            />
          </Canvas>
        </div>
      )}

      {/* ── Coordinate Tuner (Visible on 2D Planta, CAD Map, and 3D model views) ── */}
      {(viewMode === 'map' || viewMode === 'cad' || viewMode === 'map3d') && activeEditPoint && (
        <div style={{
          position: 'absolute', top: '20px', right: '20px', width: '260px',
          background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(0,0,0,0.08)',
          borderRadius: '14px', padding: '16px', color: '#2c2c2c', zIndex: 100,
          backdropFilter: 'blur(10px)', boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
        }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', borderBottom: '1px solid rgba(0,0,0,0.08)', paddingBottom: '8px', fontWeight: 'bold' }}>
            🔧 Alineación de Puntos (X, Y)
          </h3>
          
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '4px' }}>Punto Activo:</label>
            {zones.length <= 5 ? (
              <div style={{ display: 'flex', gap: '6px' }}>
                {zones.map(z => (
                  <button key={z.id} onClick={() => setEditingPointId(z.id)}
                    style={{
                      flex: 1, padding: '6px',
                      background: editingPointId === z.id ? z.color : '#eee',
                      border: 'none', borderRadius: '6px',
                      color: editingPointId === z.id ? 'white' : '#666',
                      fontWeight: 'bold', cursor: 'pointer', fontSize: '12px', transition: 'all 0.15s',
                    }}>
                    {z.id}
                  </button>
                ))}
              </div>
            ) : (
              <select
                value={editingPointId}
                onChange={(e) => setEditingPointId(e.target.value)}
                style={{
                  width: '100%', padding: '8px',
                  background: 'white', border: '1px solid rgba(0,0,0,0.15)',
                  borderRadius: '8px', fontSize: '13px', fontWeight: 'bold',
                  color: zones.find(z => z.id === editingPointId)?.color || '#2c2c2c'
                }}
              >
                {Object.values(AREAS).map(area => {
                  const areaZones = zones.filter(z => z.areaId === area.id)
                  if (areaZones.length === 0) return null
                  return (
                    <optgroup key={area.id} label={area.name} style={{ color: area.color, fontWeight: 'bold' }}>
                      {areaZones.map(z => (
                        <option key={z.id} value={z.id} style={{ color: z.color, fontWeight: 'normal' }}>
                          Punto {z.id} ({z.title.split(' - ')[1] || z.title})
                        </option>
                      ))}
                    </optgroup>
                  )
                })}
              </select>
            )}
          </div>

          <div>
            {[['x', 'Horizontal (Eje X)'], ['y', 'Vertical (Eje Y)']].map(([axis, label]) => {
              const currentVal = viewMode === 'cad'
                ? (activeEditPoint.cadPosition || activeEditPoint.position)[axis]
                : activeEditPoint.position[axis];
              return (
                <div key={axis} style={{ marginBottom: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666', marginBottom: '3px' }}>
                    <span>{label}</span>
                    <span style={{ fontFamily: 'monospace', color: activeEditPoint.color, fontWeight: 'bold' }}>
                      {currentVal.toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => updateCoord(axis, -1.0)}
                      style={{ flex: 1, padding: '5px', background: '#e0e0e0', border: 'none', borderRadius: '4px', color: '#333', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                      -1.0%
                    </button>
                    <button onClick={() => updateCoord(axis, 1.0)}
                      style={{ flex: 1, padding: '5px', background: '#e0e0e0', border: 'none', borderRadius: '4px', color: '#333', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                      +1.0%
                    </button>
                  </div>
                </div>
              )
            })}
            <div style={{ marginTop: '14px', background: '#f5f5f5', padding: '10px', borderRadius: '6px', fontSize: '11px', border: '1px solid rgba(0,0,0,0.05)' }}>
              <div style={{ color: '#888', marginBottom: '4px' }}>Snippet de Posición:</div>
              <code style={{ fontFamily: 'monospace', color: '#2c2c2c', display: 'block', wordBreak: 'break-all', fontWeight: 'bold' }}>
                {viewMode === 'cad'
                  ? `cadPosition: { x: ${(activeEditPoint.cadPosition || activeEditPoint.position).x.toFixed(1)}, y: ${(activeEditPoint.cadPosition || activeEditPoint.position).y.toFixed(1)} }`
                  : `position: { x: ${activeEditPoint.position.x.toFixed(1)}, y: ${activeEditPoint.position.y.toFixed(1)} }`
                }
              </code>
            </div>
          </div>
        </div>
      )}

      {/* ── 360 VIEW ── */}
      {viewMode === '360' && selectedZone && (
        <PanoramaViewer
          zone={selectedZone}
          onNavigate={handleNavigate}
          onExit={exit360}
          zonesList={zones}
          movingHotspot={movingHotspot}
          onHotspotRightClick={handleHotspotRightClick}
          onMoveHotspot={handleMoveHotspot}
        />
      )}

      {/* ── Hotspot Relocation Banner overlay ── */}
      {viewMode === '360' && movingHotspot && (
        <div style={{
          position: 'absolute', top: '80px', left: '50%', transform: 'translateX(-50%)',
          background: '#d35400', color: 'white',
          padding: '12px 24px', borderRadius: '12px', zIndex: 1000,
          fontFamily: 'system-ui, sans-serif', fontSize: '13px', fontWeight: 'bold',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center',
          gap: '16px', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.2)'
        }}>
          <span>
            🔧 Modo Ubicación: Haz clic en el panorama 360 para reubicar la flecha que conecta a <strong>{movingHotspot.targetId}</strong>
          </span>
          <button
            onClick={() => setMovingHotspot(null)}
            style={{
              background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '6px',
              color: 'white', padding: '6px 12px', cursor: 'pointer', fontWeight: 'bold',
              fontSize: '11px', transition: 'background 0.2s'
            }}
            onMouseOver={(e) => e.target.style.background = 'rgba(255,255,255,0.3)'}
            onMouseOut={(e) => e.target.style.background = 'rgba(255,255,255,0.2)'}
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}

