// Core document model: plates, user-defined fields, visual layers, figure style.

export type FieldType = 'category' | 'number' | 'text' | 'bool'
export type Role = 'treatment' | 'dose' | 'control' | 'cell' | 'density' | 'time' | 'replicate' | 'other'
export type Value = string | number | boolean
export type WellData = Record<string, Value> // fieldId -> value

export interface Field {
  id: string
  name: string
  type: FieldType
  unit?: string
  role: Role
  colors: Record<string, string> // category value -> hex
  exportName?: string // column header in platemap export
  derive?: { from: string; map: Record<string, Value> } // auto-fill from another field's value (e.g. vehicle from treatment)
}

export interface Plate {
  id: string
  name: string
  rows: number
  cols: number
  wells: Record<string, WellData> // "A1" -> data; per-well unit override stored under unitKey(fieldId)
  barcode?: string // Assay_Plate_Barcode for barcode_platemap.csv
}

export interface PlatemapColumn { key: string; header: string; on: boolean } // key: field id or special "#row" etc.
export interface PlatemapSettings {
  columns: PlatemapColumn[]
  onlyFilled: boolean
  inlineUnits: boolean
  delimiter: ',' | '\t'
  fileName: string // pattern, {plate} = plate name
  layout: 'perPlate' | 'combined'
  barcodeFile: boolean
}
export const SPECIAL_COLS: Record<string, string> = {
  '#row': 'WellRow', '#col': 'WellCol', '#pos': 'well_position', '#well': 'well', '#plate': 'plate_map_name', '#barcode': 'Assay_Plate_Barcode',
}

export type LayerKind = 'fill' | 'shade' | 'ring' | 'dot' | 'bar' | 'label' | 'hatch'
export interface Layer {
  fieldId: string | null
  visible: boolean
  scale: 'linear' | 'log'
  ramp: string[] // numeric color ramp, >= 2 stops
}

export interface Style {
  wellShape: 'circle' | 'square'
  wellSize: number
  gap: number
  showHeaders: boolean
  showTitle: boolean
  showLegend: boolean
  legendPos: 'right' | 'bottom'
  font: string
  fontSize: number
  labelSize: number
  background: string
  plateColor: string
  emptyColor: string
  outline: string
  transparent: boolean
}

export interface Doc {
  version: 1
  name: string
  plates: Plate[]
  fields: Field[]
  layers: Record<LayerKind, Layer>
  style: Style
  seq: number
  platemap?: PlatemapSettings
}

export const LAYER_KINDS: LayerKind[] = ['fill', 'shade', 'ring', 'dot', 'bar', 'label', 'hatch']
export const LAYER_INFO: Record<LayerKind, string> = {
  fill: 'Fill color',
  shade: 'Fill intensity',
  ring: 'Ring color',
  dot: 'Corner badge',
  bar: 'Bar (length)',
  label: 'Text label',
  hatch: 'Hatching',
}

export const FORMATS: Record<string, [number, number]> = {
  '6': [2, 3], '12': [3, 4], '24': [4, 6], '48': [6, 8], '96': [8, 12], '384': [16, 24], '1536': [32, 48],
}

export const ROLES: Role[] = ['treatment', 'dose', 'control', 'cell', 'density', 'time', 'replicate', 'other']

// ---------- well ids ----------
export function rowLabel(r: number): string {
  return r < 26 ? String.fromCharCode(65 + r) : String.fromCharCode(64 + Math.floor(r / 26)) + String.fromCharCode(65 + (r % 26))
}
export const wellId = (r: number, c: number) => rowLabel(r) + (c + 1)
export const wellIdPadded = (r: number, c: number, cols: number) =>
  rowLabel(r) + String(c + 1).padStart(cols > 99 ? 3 : 2, '0')

export function parseWell(id: string): [number, number] | null {
  const m = /^\s*([A-Za-z]{1,2})\s*0*(\d+)\s*$/.exec(id)
  if (!m) return null
  const L = m[1].toUpperCase()
  const r = L.length === 1 ? L.charCodeAt(0) - 65 : (L.charCodeAt(0) - 64) * 26 + (L.charCodeAt(1) - 65)
  return [r, parseInt(m[2]) - 1]
}

export function allWells(p: { rows: number; cols: number }): string[] {
  const out: string[] = []
  for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) out.push(wellId(r, c))
  return out
}

export const isEdge = (p: Plate, id: string, depth = 1) => {
  const [r, c] = parseWell(id)!
  return r < depth || c < depth || r >= p.rows - depth || c >= p.cols - depth
}

// ---------- numbers with units ----------
export const unitKey = (fieldId: string) => fieldId + '@unit'
export const normUnit = (u?: string) => (u ?? '').trim().replace(/[µμ]/g, 'u').toLowerCase()
export const wellUnit = (w: WellData | undefined, f: Field) => (w?.[unitKey(f.id)] as string | undefined) ?? f.unit
/** "10ng/ml" -> {n: 10, unit: "ng/ml"}; "0.5 µM" -> {n: 0.5, unit: "µM"}; "abc" -> null */
export function parseNumUnit(s: string): { n: number; unit?: string } | null {
  const m = /^\s*([-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[-+]?\d+)?)\s*(\D.*?)?\s*$/i.exec(s)
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  return isFinite(n) ? { n, unit: m[2] || undefined } : null
}
/** Full-precision number text for data export (no float noise). */
export const numStr = (v: number) => String(Number(v.toPrecision(12)))

export const hasData = (w?: WellData) => !!w && Object.values(w).some((v) => v !== '' && v !== undefined)

// ---------- colors ----------
export const PALETTES: Record<string, string[]> = {
  'Okabe-Ito': ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#999999', '#000000'],
  'Tol Bright': ['#4477AA', '#EE6677', '#228833', '#CCBB44', '#66CCEE', '#AA3377', '#BBBBBB'],
  'Tol Muted': ['#332288', '#88CCEE', '#44AA99', '#117733', '#999933', '#DDCC77', '#CC6677', '#882255', '#AA4499'],
  Tableau: ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC'],
  Pastel: ['#A1C9F4', '#FFB482', '#8DE5A1', '#FF9F9B', '#D0BBFF', '#DEBB9B', '#FAB0E4', '#CFCFCF', '#FFFEA3', '#B9F2F0'],
  Bold: ['#1B9E77', '#D95F02', '#7570B3', '#E7298A', '#66A61E', '#E6AB02', '#A6761D', '#666666'],
  Set3: ['#8DD3C7', '#FFFFB3', '#BEBADA', '#FB8072', '#80B1D3', '#FDB462', '#B3DE69', '#FCCDE5', '#D9D9D9', '#BC80BD', '#CCEBC5', '#FFED6F'],
}

export const RAMPS: Record<string, string[]> = {
  Viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  Magma: ['#000004', '#51127c', '#b73779', '#fc8961', '#fcfdbf'],
  Cividis: ['#00224e', '#575c6d', '#a59c74', '#fee838'],
  Blues: ['#f7fbff', '#9ecae1', '#3182bd', '#08306b'],
  Reds: ['#fff5f0', '#fc9272', '#de2d26', '#67000d'],
  Greys: ['#f5f5f5', '#969696', '#252525'],
  'Blue–Red': ['#2166ac', '#92c5de', '#f7f7f7', '#f4a582', '#b2182b'],
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((x) => x + x).join('')
  const n = parseInt(h.slice(0, 6), 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b)
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [((h * 60) + 360) % 360, max ? d / max : 0, max]
}
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))
  }
  return [f(5), f(3), f(1)]
}

export function mix(a: string, b: string, t: number) {
  const A = hexToRgb(a), B = hexToRgb(b)
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t)
}

export function rampColor(ramp: string[], t: number) {
  t = Math.max(0, Math.min(1, isFinite(t) ? t : 0))
  const x = t * (ramp.length - 1), i = Math.min(Math.floor(x), ramp.length - 2)
  return mix(ramp[i], ramp[i + 1], x - i)
}

export const textOn = (hex: string) => {
  const [r, g, b] = hexToRgb(hex)
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1a1a1a' : '#ffffff'
}

/** Next unused palette color; avoids colors already used by any category field so encodings stay distinct. */
export function nextColor(field: Field, all: Field[] = [], palette = PALETTES['Okabe-Ito'].concat(PALETTES.Tableau)) {
  const used = new Set([field, ...all].flatMap((f) => Object.values(f.colors)).map((c) => c.toLowerCase()))
  return palette.find((c) => !used.has(c.toLowerCase())) ?? palette[Object.keys(field.colors).length % palette.length]
}

// ---------- numbers ----------
export function fmt(v: Value | undefined): string {
  if (v === undefined || v === '') return ''
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(3)))
  return v
}
export const fmtUnit = (v: Value | undefined, f?: Field, w?: WellData) => {
  const s = fmt(v), u = f && wellUnit(w, f)
  return s && u && typeof v === 'number' ? `${s} ${u}` : s
}

/** Min/max of a numeric field across all plates. positive=true skips <= 0 (for log scales: vehicle 0 maps to the low end). */
export function numericRange(doc: Doc, fieldId: string, positive = false): [number, number] {
  let lo = Infinity, hi = -Infinity
  for (const p of doc.plates) for (const w of Object.values(p.wells)) {
    const v = w[fieldId]
    if (typeof v === 'number' && (!positive || v > 0)) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
  }
  return lo === Infinity ? [0, 1] : [lo, hi]
}

export function normalize(v: number, [lo, hi]: [number, number], scale: 'linear' | 'log') {
  if (scale === 'log' && lo > 0) return v <= 0 ? 0 : hi === lo ? 1 : (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))
  return hi === lo ? 1 : (v - lo) / (hi - lo)
}

// Seeded RNG (mulberry32) so randomized layouts are reproducible.
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---------- defaults ----------
export function defaultDoc(): Doc {
  const f = (id: string, name: string, type: FieldType, role: Role, unit?: string, colors: Record<string, string> = {}): Field =>
    ({ id, name, type, role, unit, colors })
  return {
    version: 1,
    name: 'Untitled experiment',
    seq: 100,
    plates: [{ id: 'p1', name: 'Plate 1', rows: 8, cols: 12, wells: {} }],
    // Order + export names follow the pycytominer platemap layout:
    // WellRow, WellCol, well_position, celltype, treatment, concentration, vehicle, compound_class, treatment_group
    fields: [
      { ...f('cell', 'Cell line', 'category', 'cell'), exportName: 'celltype' },
      { ...f('compound', 'Compound', 'category', 'treatment'), exportName: 'treatment' },
      { ...f('conc', 'Concentration', 'number', 'dose', 'µM'), exportName: 'concentration' },
      { ...f('vehicle', 'Vehicle', 'category', 'other'), exportName: 'vehicle', derive: { from: 'compound', map: {} } },
      { ...f('class', 'Compound class', 'text', 'other'), exportName: 'compound_class', derive: { from: 'compound', map: {} } },
      { ...f('group', 'Treatment group', 'category', 'other', undefined, { Control: '#9a9a9a', Treatment: '#0072B2' }), exportName: 'treatment_group', derive: { from: 'compound', map: {} } },
      { ...f('density', 'Seeding density', 'number', 'density', 'cells/well'), exportName: 'seeding_density' },
      { ...f('time', 'Timepoint', 'number', 'time', 'h'), exportName: 'timepoint' },
      { ...f('control', 'Control', 'category', 'control', undefined, {
        Positive: '#D55E00', Negative: '#0072B2', DMSO: '#9a9a9a', Untreated: '#F0E442', Empty: '#000000',
      }), exportName: 'control_type' },
      { ...f('rep', 'Replicate', 'text', 'replicate'), exportName: 'replicate' },
      { ...f('notes', 'Notes', 'text', 'other'), exportName: 'notes' },
    ],
    layers: {
      fill: { fieldId: 'compound', visible: true, scale: 'linear', ramp: RAMPS.Viridis },
      shade: { fieldId: 'conc', visible: true, scale: 'log', ramp: RAMPS.Greys },
      ring: { fieldId: 'cell', visible: true, scale: 'linear', ramp: RAMPS.Viridis },
      dot: { fieldId: 'control', visible: true, scale: 'linear', ramp: RAMPS.Viridis },
      bar: { fieldId: 'density', visible: false, scale: 'linear', ramp: RAMPS.Greys },
      label: { fieldId: 'conc', visible: false, scale: 'linear', ramp: RAMPS.Greys },
      hatch: { fieldId: null, visible: false, scale: 'linear', ramp: RAMPS.Greys },
    },
    style: {
      wellShape: 'circle', wellSize: 40, gap: 6, showHeaders: true, showTitle: true, showLegend: true,
      legendPos: 'right', font: 'Arial, Helvetica, sans-serif', fontSize: 13, labelSize: 9,
      background: '#ffffff', plateColor: '#f3f4f6', emptyColor: '#ffffff', outline: '#9aa0a6', transparent: false,
    },
  }
}
