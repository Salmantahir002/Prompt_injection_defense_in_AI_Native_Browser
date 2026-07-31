import { createRoot } from 'react-dom/client'
import { KimoMascot } from './components/KimoMascot'

createRoot(document.getElementById('root')!).render(
  <div>
    <div className="row">
      <KimoMascot />
      <div className="hdr">
        <div style={{ width: 30, height: 30, display: 'grid', placeItems: 'center' }}>
          <KimoMascot compact />
        </div>
        <h2>Kimo</h2>
      </div>
      <span className="cap">compact 26px / full 132px</span>
    </div>
  </div>,
)
