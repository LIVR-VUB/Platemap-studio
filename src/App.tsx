import { useEffect, useRef, useState } from 'react'
import logo from './assets/logo.png'
import { Canvas } from './components/Canvas'
import { LeftPanel, RightPanel } from './components/Panels'
import { Dialogs } from './components/Dialogs'
import {
  useStore, setUI, undo, redo, select, clearWells, copySelection, paste, curPlate, getState,
  duplicatePlate, deletePlate,
} from './store'
import { allWells } from './model'
import { native, saveProject, openProject, importTable, exportCSV } from './io'

type Item = [label: string, action: () => void, shortcut?: string] | '-'

const MENUS: Record<string, () => Item[]> = {
  File: () => [
    ['New project…', () => setUI({ dialog: 'start' }), 'Ctrl+N'],
    ['Open project…', openProject, 'Ctrl+O'],
    ['Save project', () => saveProject(), 'Ctrl+S'],
    ['Save project as…', () => saveProject(true), 'Ctrl+Shift+S'],
    '-',
    ['Import table / platemap (CSV/TSV)…', importTable],
    '-',
    ['Export figure…', () => setUI({ dialog: 'export' }), 'Ctrl+E'],
    ['Export data: CSV (all wells)', () => exportCSV(false)],
    ['Export data: CSV (filled wells)', () => exportCSV(true)],
    ['Export platemap (pycytominer)…', () => setUI({ dialog: 'platemap' }), 'Ctrl+Shift+E'],
  ],
  Edit: () => [
    ['Undo', undo, 'Ctrl+Z'],
    ['Redo', redo, 'Ctrl+Shift+Z'],
    '-',
    ['Copy wells', copySelection, 'Ctrl+C'],
    ['Paste wells', paste, 'Ctrl+V'],
    ['Clear selected wells', () => clearWells(), 'Del'],
    '-',
    ['Select all', () => select(allWells(curPlate())), 'Ctrl+A'],
    ['Deselect', () => select([]), 'Ctrl+D'],
  ],
  Plate: () => [
    ['New plate…', () => setUI({ dialog: 'newPlate' })],
    ['Plate settings…', () => setUI({ dialog: 'plateSettings', dialogArg: getState().ui.plateId })],
    ['Duplicate plate', () => duplicatePlate(getState().ui.plateId)],
    ['Delete plate', () => { if (confirm('Delete current plate? (Undo restores it)')) deletePlate(getState().ui.plateId) }],
  ],
  Tools: () => [
    ['Serial dilution…', () => setUI({ dialog: 'dilution' })],
    ['Distribute controls…', () => setUI({ dialog: 'controls' })],
    ['Randomize layout…', () => setUI({ dialog: 'randomize' })],
    ['Replicate plates…', () => setUI({ dialog: 'replicate' })],
    ['Combine 4 × 96 → 384…', () => setUI({ dialog: 'compress' })],
    '-',
    ['New custom field…', () => setUI({ dialog: 'field', dialogArg: undefined })],
  ],
  View: () => [
    ['Zoom in', () => setUI({ zoom: Math.min(6, getState().ui.zoom * 1.2) }), 'Ctrl+='],
    ['Zoom out', () => setUI({ zoom: Math.max(0.2, getState().ui.zoom / 1.2) }), 'Ctrl+-'],
    ['Actual size', () => setUI({ zoom: 1 }), 'Ctrl+1'],
    '-',
    ['Layers', () => setUI({ rightTab: 'layers' })],
    ['Figure style', () => setUI({ rightTab: 'style' })],
    ['History', () => setUI({ rightTab: 'history' })],
    ['Checks', () => setUI({ rightTab: 'checks' })],
  ],
  Help: () => [['Keyboard shortcuts', () => setUI({ dialog: 'about' })]],
}

function TitleBar() {
  const [open, setOpen] = useState<string | null>(null)
  const [max, setMax] = useState(false)
  const name = useStore((s) => s.doc.name)
  const dirty = useStore((s) => s.doc !== s.ui.savedDoc)
  const file = useStore((s) => s.ui.filePath)
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => { native?.onMaximized(setMax) }, [])
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => { if (!bar.current?.contains(e.target as Node)) setOpen(null) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div className="titlebar" ref={bar} onDoubleClick={(e) => e.target === e.currentTarget && native?.maximize()}>
      <div className="logo" title="PlateMap Studio">
        <img src={logo} alt="L'ivr" />
      </div>
      <div className="menubar">
        {Object.keys(MENUS).map((m) => (
          <div key={m} className={'menu-root' + (open === m ? ' open' : '')}
            onPointerDown={() => setOpen(open === m ? null : m)}
            onPointerEnter={() => open && setOpen(m)}>
            {m}
            {open === m && (
              <div className="menu" onPointerDown={(e) => e.stopPropagation()}>
                {MENUS[m]().map((it, i) => it === '-'
                  ? <div key={i} className="menu-sep" />
                  : <div key={i} className="menu-item" onClick={() => { setOpen(null); it[1]() }}><span>{it[0]}</span><kbd>{it[2] ?? ''}</kbd></div>)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="title-center">
        <span className="title-name">{name}</span>
        {dirty && <span className="dirty" title="Unsaved changes (autosaved locally)">●</span>}
        {file && <span className="title-file">{file.split(/[\\/]/).pop()}</span>}
      </div>
      <div className="title-actions">
        <button className="tb-btn" title="Undo (Ctrl+Z)" onClick={undo}>↶</button>
        <button className="tb-btn" title="Redo (Ctrl+Shift+Z)" onClick={redo}>↷</button>
        <button className="tb-btn" title="pycytominer platemap CSV (Ctrl+Shift+E)" onClick={() => setUI({ dialog: 'platemap' })}>Platemap CSV</button>
        <button className="tb-btn primary" onClick={() => setUI({ dialog: 'export' })}>Export</button>
      </div>
      {native && (
        <div className="winctl">
          <button onClick={native.minimize} title="Minimize"><svg width="10" height="10"><path d="M0 5h10" stroke="currentColor" /></svg></button>
          <button onClick={native.maximize} title={max ? 'Restore' : 'Maximize'}>
            <svg width="10" height="10">{max ? <path d="M2 0.5h7.5v7.5M0.5 2.5h7v7h-7z" stroke="currentColor" fill="none" /> : <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" fill="none" />}</svg>
          </button>
          <button className="close" onClick={native.close} title="Close"><svg width="10" height="10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" /></svg></button>
        </div>
      )}
    </div>
  )
}

function useShortcuts() {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select') || getState().ui.dialog) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const run = (fn: () => void) => { e.preventDefault(); fn() }
      if (mod && key === 'z') run(e.shiftKey ? redo : undo)
      else if (mod && key === 'y') run(redo)
      else if (mod && key === 's') run(() => saveProject(e.shiftKey))
      else if (mod && key === 'o') run(openProject)
      else if (mod && key === 'n') run(() => setUI({ dialog: 'start' }))
      else if (mod && key === 'e') run(() => setUI({ dialog: e.shiftKey ? 'platemap' : 'export' }))
      else if (mod && key === 'a') run(() => select(allWells(curPlate())))
      else if (mod && key === 'd') run(() => select([]))
      else if (mod && key === 'c') run(copySelection)
      else if (mod && key === 'v') run(paste)
      else if (mod && (key === '=' || key === '+')) run(() => setUI({ zoom: Math.min(6, getState().ui.zoom * 1.2) }))
      else if (mod && key === '-') run(() => setUI({ zoom: Math.max(0.2, getState().ui.zoom / 1.2) }))
      else if (mod && key === '1') run(() => setUI({ zoom: 1 }))
      else if (mod) return
      else if (key === 'delete' || key === 'backspace') run(() => clearWells())
      else if (key === 'v') setUI({ tool: 'select' })
      else if (key === 'b') setUI({ tool: 'brush' })
      else if (key === 'e') setUI({ tool: 'erase' })
      else if (key === 'escape') select([])
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
}

export default function App() {
  useShortcuts()
  const [lw, setLw] = useState(290)
  const [rw, setRw] = useState(330)
  const splitter = (side: 'l' | 'r') => (e: React.PointerEvent) => {
    const x0 = e.clientX, w0 = side === 'l' ? lw : rw
    const move = (ev: PointerEvent) => {
      const w = Math.max(220, Math.min(560, w0 + (side === 'l' ? ev.clientX - x0 : x0 - ev.clientX)))
      if (side === 'l') setLw(w)
      else setRw(w)
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="app">
      <TitleBar />
      <div className="workspace" style={{ gridTemplateColumns: `${lw}px 4px 1fr 4px ${rw}px` }}>
        <LeftPanel />
        <div className="splitter" onPointerDown={splitter('l')} />
        <Canvas />
        <div className="splitter" onPointerDown={splitter('r')} />
        <RightPanel />
      </div>
      <Dialogs />
    </div>
  )
}
