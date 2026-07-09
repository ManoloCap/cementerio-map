// ─── Panorama360 ──────────────────────────────────────────────────────
// 360° photo viewer, lifted as-is from the old TerrainMap.jsx (Pannellum
// wrapper + hotspot navigation engine) so the "360°" tab reuses the same
// tested viewer instead of rebuilding it against the new 2D map's data.
// `window.pannellum` comes from the CDN script tags in index.html.

import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import CEMETERY_POINTS from './cemetery_points.json'
import MANIFEST_360 from '../assets/manifest-360.json'

const AREAS = {
  demo: { id: 'demo', color: '#e74c3c' },
  cipreses: { id: 'cipreses', color: '#16a085' },
  bugambilias: { id: 'bugambilias', color: '#9b59b6' },
  encinos: { id: 'encinos', color: '#3498db' },
  unknown_section_1: { id: 'unknown_section_1', color: '#7f8c8d' },
  unknown_section_2: { id: 'unknown_section_2', color: '#7f8c8d' },
  comoding_1: { id: 'comoding_1', color: '#f39c12' },
  paseo_cipreses: { id: 'paseo_cipreses', color: '#d35400' },
  comoding_2: { id: 'comoding_2', color: '#27ae60' },
  area7: { id: 'area7', color: '#7f8c8d' },
}

// ─── Firebase Storage URL resolution ───────────────────────────────────
// cemetery_points.json still carries the original local paths (e.g.
// '/previews/dji_mimo_..._small.jpg'); we resolve those to their public
// Firebase Storage URL by matching areaId + point id against the manifest,
// which is more reliable than trying to match on the local filename.
function resolvePanoramaUrl(localPath, areaId, pointId) {
  const entry = MANIFEST_360.panoramas.find(p => p.section === areaId && p.name === `${pointId}.jpg`)
  return entry ? entry.url : localPath
}

// ─── Connection & Hotspot Engine ──────────────────────────────────────
function getNeighbors(points, idx) {
  const neighbors = []
  if (idx > 0) neighbors.push(points[idx - 1])
  if (idx < points.length - 1) neighbors.push(points[idx + 1])
  return neighbors
}

function prepareZones(points, areaId) {
  const areaColor = AREAS[areaId]?.color || '#7f8c8d'
  return points.map((p, idx) => {
    const neighbors = getNeighbors(points, idx)
    const hotspots = neighbors.map(n => {
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
        yaw = Math.round((360 - theta) % 360)
        pitch = -15
      }
      return { yaw, pitch, targetId: n.id, label: `Avanzar a ${n.title}` }
    })
    return {
      ...p,
      label: p.id,
      color: areaColor,
      connections: neighbors.map(n => n.id),
      hotspots,
      panorama: resolvePanoramaUrl(p.panorama, areaId, p.id),
    }
  })
}

function prepareAllZones(cemeteryPoints) {
  let allZones = []
  Object.keys(cemeteryPoints).forEach(areaId => {
    const points = cemeteryPoints[areaId]
    const zonesWithArea = prepareZones(points, areaId).map(z => ({ ...z, areaId }))
    allZones = allZones.concat(zonesWithArea)
  })
  return allZones
}

// ─── Image Preloader ──────────────────────────────────────────────────
const imageCache = { status: {}, promises: {} }

function preloadImage(url) {
  if (imageCache.promises[url]) return imageCache.promises[url]
  imageCache.status[url] = 'loading'
  imageCache.promises[url] = new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      imageCache.status[url] = 'loaded'
      resolve(true)
    }
    img.onerror = () => {
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

// ─── ngrok interstitial detection ─────────────────────────────────────
// ngrok's free-tier anti-bot interstitial returns HTTP 200 with a small
// text/plain body (containing 'ERR_NGROK_6024') instead of the requested
// resource on a visitor's first hit. It happens intermittently on
// sub-resource requests (like Pannellum's panorama <img> loads) even after
// the main page has already passed the interstitial, so we verify the
// first panorama is actually reachable before handing control to Pannellum.
const TUNNEL_HOST_RE = /\.(ngrok-free\.dev|ngrok\.io|ngrok\.app|trycloudflare\.com)$/i

function isTunnelHost() {
  return typeof window !== 'undefined' && TUNNEL_HOST_RE.test(window.location.hostname)
}

async function checkPanoramaReachable(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return false
    const contentType = res.headers.get('content-type') || ''
    if (contentType.startsWith('image/')) return true
    const text = await res.text()
    return !text.includes('ERR_NGROK_6024')
  } catch {
    return false
  }
}

// Readiness gate run right before Pannellum takes over. We use an <img>
// element instead of fetch() so CORS is NOT enforced (fetch() would block
// cross-origin reads from storage.googleapis.com, but <img> loads for
// display without that check). ngrok's ERR_NGROK_6024 returns a small
// text/plain body, which the browser tries to decode as an image and
// fires onerror -- so onerror catches both "ngrok blocked" and "real 403".
function checkImageLoadable(url) {
  return new Promise(resolve => {
    const img = new Image()
    let settled = false
    const finish = (ok) => { if (!settled) { settled = true; resolve(ok) } }
    img.onload = () => finish(true)
    img.onerror = () => finish(false)
    img.src = url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now()
  })
}

// ─── 360 Viewer Helper ────────────────────────────────────────────────
function createHotspotConfig(hs, sourceId, onNavigate, zonesList, navigatingRef, pendingOrientationRef, setIsTransitioning, viewerRef) {
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
          hfov: viewerRef.current.getHfov(),
        }
      }
      setTimeout(() => onNavigate(args.targetId), 400)
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
function PanoramaViewer({ zone, onNavigate, onExit, zonesList }) {
  const containerRef = useRef()
  const viewerRef = useRef(null)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [sceneIssue, setSceneIssue] = useState(false)
  const navigatingRef = useRef(false)
  const pendingOrientationRef = useRef(null)

  const onNavigateRef = useRef(onNavigate)
  const zonesListRef = useRef(zonesList)
  useEffect(() => { onNavigateRef.current = onNavigate }, [onNavigate])
  useEffect(() => { zonesListRef.current = zonesList }, [zonesList])

  const zoneId = zone.id

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
            createHotspotConfig(hs, z.id, onNavigateRef.current, zonesListRef.current, navigatingRef, pendingOrientationRef, setIsTransitioning, viewerRef)
          ),
        }
      })

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
        scenes,
      })

      viewer.on('load', () => {
        setIsTransitioning(false)
        navigatingRef.current = false
        setSceneIssue(false)
      })
      viewer.on('error', errMsg => {
        console.error('[Pannellum] Viewer error:', errMsg)
        setIsTransitioning(false)
        navigatingRef.current = false
        setSceneIssue(true)
      })

      viewerRef.current = viewer
    } else if (viewerRef.current.getScene() !== zoneId) {
      if (pendingOrientationRef.current) {
        const { pitch, yaw, hfov } = pendingOrientationRef.current
        viewerRef.current.loadScene(zoneId, pitch, yaw, hfov)
        pendingOrientationRef.current = null
      } else {
        viewerRef.current.loadScene(zoneId)
      }
    }
  }, [zoneId])

  const handleRetryScene = useCallback(() => {
    setSceneIssue(false)
    if (viewerRef.current) {
      try {
        viewerRef.current.loadScene(zoneId)
      } catch {
        // ignore
      }
    }
  }, [zoneId])

  useEffect(() => {
    return () => {
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy()
        } catch {
          // ignore
        }
        viewerRef.current = null
      }
    }
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#000', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(240,239,233,0.45)',
          backdropFilter: isTransitioning ? 'blur(15px)' : 'blur(0px)',
          opacity: isTransitioning ? 1 : 0,
          pointerEvents: isTransitioning ? 'all' : 'none',
          transition: 'opacity 0.4s ease, backdrop-filter 0.4s ease',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isTransitioning && (
          <div style={{ color: 'rgba(0,0,0,0.3)', fontSize: '13px', fontFamily: 'system-ui,sans-serif', letterSpacing: '2px', textTransform: 'uppercase' }}>
            Cargando…
          </div>
        )}
      </div>

      {sceneIssue && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(10,10,10,0.9)',
            zIndex: 300,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            textAlign: 'center',
            padding: '24px',
            color: 'white',
            fontFamily: 'system-ui,sans-serif',
          }}
        >
          <div style={{ fontSize: '15px', maxWidth: '320px', lineHeight: 1.5 }}>
            No se pudo cargar esta vista 360°.
            <br />
            Esto puede pasar la primera vez que se abre el enlace de ngrok.
          </div>
          <button
            onClick={handleRetryScene}
            style={{
              background: '#3498db',
              border: 'none',
              borderRadius: '10px',
              padding: '12px 26px',
              color: 'white',
              fontWeight: 'bold',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          background: `${zone.color}dd`,
          padding: '10px 28px',
          borderRadius: '0 0 16px 16px',
          color: 'white',
          fontFamily: 'system-ui,sans-serif',
          fontWeight: 'bold',
          fontSize: '14px',
          textAlign: 'center',
          boxShadow: `0 4px 24px ${zone.color}66`,
          zIndex: 10,
        }}
      >
        <div style={{ fontSize: '10px', opacity: 0.85, marginBottom: '2px', letterSpacing: '1.5px' }}>PUNTO {zone.id}</div>
        {zone.title}
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: '24px',
          left: '24px',
          zIndex: 10,
          background: 'rgba(0,0,0,0.75)',
          padding: '14px 18px',
          borderRadius: '12px',
          color: 'white',
          fontFamily: 'system-ui,sans-serif',
          maxWidth: '240px',
          borderLeft: `4px solid ${zone.color}`,
          backdropFilter: 'blur(8px)',
        }}
      >
        <div style={{ fontSize: '10px', color: zone.color, fontWeight: 'bold', letterSpacing: '1px', marginBottom: '4px' }}>ZONA {zone.id}</div>
        <div style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '4px' }}>{zone.title}</div>
        <div style={{ fontSize: '12px', color: '#bbb', lineHeight: '1.4' }}>{zone.description}</div>
      </div>

      <button
        onClick={onExit}
        style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
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
          fontFamily: 'system-ui,sans-serif',
        }}
      >
        ✕ Volver al mapa
      </button>

      <style
        dangerouslySetInnerHTML={{
          __html: `
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
      `,
        }}
      />
    </div>
  )
}

// ─── Initial load overlay (spinner / ngrok-blocked retry) ─────────────
function LoadOverlay({ state, onRetry, onExit }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: '#111',
        zIndex: 500,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '18px',
        textAlign: 'center',
        padding: '24px',
        color: 'white',
        fontFamily: 'system-ui,sans-serif',
      }}
    >
      {state === 'checking' ? (
        <>
          <div className="pano-spinner" />
          <div style={{ fontSize: '14px', letterSpacing: '1px', opacity: 0.85 }}>Cargando vista 360°…</div>
        </>
      ) : state === 'blocked' ? (
        <>
          <div style={{ fontSize: '15px', maxWidth: '320px', lineHeight: 1.5 }}>
            No se pudo cargar la vista 360°.
            <br />
            Esto suele pasar la primera vez que se abre el enlace de ngrok.
          </div>
          <button
            onClick={onRetry}
            style={{
              background: '#3498db',
              border: 'none',
              borderRadius: '10px',
              padding: '12px 26px',
              color: 'white',
              fontWeight: 'bold',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Click para cargar
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: '15px', maxWidth: '320px', lineHeight: 1.5 }}>
            Ocurrió un error al cargar esta vista 360°.
          </div>
          <button
            onClick={onRetry}
            style={{
              background: '#3498db',
              border: 'none',
              borderRadius: '10px',
              padding: '12px 26px',
              color: 'white',
              fontWeight: 'bold',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        </>
      )}

      <button
        onClick={onExit}
        style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          background: 'rgba(255,255,255,0.1)',
          border: '2px solid rgba(255,255,255,0.25)',
          borderRadius: '10px',
          padding: '9px 18px',
          color: 'white',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 'bold',
        }}
      >
        ✕ Volver al mapa
      </button>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .pano-spinner {
          width: 42px;
          height: 42px;
          border: 4px solid rgba(255,255,255,0.15);
          border-top-color: #3498db;
          border-radius: 50%;
          animation: pano-spin 0.8s linear infinite;
        }
        @keyframes pano-spin {
          to { transform: rotate(360deg); }
        }
      `,
        }}
      />
    </div>
  )
}

const MIN_SPINNER_MS = 500

export default function Panorama360({ onExit, initialPoint }) {
  const zones = useMemo(() => prepareAllZones(CEMETERY_POINTS), [])
  const [selectedZone, setSelectedZone] = useState(() => {
    if (initialPoint) {
      const found = zones.find(z => z.id === initialPoint.id)
      if (found) return found
    }
    const params = new URLSearchParams(window.location.search)
    const pointId = params.get('point')
    if (pointId) {
      const found = zones.find(z => z.id === pointId)
      if (found) return found
    }
    return zones[0] || null
  })
  const [retryCount, setRetryCount] = useState(0)

  // Sync selectedZone to URL search parameters
  useEffect(() => {
    if (selectedZone) {
      const url = new URL(window.location.href)
      if (url.searchParams.get('point') !== selectedZone.id) {
        url.searchParams.set('point', selectedZone.id)
        window.history.replaceState({}, '', url.pathname + url.search)
      }
    }
  }, [selectedZone])

  // Only preload the active zone and its connected neighbors
  useEffect(() => {
    if (!selectedZone) return

    // 1. Immediately preload the active panorama
    preloadImage(selectedZone.panorama)

    // 2. Preload neighboring panoramas (hotspot targets)
    const neighborIds = selectedZone.connections || []
    neighborIds.forEach(id => {
      const neighbor = zones.find(z => z.id === id)
      if (neighbor && neighbor.panorama) {
        preloadImage(neighbor.panorama)
      }
    })
  }, [selectedZone, zones])

  const handleNavigate = useCallback(
    targetId => {
      const target = zones.find(z => z.id === targetId)
      if (target) setSelectedZone(target)
    },
    [zones]
  )

  if (!selectedZone) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontFamily: 'system-ui,sans-serif' }}>
        No hay panoramas 360° disponibles.
      </div>
    )
  }

  // Hand off directly to Pannellum. The viewer's own 'error' handler will
  // show the retry overlay if any scene fails to load (covers ngrok 6024
  // first-hit, expired signed URLs, real 404s, etc).
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#000' }}>
      <PanoramaViewer
        key={`${selectedZone.id}-${retryCount}`}
        zone={selectedZone}
        onNavigate={handleNavigate}
        onExit={onExit}
        zonesList={zones}
      />
    </div>
  )
}
