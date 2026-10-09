// pycytominer-style platemap tables: exact column names/order, per-plate files, barcode_platemap.csv.
import {
  type Doc, type Field, type Plate, type PlatemapSettings, type PlatemapColumn, type WellData, SPECIAL_COLS,
  allWells, parseWell, rowLabel, wellIdPadded, unitKey, numStr, fmt, hasData,
} from './model'

export const defaultHeader = (f: Field) => f.exportName ?? f.name.trim().replace(/\s+/g, '_')

const hasValues = (doc: Doc, id: string) => doc.plates.some((p) => Object.values(p.wells).some((w) => w[id] !== undefined))

/** Saved settings merged with the current fields (deleted fields dropped, new fields appended). */
export function platemapSettings(doc: Doc): PlatemapSettings {
  const saved = doc.platemap
  const ids = new Set(doc.fields.map((f) => f.id))
  const cols: PlatemapColumn[] = saved
    ? saved.columns.filter((c) => c.key.startsWith('#') || ids.has(c.key))
    : ['#row', '#col', '#pos'].map((k) => ({ key: k, header: SPECIAL_COLS[k], on: true }))
  for (const f of doc.fields) if (!cols.some((c) => c.key === f.id)) cols.push({ key: f.id, header: defaultHeader(f), on: hasValues(doc, f.id) })
  return {
    onlyFilled: true, inlineUnits: true, delimiter: ',', fileName: 'platemap_{plate}', layout: 'perPlate', barcodeFile: true,
    ...saved,
    columns: cols,
  }
}

/** One cell's text. Numbers get their (per-well) unit appended compactly: 10ng/ml, 1uM, 0. */
export function cellText(w: WellData | undefined, f: Field, inlineUnits: boolean): string {
  const v = w?.[f.id]
  if (v === undefined) return ''
  if (typeof v !== 'number') return fmt(v)
  const unit = (w?.[unitKey(f.id)] as string | undefined) ?? f.unit
  return inlineUnits && unit && v !== 0 ? numStr(v) + unit.replace(/[µμ]/g, 'u').replace(/\s+/g, '') : numStr(v)
}

export function platemapRows(doc: Doc, plates: Plate[], s: PlatemapSettings = platemapSettings(doc)): string[][] {
  let cols = s.columns.filter((c) => c.on)
  if (s.layout === 'combined' && plates.length > 1 && !cols.some((c) => c.key === '#plate'))
    cols = [{ key: '#plate', header: SPECIAL_COLS['#plate'], on: true }, ...cols]
  const fields = new Map(doc.fields.map((f) => [f.id, f]))
  const out = [cols.map((c) => c.header)]
  for (const p of plates) for (const id of allWells(p)) {
    const w = p.wells[id]
    if (s.onlyFilled && !hasData(w)) continue
    const [r, c] = parseWell(id)!
    out.push(cols.map((col) => {
      switch (col.key) {
        case '#row': return rowLabel(r)
        case '#col': return String(c + 1)
        case '#pos': return wellIdPadded(r, c, p.cols)
        case '#well': return id
        case '#plate': return plateMapName(p, s)
        case '#barcode': return p.barcode || p.name
        default: return cellText(w, fields.get(col.key)!, s.inlineUnits)
      }
    }))
  }
  return out
}

export const plateMapName = (p: Plate, s: PlatemapSettings) => s.fileName.replace('{plate}', p.name).replace(/[^\w.+-]+/g, '_')

export function toDelimited(rows: string[][], delim: string) {
  const q = (v: string) => (v.includes(delim) || /["\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return rows.map((r) => r.map(q).join(delim)).join('\n') + '\n'
}

export function barcodeRows(plates: Plate[], s: PlatemapSettings) {
  return [['Assay_Plate_Barcode', 'Plate_Map_Name'], ...plates.map((p) => [p.barcode || p.name, plateMapName(p, s)])]
}

// ---------- header template ----------
const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_')
const SPECIAL_ALIASES: Record<string, string> = {
  wellrow: '#row', row: '#row', well_row: '#row', wellcol: '#col', col: '#col', column: '#col', well_col: '#col', wellcolumn: '#col',
  well_position: '#pos', wellposition: '#pos', metadata_well: '#pos', well: '#well',
  plate_map_name: '#plate', plate: '#plate', metadata_plate: '#plate', assay_plate_barcode: '#barcode', barcode: '#barcode',
}
const ROLE_ALIASES: Record<string, Field['role']> = {
  celltype: 'cell', cell_type: 'cell', cell_line: 'cell', cellline: 'cell', cells: 'cell',
  treatment: 'treatment', compound: 'treatment', drug: 'treatment', perturbation: 'treatment', pert_iname: 'treatment',
  concentration: 'dose', conc: 'dose', dose: 'dose', mmoles_per_liter: 'dose',
  timepoint: 'time', time: 'time', seeding_density: 'density', density: 'density', replicate: 'replicate',
}

/** Draft-safe: make doc's platemap columns follow `headers` exactly, creating fields for unknown headers. */
export function applyTemplate(d: Doc, headers: string[]) {
  const base = platemapSettings(d)
  const cols: PlatemapColumn[] = matchHeaders(d, headers).map(({ header, key }) => {
    if (!key) {
      key = `f${++d.seq}`
      d.fields.push({ id: key, name: header, type: 'category', role: 'other', colors: {}, exportName: header })
    }
    return { key, header, on: true }
  })
  for (const c of base.columns) if (!cols.some((x) => x.key === c.key)) cols.push({ ...c, on: false })
  d.platemap = { ...base, columns: cols }
}

export type HeaderMatch = { header: string; key: string | null } // key null => new field needed

/** Map each header of a template CSV to a special column or an existing field. */
export function matchHeaders(doc: Doc, headers: string[]): HeaderMatch[] {
  const used = new Set<string>()
  return headers.map((h) => {
    const n = norm(h)
    const special = SPECIAL_ALIASES[n] ?? SPECIAL_ALIASES[n.replace(/_/g, '')]
    if (special) return { header: h, key: special }
    const pick = (f?: Field) => (f && !used.has(f.id) ? (used.add(f.id), f.id) : null)
    const key =
      pick(doc.fields.find((f) => !used.has(f.id) && f.exportName && norm(f.exportName) === n)) ??
      pick(doc.fields.find((f) => !used.has(f.id) && (norm(f.name) === n || norm(defaultHeader(f)) === n))) ??
      (ROLE_ALIASES[n] ? pick(doc.fields.find((f) => !used.has(f.id) && f.role === ROLE_ALIASES[n])) : null)
    return { header: h, key }
  })
}
