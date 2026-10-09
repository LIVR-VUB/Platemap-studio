import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PALETTES, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb } from '../model'
import { breakCoalesce, endColorEdit } from '../store'

const RECENT_KEY = 'platemap.recentColors'
function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] }
}
function pushRecent(c: string) {
  const r = [c, ...loadRecent().filter((x) => x !== c)].slice(0, 16)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)) } catch { /* ignore */ }
}

/** Swatch button that opens a floating picker. onChange fires live while dragging. */
export function ColorSwatch({ color, onChange, size = 18, title }: { color: string; onChange: (c: string) => void; size?: number; title?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={ref}
        className="swatch"
        title={title ?? color}
        style={{ width: size, height: size, background: color }}
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
      />
      {open && ref.current && (
        <ColorPopover anchor={ref.current} color={color} onChange={onChange} onClose={() => { setOpen(false); pushRecent(color); endColorEdit(); breakCoalesce() }} />
      )}
    </>
  )
}

function ColorPopover({ anchor, color, onChange, onClose }: { anchor: HTMLElement; color: string; onChange: (c: string) => void; onClose: () => void }) {
  const [hsv, setHsv] = useState(() => rgbToHsv(...hexToRgb(color)))
  const [hex, setHex] = useState(color)
  const [pal, setPal] = useState('Okabe-Ito')
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const recent = useRef(loadRecent()).current

  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect(), W = 252, H = 380
    setPos({
      left: Math.max(8, Math.min(a.left, window.innerWidth - W - 8)),
      top: a.bottom + H + 8 > window.innerHeight ? Math.max(8, a.top - H - 6) : a.bottom + 6,
    })
  }, [anchor])

  useEffect(() => {
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node) && e.target !== anchor) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') onClose() }
    window.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key) }
  }, [anchor, onClose])

  const emit = (h: [number, number, number]) => {
    setHsv(h)
    const c = rgbToHex(...hsvToRgb(...h))
    setHex(c)
    onChange(c)
  }
  const emitHex = (c: string) => {
    setHex(c)
    if (/^#?[0-9a-f]{6}$/i.test(c)) {
      const n = c.startsWith('#') ? c : '#' + c
      setHsv(rgbToHsv(...hexToRgb(n)))
      onChange(n.toLowerCase())
    }
  }

  const drag = (el: HTMLElement, fn: (x: number, y: number) => void) => (e: React.PointerEvent) => {
    const r = el.getBoundingClientRect()
    const move = (ev: PointerEvent | React.PointerEvent) =>
      fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)))
    move(e)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const sv = useRef<HTMLDivElement>(null), hue = useRef<HTMLDivElement>(null)
  const rgb = hexToRgb(hex.length >= 7 ? hex : color)
  const ED = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper

  return createPortal(
    <div ref={box} className="cp" style={pos} onPointerDown={(e) => e.stopPropagation()}>
      <div
        ref={sv}
        className="cp-sv"
        style={{ background: `hsl(${hsv[0]} 100% 50%)` }}
        onPointerDown={(e) => drag(sv.current!, (x, y) => emit([hsv[0], x, 1 - y]))(e)}
      >
        <div className="cp-sv-w" />
        <div className="cp-sv-b" />
        <div className="cp-knob" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%` }} />
      </div>
      <div ref={hue} className="cp-hue" onPointerDown={(e) => drag(hue.current!, (x) => emit([x * 359.9, hsv[1], hsv[2]]))(e)}>
        <div className="cp-hue-knob" style={{ left: `${(hsv[0] / 360) * 100}%` }} />
      </div>
      <div className="cp-row">
        <div className="cp-preview" style={{ background: hex }} />
        <input className="cp-hex" value={hex} onChange={(e) => emitHex(e.target.value)} spellCheck={false} />
        {ED && (
          <button className="icon-btn" title="Eyedropper" onClick={async () => {
            try { emitHex((await new ED().open()).sRGBHex) } catch { /* cancelled */ }
          }}>⌖</button>
        )}
      </div>
      <div className="cp-row">
        {(['R', 'G', 'B'] as const).map((ch, i) => (
          <label key={ch} className="cp-num">{ch}
            <input type="number" min={0} max={255} value={rgb[i]} onChange={(e) => {
              const v = rgb.slice() as [number, number, number]
              v[i] = Math.max(0, Math.min(255, +e.target.value || 0))
              emitHex(rgbToHex(...v))
            }} />
          </label>
        ))}
      </div>
      {recent.length > 0 && (
        <>
          <div className="cp-label">Recent</div>
          <div className="cp-swatches">{recent.map((c) => <button key={c} className="swatch" style={{ background: c }} onClick={() => emitHex(c)} />)}</div>
        </>
      )}
      <div className="cp-label">
        <select value={pal} onChange={(e) => setPal(e.target.value)}>
          {Object.keys(PALETTES).map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>
      <div className="cp-swatches">{PALETTES[pal].map((c) => <button key={c} className="swatch" style={{ background: c }} onClick={() => emitHex(c.toLowerCase())} />)}</div>
    </div>,
    document.body,
  )
}
