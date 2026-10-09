// Pure SVG plate figure. Same component renders the editor canvas and every export (SVG/PNG/PDF).
import type { ReactNode } from 'react'
import {
  type Doc, type Plate, type Value, type LayerKind,
  rowLabel, wellId, mix, rampColor, textOn, fmt, numericRange, normalize,
} from '../model'
import { usedValues } from '../store'

export interface Geometry {
  width: number; height: number
  plateX: number; plateY: number; pad: number; pitch: number; size: number; hdr: number
}

export function geometry(doc: Doc, plate: Plate): Geometry & { legend: LegendSection[]; lx: number; ly: number } {
  const st = doc.style
  const size = st.wellSize, pitch = size + st.gap, m = 16
  const hdr = st.showHeaders ? Math.max(16, Math.min(st.fontSize * 1.7, pitch)) : 0
  const pad = Math.max(6, size * 0.35)
  const titleH = st.showTitle ? st.fontSize * 2.4 : 0
  const plateX = m + hdr, plateY = m + titleH + hdr
  const pw = plate.cols * pitch - st.gap + 2 * pad, ph = plate.rows * pitch - st.gap + 2 * pad
  const legend = st.showLegend ? legendSections(doc, plate) : []
  const lh = st.fontSize * 1.55
  let width = plateX + pw + m, height = plateY + ph + m, lx = 0, ly = 0
  if (legend.length) {
    const secH = (s: LegendSection) => lh * (1.3 + s.rows) + 10
    const secW = (s: LegendSection) => Math.max(textW(s.title, st.fontSize, true), s.width(st.fontSize)) + 12
    if (st.legendPos === 'right') {
      lx = plateX + pw + 28; ly = plateY
      width = Math.max(width, lx + Math.max(...legend.map(secW)) + m)
      height = Math.max(height, ly + legend.reduce((a, s) => a + secH(s), 0) + m)
    } else {
      lx = plateX; ly = plateY + ph + 24
      width = Math.max(width, lx + legend.reduce((a, s) => a + secW(s) + 24, 0) + m)
      height = Math.max(height, ly + Math.max(...legend.map(secH)) + m)
    }
  }
  return { width: Math.ceil(width), height: Math.ceil(height), plateX, plateY, pad, pitch, size, hdr, legend, lx, ly }
}

const textW = (s: string, fs: number, bold = false) => s.length * fs * (bold ? 0.62 : 0.56)

// ---------- color resolution ----------
export function makeResolver(doc: Doc) {
  const fields = new Map(doc.fields.map((f) => [f.id, f]))
  const ranges = new Map<string, [number, number]>()
  const range = (id: string, scale: 'linear' | 'log' = 'linear') => {
    const k = id + scale
    if (!ranges.has(k)) ranges.set(k, numericRange(doc, id, scale === 'log'))
    return ranges.get(k)!
  }
  const L = doc.layers
  const val = (data: Record<string, Value> | undefined, k: LayerKind) => {
    const l = L[k]
    return l.visible && l.fieldId && data ? data[l.fieldId] : undefined
  }
  const color = (k: LayerKind, v: Value | undefined): string | undefined => {
    const l = L[k], f = l.fieldId ? fields.get(l.fieldId) : undefined
    if (v === undefined || !f) return undefined
    if (typeof v === 'number') return rampColor(l.ramp, normalize(v, range(f.id, l.scale), l.scale))
    if (typeof v === 'boolean') return v ? '#333333' : undefined
    return f.colors[v] ?? '#888888'
  }
  return { fields, range, val, color }
}

export interface WellLook { fill: string; ring?: string; dot?: string; bar?: number; label?: string; hatch: boolean }

export function wellLook(doc: Doc, R: ReturnType<typeof makeResolver>, data?: Record<string, Value>): WellLook {
  const L = doc.layers
  let fill = R.color('fill', R.val(data, 'fill'))
  const sv = R.val(data, 'shade')
  if (typeof sv === 'number' && L.shade.fieldId) {
    const t = normalize(sv, R.range(L.shade.fieldId, L.shade.scale), L.shade.scale)
    fill = fill ? mix('#ffffff', fill, 0.15 + 0.85 * t) : rampColor(L.shade.ramp, t)
  }
  const bv = R.val(data, 'bar')
  const lv = R.val(data, 'label'), hv = R.val(data, 'hatch')
  return {
    fill: fill ?? doc.style.emptyColor,
    ring: R.color('ring', R.val(data, 'ring')),
    dot: R.color('dot', R.val(data, 'dot')),
    bar: typeof bv === 'number' && L.bar.fieldId ? Math.max(0.04, normalize(bv, R.range(L.bar.fieldId, L.bar.scale), L.bar.scale)) : undefined,
    label: lv === undefined ? undefined : fmt(lv),
    hatch: hv !== undefined && hv !== false && hv !== '',
  }
}

// ---------- legend ----------
export interface LegendSection {
  title: string
  rows: number
  width: (fs: number) => number
  render: (x: number, y: number, fs: number, lh: number, idp: string) => ReactNode
}

function legendSections(doc: Doc, plate: Plate): LegendSection[] {
  const R = makeResolver(doc)
  const out: LegendSection[] = []
  const seen = new Set<string>()
  const kinds: LayerKind[] = ['fill', 'shade', 'ring', 'dot', 'bar', 'hatch']
  for (const k of kinds) {
    const l = doc.layers[k]
    const f = l.visible && l.fieldId ? R.fields.get(l.fieldId) : undefined
    if (!f) continue
    const vals = usedValues(doc, f.id, plate)
    if (!vals.length) continue
    const unit = f.unit ? ` (${f.unit})` : ''
    const key = k + f.id
    if (seen.has(key)) continue
    seen.add(key)
    const numeric = vals.every((v) => typeof v === 'number')
    if (numeric && k !== 'hatch') {
      const [lo, hi] = R.range(f.id, l.scale)
      const ramp = k === 'shade' ? ['#ffffff', '#555555'] : l.ramp
      const what = k === 'bar' ? 'bar length' : k === 'shade' ? 'intensity' : k
      out.push({
        title: `${f.name}${unit}`, rows: 1.6,
        width: (fs) => Math.max(140, textW(`${what}`, fs)),
        render: (x, y, fs, _lh, idp) => {
          const gid = `${idp}-g-${k}`
          return (
            <g key={key}>
              <defs>
                <linearGradient id={gid}>
                  {ramp.map((c, i) => <stop key={i} offset={i / (ramp.length - 1)} stopColor={c} />)}
                </linearGradient>
              </defs>
              {k === 'bar'
                ? <path d={`M${x} ${y + 12} L${x + 120} ${y + 2} L${x + 120} ${y + 12} Z`} fill="#555" />
                : <rect x={x} y={y} width={120} height={12} rx={2} fill={`url(#${gid})`} stroke="#00000033" />}
              <text x={x} y={y + 12 + fs * 1.1} fontSize={fs * 0.85}>{fmt(lo)}</text>
              <text x={x + 120} y={y + 12 + fs * 1.1} fontSize={fs * 0.85} textAnchor="end">{fmt(hi)}</text>
              <text x={x + 128} y={y + 10} fontSize={fs * 0.8} fill="#777">{l.scale === 'log' ? 'log' : ''}</text>
            </g>
          )
        },
      })
      continue
    }
    const items = k === 'hatch' ? [vals.find((v) => v !== false) ?? true] : vals
    out.push({
      title: k === 'hatch' ? 'Hatched' : `${f.name}${unit}`,
      rows: items.length,
      width: (fs) => 26 + Math.max(...items.map((v) => textW(k === 'hatch' ? f.name : fmt(v), fs))),
      render: (x, y, fs, lh, idp) => (
        <g key={key}>
          {items.map((v, i) => {
            const cy = y + i * lh + fs * 0.45
            const c = R.color(k === 'hatch' ? 'fill' : k, v) ?? '#888'
            const r = fs * 0.55
            return (
              <g key={String(v)}>
                {k === 'fill' && <circle cx={x + r} cy={cy} r={r} fill={c} stroke="#00000040" strokeWidth={0.75} />}
                {k === 'ring' && <circle cx={x + r} cy={cy} r={r - 1.5} fill="#fff" stroke={c} strokeWidth={3} />}
                {k === 'dot' && <circle cx={x + r} cy={cy} r={r * 0.6} fill={c} stroke="#fff" strokeWidth={1} />}
                {k === 'hatch' && <rect x={x} y={cy - r} width={2 * r} height={2 * r} fill={`url(#${idp}-hatch)`} stroke="#666" strokeWidth={0.75} />}
                <text x={x + 2 * r + 8} y={cy + fs * 0.35} fontSize={fs}>{k === 'hatch' ? f.name : fmt(v)}</text>
              </g>
            )
          })}
        </g>
      ),
    })
  }
  return out
}

// ---------- figure ----------
export interface FigureProps {
  doc: Doc
  plate: Plate
  selection?: Set<string>
  hover?: string | null
  zoom?: number
  marquee?: { r0: number; c0: number; r1: number; c1: number } | null
  exporting?: boolean
}

export function PlateFigure({ doc, plate, selection, hover, zoom = 1, marquee, exporting }: FigureProps) {
  const st = doc.style
  const G = geometry(doc, plate)
  const R = makeResolver(doc)
  const { size: s, pitch, pad, plateX, plateY, hdr } = G
  const idp = 'pm' + plate.id
  const fs = st.fontSize
  const hfs = Math.min(fs, pitch * 0.62)
  const lh = fs * 1.55
  const cx = (c: number) => plateX + pad + c * pitch + s / 2
  const cy = (r: number) => plateY + pad + r * pitch + s / 2
  const pw = plate.cols * pitch - st.gap + 2 * pad, ph = plate.rows * pitch - st.gap + 2 * pad
  const shape = (x: number, y: number, inset: number, props: Record<string, unknown>) =>
    st.wellShape === 'circle'
      ? <circle cx={x} cy={y} r={s / 2 - inset} {...props} />
      : <rect x={x - s / 2 + inset} y={y - s / 2 + inset} width={s - 2 * inset} height={s - 2 * inset} rx={s * 0.12} {...props} />

  const wells: ReactNode[] = []
  for (let r = 0; r < plate.rows; r++) for (let c = 0; c < plate.cols; c++) {
    const id = wellId(r, c), x = cx(c), y = cy(r)
    const look = wellLook(doc, R, plate.wells[id])
    const ringW = Math.max(2, s * 0.12)
    const maxChars = Math.max(2, Math.floor((s * 0.95) / (st.labelSize * 0.58)))
    wells.push(
      <g key={id}>
        {shape(x, y, look.ring ? ringW / 2 : 0.5, {
          fill: look.fill,
          stroke: look.ring ?? st.outline,
          strokeWidth: look.ring ? ringW : 1,
        })}
        {look.hatch && shape(x, y, look.ring ? ringW : 0.5, { fill: `url(#${idp}-hatch)` })}
        {look.bar !== undefined && (
          <g>
            <rect x={x - s * 0.3} y={y + s * 0.2} width={s * 0.6} height={Math.max(2, s * 0.09)} fill="#ffffffaa" />
            <rect x={x - s * 0.3} y={y + s * 0.2} width={s * 0.6 * look.bar} height={Math.max(2, s * 0.09)} fill={textOn(look.fill) === '#ffffff' ? '#ffffff' : '#222222'} />
          </g>
        )}
        {look.label && (
          <text x={x} y={y + st.labelSize * 0.35} fontSize={st.labelSize} textAnchor="middle" fill={textOn(look.fill)}>
            {look.label.length > maxChars ? look.label.slice(0, maxChars - 1) + '…' : look.label}
          </text>
        )}
        {look.dot && <circle cx={x + s * 0.32} cy={y - s * 0.32} r={Math.max(2.5, s * 0.15)} fill={look.dot} stroke="#ffffff" strokeWidth={Math.max(0.75, s * 0.03)} />}
        {!exporting && selection?.has(id) && (
          st.wellShape === 'circle'
            ? <circle cx={x} cy={y} r={s / 2 + 2.5} fill="#3d8bfd22" stroke="#3d8bfd" strokeWidth={2.5} />
            : <rect x={x - s / 2 - 2.5} y={y - s / 2 - 2.5} width={s + 5} height={s + 5} rx={s * 0.15} fill="#3d8bfd22" stroke="#3d8bfd" strokeWidth={2.5} />
        )}
        {!exporting && hover === id && shape(x, y, -1.5, { fill: 'none', stroke: '#3d8bfd', strokeWidth: 1.5, strokeDasharray: '3 2' })}
      </g>,
    )
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={G.width * zoom}
      height={G.height * zoom}
      viewBox={`0 0 ${G.width} ${G.height}`}
      fontFamily={st.font}
      style={{ display: 'block' }}
    >
      <defs>
        <pattern id={`${idp}-hatch`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={6} stroke="#00000099" strokeWidth={1.6} />
        </pattern>
      </defs>
      {!st.transparent && <rect width={G.width} height={G.height} fill={st.background} />}
      {st.showTitle && <text x={plateX - hdr} y={16 + fs * 1.3} fontSize={fs * 1.3} fontWeight={700} fill="#1a1a1a">{plate.name}</text>}
      <rect x={plateX} y={plateY} width={pw} height={ph} rx={Math.min(14, pad)} fill={st.plateColor} stroke={st.outline} strokeWidth={1.2} />
      {st.showHeaders && (
        <g fontSize={hfs} fill="#444" fontWeight={600}>
          {Array.from({ length: plate.cols }, (_, c) => (
            <text key={'c' + c} x={cx(c)} y={plateY - hdr * 0.35} textAnchor="middle">{c + 1}</text>
          ))}
          {Array.from({ length: plate.rows }, (_, r) => (
            <text key={'r' + r} x={plateX - hdr * 0.5} y={cy(r) + hfs * 0.35} textAnchor="middle">{rowLabel(r)}</text>
          ))}
        </g>
      )}
      {wells}
      {marquee && !exporting && (
        <rect
          x={cx(Math.min(marquee.c0, marquee.c1)) - pitch / 2}
          y={cy(Math.min(marquee.r0, marquee.r1)) - pitch / 2}
          width={(Math.abs(marquee.c1 - marquee.c0) + 1) * pitch}
          height={(Math.abs(marquee.r1 - marquee.r0) + 1) * pitch}
          fill="#3d8bfd18" stroke="#3d8bfd" strokeDasharray="5 3" strokeWidth={1.5}
        />
      )}
      {G.legend.length > 0 && (
        <g fill="#1a1a1a">
          {(() => {
            let x = G.lx, y = G.ly
            return G.legend.map((sec, i) => {
              const node = (
                <g key={i}>
                  <text x={x} y={y + fs} fontSize={fs} fontWeight={700}>{sec.title}</text>
                  {sec.render(x, y + lh * 1.3, fs, lh, idp)}
                </g>
              )
              if (st.legendPos === 'right') y += lh * (1.3 + sec.rows) + 10
              else x += Math.max(textW(sec.title, fs, true), sec.width(fs)) + 36
              return node
            })
          })()}
        </g>
      )}
    </svg>
  )
}
