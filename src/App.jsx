import { useState } from 'react'
import CemeteryMap2D from './components/CemeteryMap2D'
import Panorama360 from './components/Panorama360'
import './App.css'

const TABS = [
  { id: 'map', label: '🗺️  Mapa 2D' },
  { id: '360', label: '📸  360°' },
]

function App() {
  const [view, setView] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.has('point') ? '360' : 'map'
  })
  const [selectedSection, setSelectedSection] = useState(null) // null = full map
  const [initialPoint, setInitialPoint] = useState(null) // point object to open in 360

  const handleSetView = (newView) => {
    setView(newView)
    if (newView === 'map') {
      const url = new URL(window.location.href)
      url.searchParams.delete('point')
      window.history.replaceState({}, '', url.pathname + url.search)
    } else if (newView === '360') {
      setInitialPoint(null)
    }
  }

  const handleSelectPoint = (point) => {
    setInitialPoint(point)
    setView('360')
  }

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {view === 'map' ? (
        <CemeteryMap2D
          selectedSection={selectedSection}
          onSelectSection={setSelectedSection}
          onSelectPoint={handleSelectPoint}
        />
      ) : (
        <Panorama360 initialPoint={initialPoint} onExit={() => handleSetView('map')} />
      )}

      <div
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          zIndex: 300,
          display: 'flex',
          gap: '4px',
          background: 'rgba(255,255,255,0.9)',
          padding: '5px',
          borderRadius: '12px',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(0,0,0,0.08)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
        }}
      >
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleSetView(tab.id)}
            style={{
              background: view === tab.id ? '#2c2c2c' : 'transparent',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 18px',
              color: view === tab.id ? 'white' : '#666',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: view === tab.id ? 'bold' : 'normal',
              transition: 'all 0.2s',
              fontFamily: 'system-ui,sans-serif',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default App