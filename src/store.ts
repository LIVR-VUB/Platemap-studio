// App state: immutable document + undo history (every edit is a named snapshot), plus UI state.
import { produce, type Draft } from 'immer'
import { useSyncExternalStore } from 'react'
import {
  type Doc, type Field, type FieldType, type LayerKind, type Layer, type Plate, type Role, type Style, type Value, type PlatemapSettings,
  defaultDoc, nextColor, parseWell, wellId, allWells, rng, shuffle, hasData, FORMATS, PALETTES, unitKey, normUnit, parseNumUnit,
} from './model'
import { applyTemplate, platemapSettings } from './platemap'

export type Tool = 'select' | 'brush' | 'erase'
export type DialogName =
  | 'start' | 'newPlate' | 'plateSettings' | 'field' | 'dilution' | 'controls' | 'randomize' | 'replicate' | 'compress' | 'export' | 'platemap' | 'about'
  | null

export interface UI {
  plateId: string
  selection: Set<string>
  tool: Tool
  brush: { fieldId: string; value: Value } | null
  zoom: number
  dialog: DialogName
  dialogArg?: string
  hover: string | null
  rightTab: 'inspector' | 'layers' | 'style' | 'history' | 'checks'
  filePath: string | null
  savedDoc: Doc | null
  clipboard: { r: number; c: number; data: Record<string, Value> }[] | null
}

interface State {
  doc: Doc
  history: { label: string; doc: Doc; time: number }[]
  index: number
  ui: UI
}

const AUTOSAVE = 'platemap.autosave.v1'
export let hasRestoredSession = false

function initial(): State {
  let doc = defaultDoc()
  try {
    const s = localStorage.getItem(AUTOSAVE)
    if (s) { doc = JSON.parse(s); hasRestoredSession = true }
  } catch { /* corrupt or unavailable autosave: start fresh */ }
  return {
    doc,
    history: [{ label: 'Open', doc, time: Date.now() }],
    index: 0,
    ui: {
      plateId: doc.plates[0].id, selection: new Set(), tool: 'select', brush: null, zoom: 1, dialog: 'start',
      hover: null, rightTab: 'inspector', filePath: null, savedDoc: doc, clipboard: null,
    },
  }
}

let state = initial()
const listeners = new Set<() => void>()
let saveTimer: number | undefined

function set(next: State) {
  const docChanged = next.doc !== state.doc
  state = next
  listeners.forEach((l) => l())
  if (docChanged) {
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      try { localStorage.setItem(AUTOSAVE, JSON.stringify(state.doc)) } catch { /* quota: ignore */ }
    }, 400)
  }
}

export const getState = () => state
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => sel(state))
}

export function setUI(patch: Partial<UI>) {
  set({ ...state, ui: { ...state.ui, ...patch } })
}

// ---------- history ----------
const MAX_HISTORY = 300

export function commit(label: string, recipe: (d: Draft<Doc>) => void) {
  const doc = produce(state.doc, recipe)
  if (doc === state.doc) return
  let history = state.history.slice(0, state.index + 1).concat({ label, doc, time: Date.now() })
  if (history.length > MAX_HISTORY) history = history.slice(history.length - MAX_HISTORY)
  set({ ...state, doc, history, index: history.length - 1, ui: fixUI(doc, state.ui) })
}

function fixUI(doc: Doc, ui: UI): UI {
  if (doc.plates.some((p) => p.id === ui.plateId)) return ui
  return { ...ui, plateId: doc.plates[0].id, selection: new Set() }
}

export function jumpTo(i: number) {
  if (i < 0 || i >= state.history.length) return
  const doc = state.history[i].doc
  set({ ...state, doc, index: i, ui: fixUI(doc, state.ui) })
}
export const undo = () => jumpTo(state.index - 1)
export const redo = () => jumpTo(state.index + 1)

export function loadDoc(doc: Doc, filePath: string | null, label = 'Open') {
  set({
    doc,
    history: [{ label, doc, time: Date.now() }],
    index: 0,
    ui: { ...state.ui, plateId: doc.plates[0].id, selection: new Set(), filePath, savedDoc: doc, brush: null },
  })
}

// ---------- helpers ----------
const uid = (d: Draft<Doc>, prefix: string) => `${prefix}${++d.seq}`
export const curPlate = (s: State = state) => s.doc.plates.find((p) => p.id === s.ui.plateId) ?? s.doc.plates[0]
const draftPlate = (d: Draft<Doc>, id = state.ui.plateId) => d.plates.find((p) => p.id === id)!
const field = (d: Draft<Doc>, id: string) => d.fields.find((f) => f.id === id)!

function ensureColor(d: Draft<Doc>, f: Draft<Field>, v: Value) {
  if (f.type === 'category' && typeof v === 'string' && v && !f.colors[v]) f.colors[v] = nextColor(f as Field, d.fields as Field[])
}

function setWell(p: Draft<Plate>, id: string, fieldId: string, v: Value | undefined) {
  if (v === undefined || v === '') {
    if (p.wells[id]) {
      delete p.wells[id][fieldId]
      delete p.wells[id][unitKey(fieldId)]
      if (!Object.keys(p.wells[id]).length) delete p.wells[id]
    }
  } else (p.wells[id] ??= {})[fieldId] = v
}

export function coerce(f: Pick<Field, 'type'>, raw: string): Value | undefined {
  const s = raw.trim()
  if (s === '') return undefined
  if (f.type === 'number') return parseNumUnit(s)?.n
  if (f.type === 'bool') return /^(1|true|yes|y|x)$/i.test(s)
  return s
}

const selList = () => [...state.ui.selection]

// ---------- well edits ----------
/** unit: per-well unit for number fields (undefined = keep, null/field unit = use the field's unit). */
export function setValues(wells: string[], fieldId: string, v: Value | undefined, label?: string, unit?: string | null) {
  if (!wells.length) return
  const f = state.doc.fields.find((x) => x.id === fieldId)!
  const shown = v === undefined ? '' : ' = ' + String(v) + (unit ? unit : '')
  commit(label ?? `${v === undefined ? 'Clear' : 'Set'} ${f.name}${shown} (${wells.length} wells)`, (d) => {
    const p = draftPlate(d)
    const old = oldValues(p, wells, fieldId)
    if (v !== undefined) ensureColor(d, field(d, fieldId), v)
    wells.forEach((w) => setWell(p, w, fieldId, v))
    if (f.type === 'number' && v !== undefined && unit !== undefined) {
      const own = unit && normUnit(unit) !== normUnit(f.unit) ? unit : null
      wells.forEach((w) => { if (own) p.wells[w][unitKey(fieldId)] = own; else delete p.wells[w][unitKey(fieldId)] })
    }
    learnDerived(d, p, wells, fieldId)
    applyDerived(d, p, wells, fieldId, old)
  })
}

const oldValues = (p: Draft<Plate>, wells: string[], fieldId: string) => Object.fromEntries(wells.map((w) => [w, p.wells[w]?.[fieldId]]))

// ---------- derived fields (e.g. vehicle / compound class follow the treatment) ----------
/** Setting a derived field teaches the mapping: source value -> this value. */
function learnDerived(d: Draft<Doc>, p: Draft<Plate>, wells: string[], fieldId: string) {
  const f = field(d, fieldId)
  if (!f.derive) return
  for (const w of wells) {
    const s = p.wells[w]?.[f.derive.from], v = p.wells[w]?.[fieldId]
    if (typeof s === 'string' && v !== undefined) f.derive.map[s] = v
  }
}
/**
 * Setting a source field fills every field derived from it, where a mapping is known.
 * If the new source value has no mapping (or was cleared), a value that was auto-filled from the
 * old source value is removed so it can't go stale; hand-entered values are kept.
 */
function applyDerived(d: Draft<Doc>, p: Draft<Plate>, wells: string[], sourceId: string, old: Record<string, Value | undefined> = {}) {
  for (const f of d.fields) {
    if (f.derive?.from !== sourceId) continue
    for (const w of wells) {
      const s = p.wells[w]?.[sourceId]
      const v = typeof s === 'string' ? f.derive.map[s] : undefined
      if (v !== undefined) { ensureColor(d, f, v); setWell(p, w, f.id, v); continue }
      const o = old[w]
      if (typeof o === 'string' && o !== s && f.derive.map[o] !== undefined && p.wells[w]?.[f.id] === f.derive.map[o]) setWell(p, w, f.id, undefined)
    }
  }
}
export const learnAllDerived = (d: Draft<Doc>) => d.fields.forEach((f) => learnAll(d, f))
/** Learn mappings from wells where the pair is consistent (used after import / when enabling auto-fill). */
function learnAll(d: Draft<Doc>, f: Draft<Field>) {
  if (!f.derive) return
  const seen = new Map<string, Value | null>()
  for (const p of d.plates) for (const w of Object.values(p.wells)) {
    const s = w[f.derive.from], v = w[f.id]
    if (typeof s !== 'string' || v === undefined) continue
    seen.set(s, seen.has(s) && seen.get(s) !== v ? null : v)
  }
  for (const [s, v] of seen) if (v !== null && f.derive.map[s] === undefined) f.derive.map[s] = v
}

// ---------- platemap export settings ----------
export const setPlatemap = (patch: Partial<PlatemapSettings>) =>
  coalesced('Platemap export settings', (d) => { d.platemap = { ...platemapSettings(d as Doc), ...patch } })

const TEMPLATE_KEY = 'platemap.template'
/** Header list remembered as the default column layout for new projects. */
export function rememberTemplate(headers: string[]) {
  try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(headers)) } catch { /* ignore */ }
}
export function loadTemplate(headers: string[]) {
  commit(`Platemap columns from template (${headers.length})`, (d) => applyTemplate(d as Doc, headers))
  rememberTemplate(headers)
}
const savedTemplate = (): string[] | null => {
  try { return JSON.parse(localStorage.getItem(TEMPLATE_KEY) ?? 'null') } catch { return null }
}

export function clearWells(wells: string[] = selList()) {
  if (!wells.length) return
  commit(`Clear ${wells.length} wells`, (d) => {
    const p = draftPlate(d)
    wells.forEach((w) => delete p.wells[w])
  })
}

export function copySelection() {
  const p = curPlate()
  const cells = selList().map((w) => { const [r, c] = parseWell(w)!; return { r, c, data: { ...(p.wells[w] ?? {}) } } })
  if (!cells.length) return
  const r0 = Math.min(...cells.map((x) => x.r)), c0 = Math.min(...cells.map((x) => x.c))
  setUI({ clipboard: cells.map((x) => ({ r: x.r - r0, c: x.c - c0, data: x.data })) })
}

export function paste() {
  const clip = state.ui.clipboard
  const sel = selList().map((w) => parseWell(w)!)
  if (!clip || !sel.length) return
  const r0 = Math.min(...sel.map((x) => x[0])), c0 = Math.min(...sel.map((x) => x[1]))
  commit(`Paste ${clip.length} wells at ${wellId(r0, c0)}`, (d) => {
    const p = draftPlate(d)
    for (const x of clip) {
      const r = r0 + x.r, c = c0 + x.c
      if (r >= p.rows || c >= p.cols) continue
      const id = wellId(r, c)
      if (Object.keys(x.data).length) p.wells[id] = { ...x.data }
      else delete p.wells[id]
    }
  })
}

// ---------- selection helpers ----------
export function select(wells: Iterable<string>, mode: 'replace' | 'add' | 'toggle' = 'replace') {
  const s = mode === 'replace' ? new Set<string>() : new Set(state.ui.selection)
  for (const w of wells) mode === 'toggle' && s.has(w) ? s.delete(w) : s.add(w)
  setUI({ selection: s })
}
export const selectWhere = (pred: (id: string) => boolean, mode: 'replace' | 'add' = 'replace') =>
  select(allWells(curPlate()).filter(pred), mode)
export const selectByValue = (fieldId: string, v: Value) => selectWhere((w) => curPlate().wells[w]?.[fieldId] === v)

// ---------- plates ----------
export function addPlate(format: string, name: string, rowsCols?: [number, number]) {
  const [rows, cols] = rowsCols ?? FORMATS[format]
  let newId = ''
  commit(`New plate "${name}"`, (d) => {
    newId = uid(d, 'p')
    d.plates.push({ id: newId, name, rows, cols, wells: {} })
  })
  setUI({ plateId: newId, selection: new Set() })
}

export function updatePlate(id: string, patch: { name?: string; rows?: number; cols?: number; barcode?: string }) {
  commit(patch.rows ? `Resize plate to ${patch.rows}×${patch.cols}` : patch.name ? `Rename plate to "${patch.name}"` : 'Set plate barcode', (d) => {
    const p = draftPlate(d, id)
    Object.assign(p, patch)
    for (const w of Object.keys(p.wells)) {
      const [r, c] = parseWell(w)!
      if (r >= p.rows || c >= p.cols) delete p.wells[w]
    }
  })
}

export function duplicatePlate(id: string, copies = 1, randomizeSeed: number | null = null, keepControls = true) {
  const src = state.doc.plates.find((p) => p.id === id)!
  const ctrl = state.doc.fields.find((f) => f.role === 'control')
  let last = ''
  commit(`Duplicate "${src.name}" ×${copies}${randomizeSeed !== null ? ' (randomized)' : ''}`, (d) => {
    for (let i = 1; i <= copies; i++) {
      const p: Plate = { id: uid(d, 'p'), name: `${src.name}_rep${i + 1}`, rows: src.rows, cols: src.cols, wells: structuredClone(src.wells) }
      if (randomizeSeed !== null) {
        const ids = Object.keys(p.wells).filter((w) => !(keepControls && ctrl && p.wells[w][ctrl.id] !== undefined))
        const data = shuffle(ids.map((w) => p.wells[w]), rng(randomizeSeed + i))
        ids.forEach((w, k) => (p.wells[w] = data[k]))
      }
      d.plates.push(p)
      last = p.id
    }
  })
  setUI({ plateId: last, selection: new Set() })
}

export function deletePlate(id: string) {
  if (state.doc.plates.length < 2) return
  const p = state.doc.plates.find((x) => x.id === id)!
  commit(`Delete plate "${p.name}"`, (d) => { d.plates = d.plates.filter((x) => x.id !== id) })
}

export function movePlate(id: string, dir: -1 | 1) {
  commit('Reorder plates', (d) => {
    const i = d.plates.findIndex((p) => p.id === id), j = i + dir
    if (j < 0 || j >= d.plates.length) return
    ;[d.plates[i], d.plates[j]] = [d.plates[j], d.plates[i]]
  })
}

// ---------- fields ----------
export function addField(name: string, type: FieldType, role: Role, unit?: string) {
  let id = ''
  commit(`Add field "${name}"`, (d) => {
    id = uid(d, 'f')
    d.fields.push({ id, name, type, role, unit: unit || undefined, colors: {} })
  })
  return id
}

export function updateField(id: string, patch: Partial<Pick<Field, 'name' | 'unit' | 'role' | 'type' | 'exportName' | 'derive'>>, applyNow = true) {
  commit(`Edit field "${patch.name ?? state.doc.fields.find((f) => f.id === id)?.name}"`, (d) => {
    const f = field(d, id)
    const typeChanged = patch.type && patch.type !== f.type
    Object.assign(f, patch)
    if (!f.derive) delete f.derive
    if (typeChanged) for (const p of d.plates) for (const w of Object.values(p.wells)) {
      if (f.type !== 'number') delete w[unitKey(id)]
      if (w[id] === undefined) continue
      const v = coerce(f as Field, String(w[id]))
      if (v === undefined) delete w[id]
      else { w[id] = v; ensureColor(d, f, v) }
    }
    if (patch.derive && applyNow) {
      learnAll(d, f)
      for (const p of d.plates) applyDerived(d, p, Object.keys(p.wells), patch.derive.from)
    }
  })
}

export function deleteField(id: string) {
  const f = state.doc.fields.find((x) => x.id === id)!
  commit(`Delete field "${f.name}"`, (d) => {
    d.fields = d.fields.filter((x) => x.id !== id)
    for (const f of d.fields) if (f.derive?.from === id) delete f.derive
    for (const p of d.plates) for (const [w, data] of Object.entries(p.wells)) {
      delete data[id]
      delete data[unitKey(id)]
      if (!Object.keys(data).length) delete p.wells[w]
    }
    for (const l of Object.values(d.layers)) if (l.fieldId === id) { l.fieldId = null; l.visible = false }
  })
}

export function moveField(id: string, dir: -1 | 1) {
  commit('Reorder fields', (d) => {
    const i = d.fields.findIndex((f) => f.id === id), j = i + dir
    if (j < 0 || j >= d.fields.length) return
    ;[d.fields[i], d.fields[j]] = [d.fields[j], d.fields[i]]
  })
}

export function renameValue(fieldId: string, from: Value, to: string) {
  const f = state.doc.fields.find((x) => x.id === fieldId)!
  const v = coerce(f, to)
  if (v === undefined || v === from) return
  commit(`Rename ${f.name} "${from}" → "${v}"`, (d) => {
    const df = field(d, fieldId)
    for (const p of d.plates) for (const w of Object.values(p.wells)) if (w[fieldId] === from) w[fieldId] = v
    if (typeof from === 'string' && df.colors[from]) {
      if (typeof v === 'string' && !df.colors[v]) df.colors[v] = df.colors[from]
      delete df.colors[from]
    }
  })
}

// Live color edits (dragging the picker) replace the last entry instead of flooding history.
let lastColorKey = ''
export function setValueColor(fieldId: string, value: string, color: string) {
  const key = fieldId + '\u0000' + value
  const top = state.history[state.index]
  if (key === lastColorKey && top.label.startsWith('Color ') && state.index === state.history.length - 1 && state.index > 0) {
    const doc = produce(state.doc, (d) => { field(d, fieldId).colors[value] = color })
    const history = state.history.slice()
    history[state.index] = { ...top, doc }
    set({ ...state, doc, history })
    return
  }
  lastColorKey = key
  commit(`Color ${value}`, (d) => { field(d, fieldId).colors[value] = color })
}
export const endColorEdit = () => { lastColorKey = '' }

export function applyPalette(fieldId: string, palette: string) {
  commit(`Apply ${palette} palette`, (d) => {
    const f = field(d, fieldId)
    const vals = usedValues(state.doc, fieldId).map(String)
    const keys = [...new Set([...vals, ...Object.keys(f.colors)])]
    keys.forEach((k, i) => (f.colors[k] = PALETTES[palette][i % PALETTES[palette].length]))
  })
}

export function usedValues(doc: Doc, fieldId: string, plate?: Plate): Value[] {
  const s = new Set<Value>()
  for (const p of plate ? [plate] : doc.plates) for (const w of Object.values(p.wells)) if (w[fieldId] !== undefined) s.add(w[fieldId])
  const arr = [...s]
  return arr.every((x) => typeof x === 'number') ? (arr as number[]).sort((a, b) => a - b) : arr.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
}

// ---------- display ----------
let lastStyleKey = ''
export function setLayer(kind: LayerKind, patch: Partial<Layer>) {
  coalesced(`Layer ${kind}`, (d) => { Object.assign(d.layers[kind], patch) })
}
export function setStyle(patch: Partial<Style>) {
  coalesced(`Style ${Object.keys(patch).join(', ')}`, (d) => { Object.assign(d.style, patch) })
}
// Repeated edits of the same property (slider drags) merge into one history step.
export function coalesced(label: string, recipe: (d: Draft<Doc>) => void) {
  const top = state.history[state.index]
  if (label === lastStyleKey && top.label === label && state.index === state.history.length - 1 && state.index > 0) {
    const doc = produce(state.doc, recipe)
    const history = state.history.slice()
    history[state.index] = { ...top, doc, time: Date.now() }
    set({ ...state, doc, history })
    return
  }
  lastStyleKey = label
  commit(label, recipe)
}
export const breakCoalesce = () => { lastStyleKey = '' }

// ---------- screening tools ----------

/** Fill selection with a serial dilution; each row (or column) of the selection is one replicate series. */
export function serialDilution(o: {
  fieldId: string; start: number; factor: number; direction: 'row' | 'col'; descending: boolean
  treatment?: { fieldId: string; value: string }; zeroLast: boolean; unit?: string
}) {
  const groups = new Map<number, [number, number][]>()
  for (const w of state.ui.selection) {
    const [r, c] = parseWell(w)!
    const k = o.direction === 'row' ? r : c
    groups.set(k, [...(groups.get(k) ?? []), [r, c]])
  }
  if (!groups.size) return
  commit(`Serial dilution 1:${o.factor} from ${o.start} (${groups.size} series)`, (d) => {
    const p = draftPlate(d)
    const old = o.treatment ? oldValues(p, [...state.ui.selection], o.treatment.fieldId) : {}
    if (o.treatment) ensureColor(d, field(d, o.treatment.fieldId), o.treatment.value)
    for (const g of groups.values()) {
      g.sort((a, b) => (o.direction === 'row' ? a[1] - b[1] : a[0] - b[0]))
      if (!o.descending) g.reverse()
      const n = o.zeroLast ? g.length - 1 : g.length
      g.forEach(([r, c], i) => {
        const id = wellId(r, c)
        setWell(p, id, o.fieldId, i < n ? Number((o.start / Math.pow(o.factor, i)).toPrecision(6)) : 0)
        if (o.unit && normUnit(o.unit) !== normUnit(field(d, o.fieldId).unit)) p.wells[id][unitKey(o.fieldId)] = o.unit
        else delete p.wells[id][unitKey(o.fieldId)]
        if (o.treatment) setWell(p, id, o.treatment.fieldId, o.treatment.value)
      })
      if (o.treatment) applyDerived(d, p, g.map(([r, c]) => wellId(r, c)), o.treatment.fieldId, old)
    }
  })
}

/** Place controls across candidate wells, balancing row/column counts and maximizing spacing. */
export function distributeControls(o: {
  fieldId: string; entries: { value: string; count: number }[]; region: 'selection' | 'empty' | 'inner-empty'
  mode: 'spread' | 'random'; seed: number
}) {
  const p = curPlate()
  let cand = o.region === 'selection' ? selList() : allWells(p).filter((w) => !hasData(p.wells[w]))
  if (o.region === 'inner-empty') cand = cand.filter((w) => { const [r, c] = parseWell(w)!; return r > 0 && c > 0 && r < p.rows - 1 && c < p.cols - 1 })
  const queue: string[] = []
  const left = o.entries.map((e) => ({ ...e }))
  while (left.some((e) => e.count > 0)) for (const e of left) if (e.count > 0) { queue.push(e.value); e.count-- }
  if (queue.length > cand.length) throw new Error(`Need ${queue.length} wells but only ${cand.length} candidates available.`)

  const placed: { r: number; c: number; v: string }[] = []
  const rand = rng(o.seed)
  let pool = shuffle(cand, rand).map((w) => ({ w, rc: parseWell(w)! }))
  const rowN = new Map<number, number>(), colN = new Map<number, number>()
  for (const v of queue) {
    let best = 0
    if (o.mode === 'spread') {
      let bestScore = -Infinity
      pool.forEach(({ rc: [r, c] }, i) => {
        const load = (rowN.get(r) ?? 0) + (colN.get(c) ?? 0)
        let dSame = 99, dAny = 99
        for (const q of placed) {
          const dist = Math.hypot(q.r - r, q.c - c)
          dAny = Math.min(dAny, dist)
          if (q.v === v) dSame = Math.min(dSame, dist)
        }
        const score = -load * 100 + Math.min(dSame, 20) * 2 + Math.min(dAny, 20)
        if (score > bestScore) { bestScore = score; best = i }
      })
    }
    const { rc: [r, c] } = pool[best]
    pool = pool.filter((_, i) => i !== best)
    placed.push({ r, c, v })
    rowN.set(r, (rowN.get(r) ?? 0) + 1); colN.set(c, (colN.get(c) ?? 0) + 1)
  }
  commit(`Distribute ${queue.length} controls (${o.mode})`, (d) => {
    const dp = draftPlate(d)
    const f = field(d, o.fieldId)
    const old = oldValues(dp, placed.map((x) => wellId(x.r, x.c)), o.fieldId)
    for (const x of placed) { ensureColor(d, f, x.v); setWell(dp, wellId(x.r, x.c), o.fieldId, x.v) }
    applyDerived(d, dp, placed.map((x) => wellId(x.r, x.c)), o.fieldId, old)
  })
  select(placed.map((x) => wellId(x.r, x.c)))
}

/** Shuffle well contents among selected wells (seeded, reproducible). */
export function randomizeSelection(seed: number, keepControls: boolean, fieldIds: string[] | null) {
  // Auto-filled fields (vehicle, class…) travel with their source field.
  if (fieldIds) fieldIds = [...fieldIds, ...state.doc.fields.filter((f) => f.derive && fieldIds!.includes(f.derive.from)).map((f) => f.id)]
  const p = curPlate()
  const ctrl = state.doc.fields.find((f) => f.role === 'control')
  const ids = selList().filter((w) => !(keepControls && ctrl && p.wells[w]?.[ctrl.id] !== undefined))
  if (ids.length < 2) return
  const pick = (w: string) => {
    const src = p.wells[w] ?? {}
    if (!fieldIds) return { ...src }
    return Object.fromEntries(Object.entries(src).filter(([k]) => fieldIds.includes(k.split('@')[0])))
  }
  const data = shuffle(ids.map(pick), rng(seed))
  commit(`Randomize ${ids.length} wells (seed ${seed})`, (d) => {
    const dp = draftPlate(d)
    ids.forEach((w, i) => {
      const keep = fieldIds ? Object.fromEntries(Object.entries(dp.wells[w] ?? {}).filter(([k]) => !fieldIds.includes(k.split('@')[0]))) : {}
      const merged = { ...keep, ...data[i] }
      if (Object.keys(merged).length) dp.wells[w] = merged
      else delete dp.wells[w]
    })
  })
}

/** Standard quadrant interleave: Q1→A1, Q2→A2, Q3→B1, Q4→B2 of each 2×2 block. */
export function compressTo384(sourceIds: (string | null)[], name: string, track: boolean) {
  commit(`Combine 4×96 → 384 "${name}"`, (d) => {
    let srcPlate = d.fields.find((f) => f.name === 'Source plate')
    let srcWell = d.fields.find((f) => f.name === 'Source well')
    if (track && !srcPlate) d.fields.push((srcPlate = { id: uid(d, 'f'), name: 'Source plate', type: 'category', role: 'other', colors: {} }))
    if (track && !srcWell) d.fields.push((srcWell = { id: uid(d, 'f'), name: 'Source well', type: 'text', role: 'other', colors: {} }))
    const out: Plate = { id: uid(d, 'p'), name, rows: 16, cols: 24, wells: {} }
    sourceIds.forEach((sid, q) => {
      const src = d.plates.find((p) => p.id === sid)
      if (!src) return
      if (track) ensureColor(d, srcPlate!, src.name)
      for (let r = 0; r < Math.min(8, src.rows); r++) for (let c = 0; c < Math.min(12, src.cols); c++) {
        const data = { ...(src.wells[wellId(r, c)] ?? {}) }
        if (track) { data[srcPlate!.id] = src.name; data[srcWell!.id] = wellId(r, c) }
        if (Object.keys(data).length) out.wells[wellId(2 * r + (q >> 1), 2 * c + (q & 1))] = data
      }
    })
    d.plates.push(out)
  })
  setUI({ plateId: state.doc.plates[state.doc.plates.length - 1].id, selection: new Set() })
}

export function newProject(name?: string, rows = 8, cols = 12) {
  const doc = produce(defaultDoc(), (d) => {
    if (name) d.name = name
    Object.assign(d.plates[0], { rows, cols })
    // Labels/text scale down so dense plates stay legible.
    if (rows * cols > 96) Object.assign(d.style, { wellSize: rows * cols > 384 ? 14 : 22, gap: rows * cols > 384 ? 2 : 4, labelSize: 6 })
    if (rows * cols < 96) d.style.wellSize = 64
    const t = savedTemplate()
    if (t) applyTemplate(d as Doc, t)
  })
  loadDoc(doc, null, 'New project')
}
