// File I/O: project files, figure export (SVG/PNG/PDF), data export (CSV, pycytominer), CSV import.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlateFigure, geometry } from './components/PlateFigure'
import type { Draft } from 'immer'
import {
  type Doc, type Field, type Plate, FORMATS, allWells, parseWell, wellId, nextColor, parseNumUnit, normUnit, unitKey,
} from './model'
import { getState, loadDoc, setUI, commit, coerce, curPlate, learnAllDerived, rememberTemplate } from './store'
import { platemapSettings, platemapRows, plateMapName, toDelimited, barcodeRows, cellText, matchHeaders, applyTemplate } from './platemap'

interface Native {
  minimize(): void; maximize(): void; close(): void
  onMaximized(cb: (v: boolean) => void): void
  saveFile(o: { defaultPath: string; filters: { name: string; extensions: string[] }[]; data: string | { base64: string } }): Promise<string | null>
  openFile(o: { filters: { name: string; extensions: string[] }[] }): Promise<{ path: string; text: string } | null>
  renderPdf(o: { pages: string[]; widthIn: number; heightIn: number }): Promise<string>
  pickDir(): Promise<string | null>
  writeFiles(o: { dir: string; files: { name: string; data: string }[]; overwrite: boolean }): Promise<{ written: string[]; exists: string[] }>
}
export const native = (window as unknown as { native?: Native }).native

const b64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function save(name: string, ext: string, data: string | { base64: string }, label = ext.toUpperCase()) {
  if (native) return native.saveFile({ defaultPath: name, filters: [{ name: label, extensions: [ext] }], data })
  // Browser fallback: download.
  const blob = typeof data === 'string'
    ? new Blob([data])
    : new Blob([Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0))])
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
  return name
}

async function open(exts: string[]): Promise<{ path: string; text: string } | null> {
  if (native) return native.openFile({ filters: [{ name: exts.join('/'), extensions: exts }] })
  return new Promise((res) => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = exts.map((e) => '.' + e).join(',')
    inp.onchange = async () => { const f = inp.files?.[0]; res(f ? { path: f.name, text: await f.text() } : null) }
    inp.click()
  })
}

const safe = (s: string) => s.replace(/[^\w.-]+/g, '_')

// ---------- project ----------
export async function saveProject(as = false) {
  const { doc, ui } = getState()
  const data = JSON.stringify(doc, null, 1)
  let path = ui.filePath
  if (as || !path || !native) path = await save(safe(doc.name) + '.platemap', 'platemap', data, 'PlateMap project')
  else await native.saveFile({ defaultPath: path, filters: [], data }).catch(() => null)
  if (path) setUI({ filePath: path, savedDoc: doc })
}

export async function openProject() {
  const f = await open(['platemap', 'json'])
  if (!f) return
  try {
    const doc = JSON.parse(f.text) as Doc
    if (!doc.plates?.length || !doc.fields || !doc.layers) throw new Error('Not a PlateMap project file.')
    loadDoc(doc, native ? f.path : null)
  } catch (e) {
    alert('Could not open file: ' + (e as Error).message)
  }
}

// ---------- figures ----------
export function figureSVG(doc: Doc, plate: Plate) {
  return renderToStaticMarkup(createElement(PlateFigure, { doc, plate, exporting: true }))
}

export async function svgToPng(svg: string, w: number, h: number, dpi: number): Promise<Uint8Array> {
  const scale = dpi / 96
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await img.decode()
  const cv = document.createElement('canvas')
  cv.width = Math.round(w * scale)
  cv.height = Math.round(h * scale)
  const ctx = cv.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0, w, h)
  const blob = await new Promise<Blob>((r) => cv.toBlob((b) => r(b!), 'image/png'))
  return withDpi(new Uint8Array(await blob.arrayBuffer()), dpi)
}

// Insert a pHYs chunk so journals/Illustrator read the intended DPI.
function withDpi(png: Uint8Array, dpi: number) {
  const ppm = Math.round(dpi / 0.0254)
  const chunk = new Uint8Array(21)
  const dv = new DataView(chunk.buffer)
  dv.setUint32(0, 9)
  chunk.set([0x70, 0x48, 0x59, 0x73], 4) // "pHYs"
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1
  dv.setUint32(17, crc32(chunk.subarray(4, 17)))
  const out = new Uint8Array(png.length + 21)
  out.set(png.subarray(0, 33)) // signature + IHDR
  out.set(chunk, 33)
  out.set(png.subarray(33), 54)
  return out
}
let CRC: Uint32Array | undefined
function crc32(b: Uint8Array) {
  CRC ??= Uint32Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
    return n >>> 0
  })
  let c = 0xffffffff
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export async function exportFigure(opts: { format: 'svg' | 'png' | 'pdf'; plates: Plate[]; dpi: number }) {
  const { doc } = getState()
  const base = opts.plates.length === 1 ? safe(opts.plates[0].name) : safe(doc.name)
  if (opts.format === 'svg') {
    for (const p of opts.plates) await save(`${safe(p.name)}.svg`, 'svg', '<?xml version="1.0" encoding="UTF-8"?>\n' + figureSVG(doc, p))
  } else if (opts.format === 'png') {
    for (const p of opts.plates) {
      const g = geometry(doc, p)
      await save(`${safe(p.name)}_${opts.dpi}dpi.png`, 'png', { base64: b64(await svgToPng(figureSVG(doc, p), g.width, g.height, opts.dpi)) })
    }
  } else {
    if (!native) { alert('Vector PDF export needs the desktop app. Use SVG or PNG in the browser.'); return }
    const dims = opts.plates.map((p) => geometry(doc, p))
    const widthIn = Math.max(...dims.map((g) => g.width)) / 96, heightIn = Math.max(...dims.map((g) => g.height)) / 96
    const pdf = await native.renderPdf({ pages: opts.plates.map((p) => figureSVG(doc, p)), widthIn, heightIn })
    await save(`${base}.pdf`, 'pdf', { base64: pdf })
  }
}

// ---------- data ----------
const csvCell = (v: string) => (/[",\n\t]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const header = (f: Field) => (f.unit ? `${f.name} (${f.unit})` : f.name)

export async function exportCSV(onlyFilled: boolean) {
  const { doc } = getState()
  const rows = [['plate', 'well', 'row', 'column', ...doc.fields.map(header)]]
  for (const p of doc.plates) for (const w of allWells(p)) {
    const d = p.wells[w]
    if (onlyFilled && !d) continue
    const c = parseWell(w)![1]
    // Units only inline when a well overrides the field's unit (header already carries the default unit).
    rows.push([p.name, w, w.replace(/\d+$/, ''), String(c + 1), ...doc.fields.map((f) => cellText(d, f, d?.[unitKey(f.id)] !== undefined))])
  }
  await save(safe(doc.name) + '.csv', 'csv', rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n', 'CSV')
}

/** pycytominer platemap(s) with the configured columns. Current plate: one file. All plates: pick a folder. */
export async function exportPlatemap(scope: 'current' | 'all'): Promise<string | null> {
  const { doc } = getState()
  const s = platemapSettings(doc)
  const ext = s.delimiter === ',' ? 'csv' : 'tsv'
  const text = (rows: string[][]) => toDelimited(rows, s.delimiter)
  if (scope === 'current') {
    const p = curPlate()
    const path = await save(`${plateMapName(p, s)}.${ext}`, ext, text(platemapRows(doc, [p], s)), 'Platemap')
    return path && `Saved ${path}`
  }
  const files = s.layout === 'combined'
    ? [{ name: `${safe(doc.name)}_platemap.${ext}`, data: text(platemapRows(doc, doc.plates, s)) }]
    : doc.plates.map((p) => ({ name: `${plateMapName(p, s)}.${ext}`, data: text(platemapRows(doc, [p], s)) }))
  if (s.barcodeFile) files.push({ name: `barcode_platemap.${ext}`, data: text(barcodeRows(doc.plates, s)) })
  if (!native) {
    for (const f of files) await save(f.name, ext, f.data)
    return `Downloaded ${files.length} file(s)`
  }
  const dir = await native.pickDir()
  if (!dir) return null
  let r = await native.writeFiles({ dir, files, overwrite: false })
  if (r.exists.length) {
    if (!confirm(`These files already exist in ${dir}:\n\n${r.exists.join('\n')}\n\nOverwrite?`)) return null
    r = await native.writeFiles({ dir, files, overwrite: true })
  }
  return `Wrote ${r.written.length} file(s) to ${dir}:\n${r.written.join('\n')}`
}

// ---------- import ----------
export function parseDelimited(text: string): string[][] {
  const delim = (text.split('\n')[0].match(/\t/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((x) => x !== '')) rows.push(row)
  return rows
}

/** Read just the header row of a CSV/TSV (for column templates). */
export async function pickHeaderRow(): Promise<string[] | null> {
  const f = await open(['csv', 'tsv', 'txt'])
  return f ? parseDelimited(f.text.replace(/^\uFEFF/, ''))[0]?.map((h) => h.trim()).filter(Boolean) ?? null : null
}

export async function importTable() {
  const f = await open(['csv', 'tsv', 'txt'])
  if (!f) return
  try {
    const n = importText(f.text, f.path.split(/[\\/]/).pop())
    alert(`Imported ${n} plate(s).`)
  } catch (e) {
    alert('Import failed: ' + (e as Error).message)
  }
}

/**
 * Import a well table. Understands pycytominer platemaps (WellRow/WellCol/well_position + metadata),
 * this app's CSV export and the old Streamlit export (incl. *_color and *_units columns).
 * Without a plate column, the file name becomes the plate name.
 */
export function importText(text: string, fileName = 'Imported'): number {
  const [hdr, ...data] = parseDelimited(text.replace(/^\uFEFF/, ''))
  const headers = hdr.map((h) => h.trim())
  const low = headers.map((h) => h.toLowerCase())
  const matches = matchHeaders(getState().doc, headers)
  const at = (k: string) => matches.findIndex((m) => m.key === k)
  const wi = at('#pos') >= 0 ? at('#pos') : at('#well'), ri = at('#row'), ci = at('#col'), pi = at('#plate')
  if (wi < 0 && (ri < 0 || ci < 0)) throw new Error('Need a well column (well / well_position) or WellRow + WellCol.')
  const colorCols = low.map((h, i) => (h.endsWith('_color') ? i : -1)).filter((i) => i >= 0)
  // "<x>_units" columns (old app format) become the unit of the matching field instead of a field of their own.
  const unitCols = low.map((h, i) => (/(^|_)units?$/.test(h) ? i : -1)).filter((i) => i >= 0)
  const valueCols = headers.map((_, i) => i).filter((i) => !matches[i].key?.startsWith('#') && !colorCols.includes(i) && !unitCols.includes(i))
  const unitColFor = (name: string) => unitCols.find((i) => { const b = low[i].replace(/_?units?$/, ''); return b && name.toLowerCase().startsWith(b) })
  const isPlatemap = at('#pos') >= 0 && !colorCols.length && !unitCols.length
  // platemap_NF1_plate19.csv -> plate "NF1_plate19" (export re-adds the prefix via the file name pattern)
  const baseName = fileName.replace(/\.[^.]+$/, '').replace(/^platemap_/i, '') || 'Imported'
  let plates = 0
  commit(`Import ${baseName} (${data.length} rows)`, (d) => {
    const fieldFor = new Map<number, Draft<Field>>()
    for (const i of valueCols) {
      let fld = matches[i].key ? d.fields.find((x) => x.id === matches[i].key) : undefined
      if (!fld) {
        const vals = data.map((r) => (r[i] ?? '').trim()).filter(Boolean)
        if (!vals.length && !isPlatemap) continue
        const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(headers[i])
        const nums = vals.map(parseNumUnit)
        const numeric = vals.length > 0 && nums.every(Boolean)
        const units = nums.map((x) => x?.unit).filter(Boolean) as string[]
        const common = units.sort((a, b) => units.filter((u) => u === b).length - units.filter((u) => u === a).length)[0]
        fld = {
          id: `f${++d.seq}`, name: (m ? m[1] : headers[i]).trim(), exportName: headers[i], role: 'other', colors: {},
          type: numeric ? 'number' : new Set(vals).size <= 40 ? 'category' : 'text',
          unit: m?.[2] ?? (unitColFor(headers[i]) !== undefined ? data.map((r) => (r[unitColFor(headers[i])!] ?? '').trim()).find(Boolean) : common),
        }
        d.fields.push(fld)
      }
      fieldFor.set(i, fld)
    }
    const byPlate = new Map<string, string[][]>()
    for (const r of data) {
      const key = pi >= 0 ? r[pi] || baseName : baseName
      byPlate.set(key, [...(byPlate.get(key) ?? []), r])
    }
    const posOf = (r: string[]) => parseWell(wi >= 0 ? r[wi] ?? '' : (r[ri] ?? '') + (r[ci] ?? ''))
    for (const [name, rows] of byPlate) {
      let maxR = 0, maxC = 0
      rows.map(posOf).forEach((x) => { if (x) { maxR = Math.max(maxR, x[0]); maxC = Math.max(maxC, x[1]) } })
      const [R, C] = Object.values(FORMATS).find(([fr, fc]) => fr > maxR && fc > maxC) ?? [maxR + 1, maxC + 1]
      const p: Plate = { id: `p${++d.seq}`, name, rows: R, cols: C, wells: {} }
      for (const r of rows) {
        const pos = posOf(r)
        if (!pos) continue
        const id = wellId(pos[0], pos[1])
        for (const [i, fld] of fieldFor) {
          const raw = (r[i] ?? '').trim()
          if (!raw) continue
          const w = (p.wells[id] ??= {})
          if (fld.type === 'number') {
            const pu = parseNumUnit(raw)
            if (!pu) continue
            w[fld.id] = pu.n
            const uc = unitColFor(headers[i])
            const unit = pu.unit ?? (uc !== undefined ? (r[uc] ?? '').trim() : undefined)
            if (unit && !fld.unit) fld.unit = unit
            if (unit && normUnit(unit) !== normUnit(fld.unit)) w[unitKey(fld.id)] = unit
            continue
          }
          const v = coerce(fld as Field, raw)
          if (v === undefined) continue
          w[fld.id] = v
          if (fld.type === 'category' && typeof v === 'string' && !fld.colors[v]) {
            const cc = colorCols.find((k) => fld.name.toLowerCase().replace(/ /g, '_').startsWith(low[k].replace(/_color$/, '')))
            const given = cc !== undefined ? (r[cc] ?? '').trim() : ''
            fld.colors[v] = /^#[0-9a-f]{6}$/i.test(given) ? given : nextColor(fld as Field, d.fields as Field[])
          }
        }
        if (!Object.keys(p.wells[id] ?? {}).length) delete p.wells[id]
      }
      d.plates.push(p)
      plates++
    }
    learnAllDerived(d)
    if (isPlatemap && !d.platemap) applyTemplate(d as Doc, headers)
  })
  if (isPlatemap) rememberTemplate(headers)
  const { doc } = getState()
  setUI({ plateId: doc.plates[doc.plates.length - 1].id })
  return plates
}
