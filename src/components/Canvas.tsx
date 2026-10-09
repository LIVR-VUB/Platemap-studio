import { useEffect, useRef, useState } from 'react'
import { PlateFigure, geometry } from './PlateFigure'
import { useStore, setUI, select, setValues, clearWells, curPlate, getState, deletePlate, duplicatePlate, movePlate } from '../store'
import { wellId, rowLabel, fmtUnit } from '../model'

type Hit = { kind: 'well'; r: number; c: number } | { kind: 'row'; r: number } | { kind: 'col'; c: number } | { kind: 'corner' } | null

export function Canvas() {
  const doc = useStore((s) => s.doc)
  const ui = useStore((s) => s.ui)
  const plate = useStore((s) => curPlate(s))
  const wrap = useRef<HTMLDivElement>(null)
  const [marquee, setMarquee] = useState<{ r0: number; c0: number; r1: number; c1: number } | null>(null)
  const painted = useRef<Set<string> | null>(null)
  const [, force] = useState(0)
  const G = geometry(doc, plate)

  const hitTest = (e: { clientX: number; clientY: number }): Hit => {
    const svg = wrap.current?.querySelector('svg')
    if (!svg) return null
    const b = svg.getBoundingClientRect()
    const z = getState().ui.zoom
    const x = (e.clientX - b.left) / z, y = (e.clientY - b.top) / z
    const fx = (x - G.plateX - G.pad + doc.style.gap / 2) / G.pitch
    const fy = (y - G.plateY - G.pad + doc.style.gap / 2) / G.pitch
    const c = Math.floor(fx), r = Math.floor(fy)
    const inCols = c >= 0 && c < plate.cols, inRows = r >= 0 && r < plate.rows
    const headerTop = y < G.plateY && y > G.plateY - G.hdr - 4
    const headerLeft = x < G.plateX && x > G.plateX - G.hdr - 4
    if (headerTop && headerLeft) return { kind: 'corner' }
    if (headerTop && inCols) return { kind: 'col', c }
    if (headerLeft && inRows) return { kind: 'row', r }
    if (inCols && inRows) return { kind: 'well', r, c }
    return null
  }

  const mode = (e: React.PointerEvent | PointerEvent): 'add' | 'toggle' | 'replace' => (e.shiftKey ? 'add' : e.ctrlKey || e.metaKey ? 'toggle' : 'replace')

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const ui = getState().ui // live state, not the last render's
    const h = hitTest(e)
    if (!h) { if (!e.shiftKey) select([]); return }
    const rows = (r: number) => Array.from({ length: plate.cols }, (_, c) => wellId(r, c))
    const cols = (c: number) => Array.from({ length: plate.rows }, (_, r) => wellId(r, c))
    if (h.kind === 'corner') return select(Array.from({ length: plate.rows }, (_, r) => rows(r)).flat())
    if (h.kind === 'row' || h.kind === 'col') {
      const start = h.kind === 'row' ? h.r : h.c
      const base = new Set(e.shiftKey || e.ctrlKey ? ui.selection : [])
      const apply = (end: number) => {
        const s = new Set(base)
        for (let i = Math.min(start, end); i <= Math.max(start, end); i++) (h.kind === 'row' ? rows(i) : cols(i)).forEach((w) => s.add(w))
        setUI({ selection: s })
      }
      apply(start)
      const move = (ev: PointerEvent) => { const hh = hitTest(ev); if (hh && hh.kind === h.kind) apply(h.kind === 'row' ? (hh as { r: number }).r : (hh as { c: number }).c) }
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      return
    }
    if (h.kind !== 'well') return
    if (ui.tool === 'select') {
      const m = mode(e)
      const base = new Set(ui.selection)
      const sel = (r1: number, c1: number) => {
        const s = m === 'replace' ? new Set<string>() : new Set(base)
        for (let r = Math.min(h.r, r1); r <= Math.max(h.r, r1); r++)
          for (let c = Math.min(h.c, c1); c <= Math.max(h.c, c1); c++) {
            const w = wellId(r, c)
            if (m === 'toggle' && base.has(w)) s.delete(w)
            else s.add(w)
          }
        setUI({ selection: s })
      }
      sel(h.r, h.c)
      setMarquee({ r0: h.r, c0: h.c, r1: h.r, c1: h.c })
      const move = (ev: PointerEvent) => {
        const hh = hitTest(ev)
        if (hh?.kind === 'well') { setMarquee({ r0: h.r, c0: h.c, r1: hh.r, c1: hh.c }); sel(hh.r, hh.c) }
      }
      const up = () => { setMarquee(null); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    } else {
      // brush / erase: collect wells while dragging, commit once on release (one undo step).
      painted.current = new Set([wellId(h.r, h.c)])
      force((x) => x + 1)
      const move = (ev: PointerEvent) => {
        const hh = hitTest(ev)
        if (hh?.kind === 'well' && painted.current) { painted.current.add(wellId(hh.r, hh.c)); force((x) => x + 1) }
      }
      const up = () => {
        const wells = [...(painted.current ?? [])]
        painted.current = null
        const { ui: u } = getState()
        if (u.tool === 'erase') clearWells(wells)
        else if (u.brush) setValues(wells, u.brush.fieldId, u.brush.value)
        force((x) => x + 1)
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
  }

  const onMove = (e: React.PointerEvent) => {
    const h = hitTest(e)
    const id = h?.kind === 'well' ? wellId(h.r, h.c) : null
    if (id !== ui.hover) setUI({ hover: id })
  }

  useEffect(() => {
    const el = wrap.current!
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const z = getState().ui.zoom
      setUI({ zoom: Math.max(0.2, Math.min(6, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  const fit = () => {
    const el = wrap.current!
    setUI({ zoom: Math.max(0.2, Math.min(6, Math.min((el.clientWidth - 48) / G.width, (el.clientHeight - 48) / G.height))) })
  }
  useEffect(fit, [plate.id, plate.rows, plate.cols]) // eslint-disable-line react-hooks/exhaustive-deps

  const preview = painted.current ? new Set([...ui.selection, ...painted.current]) : ui.selection
  const cursor = ui.tool === 'brush' ? 'cell' : ui.tool === 'erase' ? 'crosshair' : 'default'

  return (
    <div className="canvas-area">
      <PlateTabs />
      <div ref={wrap} className="canvas-scroll" onPointerDown={onDown} onPointerMove={onMove} onPointerLeave={() => setUI({ hover: null })} style={{ cursor }}>
        <div className="canvas-paper">
          <PlateFigure doc={doc} plate={plate} selection={preview} hover={ui.hover} zoom={ui.zoom} marquee={marquee} />
        </div>
      </div>
      <StatusBar onFit={fit} />
    </div>
  )
}

function PlateTabs() {
  const plates = useStore((s) => s.doc.plates)
  const cur = useStore((s) => s.ui.plateId)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])
  return (
    <div className="tabs">
      {plates.map((p) => (
        <div
          key={p.id}
          className={'tab' + (p.id === cur ? ' active' : '')}
          onClick={() => setUI({ plateId: p.id, selection: new Set() })}
          onDoubleClick={() => setUI({ dialog: 'plateSettings', dialogArg: p.id })}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ id: p.id, x: e.clientX, y: e.clientY }) }}
          title="Double-click for plate settings · right-click for more"
        >
          <span className="tab-fmt">{p.rows * p.cols}</span>{p.name}
        </div>
      ))}
      <button className="tab-add" title="New plate" onClick={() => setUI({ dialog: 'newPlate' })}>＋</button>
      {menu && (
        <div className="menu" style={{ left: menu.x, top: menu.y, position: 'fixed' }} onPointerDown={(e) => e.stopPropagation()}>
          {([
            ['Plate settings…', () => setUI({ dialog: 'plateSettings', dialogArg: menu.id })],
            ['Duplicate', () => duplicatePlate(menu.id)],
            ['Replicate / randomize…', () => setUI({ plateId: menu.id, dialog: 'replicate' })],
            ['Move left', () => movePlate(menu.id, -1)],
            ['Move right', () => movePlate(menu.id, 1)],
            ['Delete plate', () => { if (confirm('Delete this plate? (Undo with Ctrl+Z)')) deletePlate(menu.id) }],
          ] as const).map(([label, fn]) => (
            <div key={label} className="menu-item" onClick={() => { fn(); setMenu(null) }}>{label}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusBar({ onFit }: { onFit: () => void }) {
  const hover = useStore((s) => s.ui.hover)
  const zoom = useStore((s) => s.ui.zoom)
  const nSel = useStore((s) => s.ui.selection.size)
  const plate = useStore((s) => curPlate(s))
  const fields = useStore((s) => s.doc.fields)
  const tool = useStore((s) => s.ui.tool)
  const brush = useStore((s) => s.ui.brush)
  const data = hover ? plate.wells[hover] : undefined
  const info = data ? fields.filter((f) => data[f.id] !== undefined).map((f) => `${f.name}: ${fmtUnit(data[f.id], f, data)}`).join('  ·  ') : ''
  const filled = Object.keys(plate.wells).length
  return (
    <div className="statusbar">
      <span className="sb-well">{hover ?? '—'}</span>
      <span className="sb-info">{info || (hover ? 'empty' : '')}</span>
      <span className="sb-sp" />
      {tool === 'brush' && <span className="sb-pill">Brush: {brush ? `${fields.find((f) => f.id === brush.fieldId)?.name} = ${String(brush.value)}` : 'pick a value in Fields panel'}</span>}
      <span>{nSel} selected</span>
      <span>{filled}/{plate.rows * plate.cols} filled · {plate.rows}×{plate.cols} ({rowLabel(0)}–{rowLabel(plate.rows - 1)})</span>
      <button className="icon-btn" onClick={() => setUI({ zoom: Math.max(0.2, zoom / 1.2) })}>−</button>
      <input className="zoom-range" type="range" min={0.2} max={4} step={0.01} value={zoom} onChange={(e) => setUI({ zoom: +e.target.value })} />
      <button className="icon-btn" onClick={() => setUI({ zoom: Math.min(6, zoom * 1.2) })}>+</button>
      <span className="sb-zoom">{Math.round(zoom * 100)}%</span>
      <button className="text-btn" onClick={onFit}>Fit</button>
      <button className="text-btn" onClick={() => setUI({ zoom: 1 })}>1:1</button>
    </div>
  )
}
