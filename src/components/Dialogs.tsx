import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  useStore, setUI, getState, addPlate, updatePlate, addField, updateField, deleteField, serialDilution,
  distributeControls, randomizeSelection, duplicatePlate, compressTo384, curPlate, newProject, hasRestoredSession,
  usedValues, coerce, setPlatemap, loadTemplate,
} from '../store'
import { type FieldType, type Role, type PlatemapColumn, FORMATS, ROLES, SPECIAL_COLS, parseWell } from '../model'
import { exportFigure, figureSVG, openProject, exportPlatemap, pickHeaderRow } from '../io'
import { UnitSelect } from './Panels'
import { platemapSettings, platemapRows } from '../platemap'

function Modal({ title, children, onOk, okLabel = 'Apply', wide, okDisabled }: { title: string; children: ReactNode; onOk?: () => void | boolean; okLabel?: string; wide?: boolean; okDisabled?: boolean }) {
  const close = () => setUI({ dialog: null })
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  return (
    <div className="modal-back" onPointerDown={close}>
      <div className={'modal' + (wide ? ' wide' : '')} onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><span>{title}</span><button className="icon-btn" onClick={close}>✕</button></div>
        <div className="modal-body">{children}</div>
        {onOk && (
          <div className="modal-foot">
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn primary" disabled={okDisabled} onClick={() => { if (onOk() !== false) close() }}>{okLabel}</button>
          </div>
        )}
      </div>
    </div>
  )
}

const Row = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <div className="form-row"><label>{label}</label><div>{children}{hint && <div className="hint">{hint}</div>}</div></div>
)

export function Dialogs() {
  const d = useStore((s) => s.ui.dialog)
  switch (d) {
    case 'start': return <Start />
    case 'newPlate': return <NewPlate />
    case 'plateSettings': return <PlateSettings />
    case 'field': return <FieldDialog />
    case 'dilution': return <Dilution />
    case 'controls': return <Controls />
    case 'randomize': return <Randomize />
    case 'replicate': return <Replicate />
    case 'compress': return <Compress />
    case 'export': return <ExportDialog />
    case 'platemap': return <PlatemapDialog />
    case 'about': return <About />
    default: return null
  }
}

function FormatPicker({ rows, cols, onChange }: { rows: number; cols: number; onChange: (r: number, c: number) => void }) {
  const custom = !Object.values(FORMATS).some(([r, c]) => r === rows && c === cols)
  return (
    <>
      <div className="format-grid">
        {Object.entries(FORMATS).map(([k, [r, c]]) => (
          <button key={k} className={r === rows && c === cols ? 'on' : ''} onClick={() => onChange(r, c)}>
            <b>{k}</b><small>{r}×{c}</small>
          </button>
        ))}
      </div>
      <div className="inline">
        <span className="hint">{custom ? 'Custom:' : 'or custom:'}</span>
        <input type="number" min={1} max={64} value={rows} onChange={(e) => onChange(Math.max(1, +e.target.value), cols)} style={{ width: 60 }} /> rows ×
        <input type="number" min={1} max={96} value={cols} onChange={(e) => onChange(rows, Math.max(1, +e.target.value))} style={{ width: 60 }} /> cols
      </div>
    </>
  )
}

function MiniPlate({ rows, cols }: { rows: number; cols: number }) {
  const W = 76, H = 52, p = Math.min((W - 8) / cols, (H - 8) / rows)
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={5} fill="none" stroke="currentColor" strokeOpacity={0.35} />
      {Array.from({ length: rows * cols }, (_, i) => (
        <circle key={i} cx={(W - cols * p) / 2 + (i % cols) * p + p / 2} cy={(H - rows * p) / 2 + Math.floor(i / cols) * p + p / 2} r={p * 0.36} fill="currentColor" />
      ))}
    </svg>
  )
}

const START_FORMATS = ['12', '24', '48', '96', '384']

/** Launch screen: pick the plate format before anything else. */
function Start() {
  const [name, setName] = useState('Untitled experiment')
  const [rc, setRc] = useState<[number, number]>([8, 12])
  const [more, setMore] = useState(false)
  const create = () => newProject(name.trim() || 'Untitled experiment', rc[0], rc[1])
  return (
    <Modal wide title="New plate map" okLabel="Create" onOk={create}>
      <Row label="Experiment"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { create(); setUI({ dialog: null }) } }} /></Row>
      <div className="label-sm">Choose plate format</div>
      <div className="start-grid">
        {START_FORMATS.map((k) => {
          const [r, c] = FORMATS[k]
          return (
            <button key={k} className={'start-card' + (r === rc[0] && c === rc[1] ? ' on' : '')} onClick={() => setRc([r, c])} onDoubleClick={() => { newProject(name.trim() || 'Untitled experiment', r, c); setUI({ dialog: null }) }}>
              <MiniPlate rows={r} cols={c} />
              <b>{k}-well</b>
              <small>{r} × {c}</small>
            </button>
          )
        })}
      </div>
      <button className="text-btn" onClick={() => setMore(!more)}>{more ? '▾' : '▸'} Other formats (6, 1536, custom)</button>
      {more && <div style={{ marginTop: 8 }}><FormatPicker rows={rc[0]} cols={rc[1]} onChange={(r, c) => setRc([r, c])} /></div>}
      <div className="start-foot">
        {hasRestoredSession && <button className="btn" onClick={() => setUI({ dialog: null })}>↺ Continue last session</button>}
        <button className="btn" onClick={() => { setUI({ dialog: null }); openProject() }}>Open project…</button>
      </div>
    </Modal>
  )
}

function NewPlate() {
  const n = useStore((s) => s.doc.plates.length)
  const [name, setName] = useState(`Plate ${n + 1}`)
  const [rc, setRc] = useState<[number, number]>([8, 12])
  return (
    <Modal title="New plate" okLabel="Create" onOk={() => addPlate('', name.trim() || `Plate ${n + 1}`, rc)}>
      <Row label="Name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Row>
      <Row label="Format"><FormatPicker rows={rc[0]} cols={rc[1]} onChange={(r, c) => setRc([r, c])} /></Row>
    </Modal>
  )
}

function PlateSettings() {
  const id = useStore((s) => s.ui.dialogArg) ?? getState().ui.plateId
  const p = useStore((s) => s.doc.plates.find((x) => x.id === id))!
  const [name, setName] = useState(p.name)
  const [rc, setRc] = useState<[number, number]>([p.rows, p.cols])
  const [barcode, setBarcode] = useState(p.barcode ?? '')
  const lost = Object.keys(p.wells).filter((w) => { const [r, c] = parseWell(w)!; return r >= rc[0] || c >= rc[1] }).length
  return (
    <Modal title="Plate settings" onOk={() => {
      if (name !== p.name) updatePlate(p.id, { name })
      if (rc[0] !== p.rows || rc[1] !== p.cols) updatePlate(p.id, { rows: rc[0], cols: rc[1] })
      if (barcode !== (p.barcode ?? '')) updatePlate(p.id, { barcode })
    }}>
      <Row label="Name" hint="Used for the platemap file name (platemap_<name>.csv) and Plate_Map_Name.">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Row>
      <Row label="Barcode" hint="Assay_Plate_Barcode in barcode_platemap.csv (defaults to the plate name).">
        <input value={barcode} placeholder={p.name} onChange={(e) => setBarcode(e.target.value)} />
      </Row>
      <Row label="Format" hint={lost ? `⚠ ${lost} filled well(s) fall outside the new size and will be removed (undo restores them).` : undefined}>
        <FormatPicker rows={rc[0]} cols={rc[1]} onChange={(r, c) => setRc([r, c])} />
      </Row>
    </Modal>
  )
}


function FieldDialog() {
  const id = useStore((s) => s.ui.dialogArg)
  const f = useStore((s) => s.doc.fields.find((x) => x.id === id))
  const [name, setName] = useState(f?.name ?? '')
  const [type, setType] = useState<FieldType>(f?.type ?? 'category')
  const [role, setRole] = useState<Role>(f?.role ?? 'other')
  const [unit, setUnit] = useState(f?.unit ?? '')
  const [exportName, setExportName] = useState(f?.exportName ?? '')
  const [from, setFrom] = useState(f?.derive?.from ?? '')
  const [map, setMap] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(f?.derive?.map ?? {}).map(([k, v]) => [k, String(v)])))
  const doc = useStore((s) => s.doc)
  const sources = doc.fields.filter((x) => x.type === 'category' && x.id !== f?.id)
  const srcValues = from ? [...new Set([...usedValues(doc, from).map(String), ...Object.keys(map)])] : []
  return (
    <Modal wide={!!from} title={f ? `Edit field "${f.name}"` : 'New custom field'} okLabel={f ? 'Save' : 'Add field'} okDisabled={!name.trim()} onOk={() => {
      const derive = from ? {
        from,
        map: Object.fromEntries(Object.entries(map).flatMap(([k, v]) => { const c = coerce({ type }, v); return c === undefined ? [] : [[k, c]] })),
      } : undefined
      const patch = { name: name.trim(), type, role, unit: unit || undefined, exportName: exportName.trim() || undefined, derive }
      updateField(f ? f.id : addField(patch.name, type, role, unit), patch)
    }}>
      <Row label="Name"><input autoFocus value={name} placeholder="e.g. Stain panel, Passage, Serum %" onChange={(e) => setName(e.target.value)} /></Row>
      <Row label="Type" hint={type === 'category' ? 'Named values with colors (compound, cell line, stain set)' : type === 'number' ? 'Numeric with unit; can map to color ramps, intensity, bars' : type === 'bool' ? 'Yes/no flag (e.g. excluded, transfected)' : 'Free text (notes, IDs)'}>
        <div className="seg">
          {(['category', 'number', 'text', 'bool'] as FieldType[]).map((t) => <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>{t}</button>)}
        </div>
      </Row>
      {type === 'number' && (
        <Row label="Default unit" hint={f ? 'Used when a well has no unit of its own. Existing values keep their meaning (wells that used the old default keep it).' : 'Default for new values; each well can still pick its own unit.'}>
          <div className="inline">
            <UnitSelect value={unit} role={role} empty="— none —" onChange={setUnit} />
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="or type any unit" style={{ width: 140 }} />
          </div>
        </Row>
      )}
      <Row label="Role" hint="Roles drive validation checks and tools (e.g. control role → control distributor).">
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
      </Row>
      <Row label="Platemap column" hint="Exact column header in the pycytominer platemap export.">
        <input value={exportName} placeholder={name.trim().replace(/\s+/g, '_')} onChange={(e) => setExportName(e.target.value)} />
      </Row>
      <Row label="Auto-fill from" hint="Fill this field automatically from another field's value, e.g. vehicle from treatment. Mappings are also learned when you set values by hand.">
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">— off —</option>
          {sources.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </Row>
      {from && (
        <div className="map-table">
          <div className="map-head"><span>{doc.fields.find((x) => x.id === from)?.name}</span><span>→ {name || 'this field'}</span></div>
          {srcValues.map((k) => (
            <div key={k} className="map-row">
              <span className="ellip">{k}</span>
              <input value={map[k] ?? ''} placeholder="—" list={'map-dl'} onChange={(e) => setMap({ ...map, [k]: e.target.value })} />
            </div>
          ))}
          <datalist id="map-dl">{[...new Set(Object.values(map).filter(Boolean))].map((v) => <option key={v} value={v} />)}</datalist>
          {!srcValues.length && <div className="hint">No values in the source field yet.</div>}
          <div className="hint">Saving fills all existing wells that have a mapped value.</div>
        </div>
      )}
      {f && (
        <div className="danger-zone">
          <button className="btn danger" onClick={() => { if (confirm(`Delete field "${f.name}" and all its values? (Undo restores it)`)) { deleteField(f.id); setUI({ dialog: null }) } }}>Delete field</button>
        </div>
      )}
    </Modal>
  )
}

function useNumericFields() {
  return useStore((s) => s.doc.fields).filter((f) => f.type === 'number')
}

function Dilution() {
  const fields = useStore((s) => s.doc.fields)
  const nSel = useStore((s) => s.ui.selection.size)
  const nums = useNumericFields()
  const cats = fields.filter((f) => f.type === 'category')
  const [fieldId, setFieldId] = useState(nums.find((f) => f.role === 'dose')?.id ?? nums[0]?.id ?? '')
  const [start, setStart] = useState(10)
  const [factor, setFactor] = useState(3)
  const [direction, setDirection] = useState<'row' | 'col'>('row')
  const [descending, setDesc] = useState(true)
  const [zeroLast, setZero] = useState(false)
  const [tf, setTf] = useState(cats.find((f) => f.role === 'treatment')?.id ?? '')
  const [tv, setTv] = useState('')
  const sel = [...getState().ui.selection]
  const groups = new Set(sel.map((w) => (direction === 'row' ? w.replace(/\d+$/, '') : w.replace(/^[A-Z]+/, '')))).size
  const points = groups ? Math.round(sel.length / groups) : 0
  const fieldUnit = fields.find((f) => f.id === fieldId)?.unit ?? ''
  const [unitPick, setUnitPick] = useState<string | null>(null)
  const unit = unitPick ?? fieldUnit
  const series = Array.from({ length: Math.min(points, 24) }, (_, i) => (zeroLast && i === points - 1 ? 0 : Number((start / factor ** i).toPrecision(3))))
  if (!descending) series.reverse()
  return (
    <Modal title="Serial dilution" okDisabled={!nSel || !fieldId} onOk={() => serialDilution({ fieldId, start, factor, direction, descending, zeroLast, unit, treatment: tf && tv ? { fieldId: tf, value: tv } : undefined })}>
      {!nSel && <div className="warn-box">Select the wells for the dilution first (e.g. drag A1:B10). Each row (or column) becomes one replicate series.</div>}
      <Row label="Field"><select value={fieldId} onChange={(e) => setFieldId(e.target.value)}>{nums.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Row>
      <Row label="Top dose"><div className="inline"><input type="number" value={start} onChange={(e) => setStart(+e.target.value)} /><UnitSelect value={unit} role="dose" empty="—" onChange={setUnitPick} /></div></Row>
      <Row label="Dilution factor"><div className="inline">1 : <input type="number" min={1.01} step={0.5} value={factor} onChange={(e) => setFactor(Math.max(1.0001, +e.target.value))} />
        {[2, 3, 10, Math.SQRT2].map((x) => <button key={x} className="chip" onClick={() => setFactor(x)}>{x === Math.SQRT2 ? '√2' : x}</button>)}</div></Row>
      <Row label="Direction">
        <div className="seg">
          <button className={direction === 'row' ? 'on' : ''} onClick={() => setDirection('row')}>Across rows →</button>
          <button className={direction === 'col' ? 'on' : ''} onClick={() => setDirection('col')}>Down columns ↓</button>
        </div>
      </Row>
      <Row label="Order"><div className="checks">
        <label className="check"><input type="checkbox" checked={descending} onChange={(e) => setDesc(e.target.checked)} />High → low</label>
        <label className="check"><input type="checkbox" checked={zeroLast} onChange={(e) => setZero(e.target.checked)} />Last point = 0 (vehicle)</label>
      </div></Row>
      <Row label="Also set" hint="Optional: assign a compound to the same wells.">
        <div className="inline">
          <select value={tf} onChange={(e) => setTf(e.target.value)}><option value="">—</option>{cats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          <input placeholder="value, e.g. Staurosporine" value={tv} onChange={(e) => setTv(e.target.value)} />
        </div>
      </Row>
      {points > 0 && <div className="preview-series"><span className="hint">{groups} series × {points} points:</span> {series.map((v, i) => <span key={i} className="pill">{v}</span>)} {unit}</div>}
    </Modal>
  )
}

function Controls() {
  const fields = useStore((s) => s.doc.fields)
  const cats = fields.filter((f) => f.type === 'category')
  const [fieldId, setFieldId] = useState(cats.find((f) => f.role === 'control')?.id ?? cats[0]?.id ?? '')
  const f = fields.find((x) => x.id === fieldId)
  const [entries, setEntries] = useState<{ value: string; count: number }[]>(() => [
    { value: 'Positive', count: 4 }, { value: 'Negative', count: 4 }, { value: 'DMSO', count: 8 },
  ])
  const [region, setRegion] = useState<'selection' | 'empty' | 'inner-empty'>('inner-empty')
  const [mode, setMode] = useState<'spread' | 'random'>('spread')
  const [seed, setSeed] = useState(42)
  const [err, setErr] = useState('')
  const total = entries.reduce((a, e) => a + e.count, 0)
  return (
    <Modal title="Distribute controls" onOk={() => {
      try { distributeControls({ fieldId, entries: entries.filter((e) => e.value && e.count > 0), region, mode, seed }); return true }
      catch (e) { setErr((e as Error).message); return false }
    }}>
      <p className="hint">Spreads control wells so every row and column gets a balanced share — essential for per-plate normalization and spotting positional effects.</p>
      <Row label="Field"><select value={fieldId} onChange={(e) => setFieldId(e.target.value)}>{cats.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Row>
      <Row label="Controls">
        <div className="entries">
          {entries.map((e, i) => (
            <div key={i} className="inline">
              <span className="swatch" style={{ background: f?.colors[e.value] ?? '#888', width: 14, height: 14 }} />
              <input list="ctrl-vals" value={e.value} onChange={(ev) => setEntries(entries.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)))} />
              <input type="number" min={0} value={e.count} style={{ width: 64 }} onChange={(ev) => setEntries(entries.map((x, j) => (j === i ? { ...x, count: Math.max(0, +ev.target.value) } : x)))} />
              <button className="icon-btn" onClick={() => setEntries(entries.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <datalist id="ctrl-vals">{Object.keys(f?.colors ?? {}).map((v) => <option key={v} value={v} />)}</datalist>
          <button className="text-btn" onClick={() => setEntries([...entries, { value: '', count: 4 }])}>＋ add control</button>
          <div className="hint">{total} wells total</div>
        </div>
      </Row>
      <Row label="Place in">
        <div className="seg">
          <button className={region === 'inner-empty' ? 'on' : ''} onClick={() => setRegion('inner-empty')}>Empty, non-edge</button>
          <button className={region === 'empty' ? 'on' : ''} onClick={() => setRegion('empty')}>Any empty</button>
          <button className={region === 'selection' ? 'on' : ''} onClick={() => setRegion('selection')}>Selection</button>
        </div>
      </Row>
      <Row label="Pattern">
        <div className="seg">
          <button className={mode === 'spread' ? 'on' : ''} onClick={() => setMode('spread')}>Balanced spread</button>
          <button className={mode === 'random' ? 'on' : ''} onClick={() => setMode('random')}>Random</button>
        </div>
      </Row>
      <Row label="Seed"><div className="inline"><input type="number" value={seed} onChange={(e) => setSeed(+e.target.value)} /><button className="chip" onClick={() => setSeed(Math.floor(Math.random() * 1e6))}>🎲</button></div></Row>
      {err && <div className="warn-box">{err}</div>}
    </Modal>
  )
}

function Randomize() {
  const fields = useStore((s) => s.doc.fields)
  const nSel = useStore((s) => s.ui.selection.size)
  const [seed, setSeed] = useState(Math.floor(Math.random() * 1e6))
  const [keep, setKeep] = useState(true)
  const [only, setOnly] = useState<Set<string> | null>(null)
  return (
    <Modal title="Randomize layout" okDisabled={nSel < 2} onOk={() => randomizeSelection(seed, keep, only ? [...only] : null)}>
      <p className="hint">Shuffles well contents among the {nSel} selected wells. The seed is recorded in History, so the layout is reproducible.</p>
      {nSel < 2 && <div className="warn-box">Select at least 2 wells (tip: Select → Inner to keep edges fixed).</div>}
      <Row label="Seed"><div className="inline"><input type="number" value={seed} onChange={(e) => setSeed(+e.target.value)} /><button className="chip" onClick={() => setSeed(Math.floor(Math.random() * 1e6))}>🎲 New</button></div></Row>
      <Row label="Options"><label className="check"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />Keep control wells in place</label></Row>
      <Row label="Shuffle fields" hint="Default: whole well moves together. Pick fields to shuffle only those (e.g. compound+dose, keep cell line).">
        <div className="checks wrap">
          <label className="check"><input type="checkbox" checked={!only} onChange={(e) => setOnly(e.target.checked ? null : new Set())} />All</label>
          {only && fields.map((f) => (
            <label key={f.id} className="check"><input type="checkbox" checked={only.has(f.id)} onChange={(e) => { const s = new Set(only); if (e.target.checked) s.add(f.id); else s.delete(f.id); setOnly(s) }} />{f.name}</label>
          ))}
        </div>
      </Row>
    </Modal>
  )
}

function Replicate() {
  const plate = useStore((s) => curPlate(s))
  const [n, setN] = useState(2)
  const [rand, setRand] = useState(false)
  const [seed, setSeed] = useState(1)
  const [keep, setKeep] = useState(true)
  return (
    <Modal title={`Replicate "${plate.name}"`} okLabel="Create plates" onOk={() => duplicatePlate(plate.id, n, rand ? seed : null, keep)}>
      <Row label="Copies"><input type="number" min={1} max={50} value={n} onChange={(e) => setN(Math.max(1, Math.min(50, +e.target.value)))} /></Row>
      <Row label="Layout" hint="Randomizing each replicate plate (different seed per copy) decorrelates treatment from position.">
        <div className="checks">
          <label className="check"><input type="checkbox" checked={rand} onChange={(e) => setRand(e.target.checked)} />Randomize positions</label>
          {rand && <label className="check"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />Keep controls fixed</label>}
        </div>
      </Row>
      {rand && <Row label="Base seed"><input type="number" value={seed} onChange={(e) => setSeed(+e.target.value)} /></Row>}
    </Modal>
  )
}

function Compress() {
  const plates = useStore((s) => s.doc.plates).filter((p) => p.rows <= 8 && p.cols <= 12)
  const [src, setSrc] = useState<(string | null)[]>(() => [0, 1, 2, 3].map((i) => plates[i]?.id ?? null))
  const [name, setName] = useState('384 combined')
  const [track, setTrack] = useState(true)
  return (
    <Modal title="Combine 4 × 96-well → 384-well" okLabel="Create 384 plate" okDisabled={!src.some(Boolean)} onOk={() => compressTo384(src, name, track)}>
      <p className="hint">Standard quadrant interleave: Q1 → A1, Q2 → A2, Q3 → B1, Q4 → B2 of each 2×2 block.</p>
      <div className="quad">
        {['Q1 (A1)', 'Q2 (A2)', 'Q3 (B1)', 'Q4 (B2)'].map((q, i) => (
          <Row key={q} label={q}>
            <select value={src[i] ?? ''} onChange={(e) => setSrc(src.map((x, j) => (j === i ? e.target.value || null : x)))}>
              <option value="">— empty —</option>
              {plates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Row>
        ))}
      </div>
      <Row label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Row>
      <Row label="Traceability"><label className="check"><input type="checkbox" checked={track} onChange={(e) => setTrack(e.target.checked)} />Add “Source plate / Source well” fields</label></Row>
    </Modal>
  )
}

function ExportDialog() {
  const doc = useStore((s) => s.doc)
  const plate = useStore((s) => curPlate(s))
  const [format, setFormat] = useState<'png' | 'svg' | 'pdf'>('pdf')
  const [scope, setScope] = useState<'current' | 'all'>('current')
  const [dpi, setDpi] = useState(600)
  const [busy, setBusy] = useState(false)
  const svg = useMemo(() => figureSVG(doc, plate), [doc, plate])
  return (
    <Modal wide title="Export figure" okLabel={busy ? 'Exporting…' : 'Export'} okDisabled={busy} onOk={() => {
      setBusy(true)
      exportFigure({ format, dpi, plates: scope === 'all' ? doc.plates : [plate] })
        .catch((e) => alert('Export failed: ' + e.message))
        .finally(() => { setBusy(false); setUI({ dialog: null }) })
      return false
    }}>
      <div className="export-grid">
        <div className="export-preview" dangerouslySetInnerHTML={{ __html: svg }} />
        <div>
          <Row label="Format">
            <div className="seg">
              {(['pdf', 'svg', 'png'] as const).map((f) => <button key={f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)}>{f.toUpperCase()}</button>)}
            </div>
          </Row>
          <div className="hint" style={{ margin: '-4px 0 10px' }}>
            {format === 'pdf' && 'Vector PDF — one page per plate. Best for papers and posters.'}
            {format === 'svg' && 'Vector SVG — editable in Illustrator / Inkscape / Affinity.'}
            {format === 'png' && 'Raster PNG with embedded DPI metadata.'}
          </div>
          {format === 'png' && (
            <Row label="Resolution">
              <div className="seg">{[150, 300, 600, 1200].map((d) => <button key={d} className={dpi === d ? 'on' : ''} onClick={() => setDpi(d)}>{d} dpi</button>)}</div>
            </Row>
          )}
          <Row label="Plates">
            <div className="seg">
              <button className={scope === 'current' ? 'on' : ''} onClick={() => setScope('current')}>Current</button>
              <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>All ({doc.plates.length})</button>
            </div>
          </Row>
          <p className="hint">Appearance (well size, fonts, legend, colors) is set in the <b>Figure</b> and <b>Layers</b> tabs — the preview matches the export exactly.</p>
        </div>
      </div>
    </Modal>
  )
}

const SPECIAL_LABEL: Record<string, string> = {
  '#row': 'Well row (B)', '#col': 'Well column (2)', '#pos': 'Well position (B02)', '#well': 'Well (B2)', '#plate': 'Plate map name', '#barcode': 'Plate barcode',
}

function PlatemapDialog() {
  const doc = useStore((s) => s.doc)
  const plate = useStore((s) => curPlate(s))
  const s = platemapSettings(doc)
  const [scope, setScope] = useState<'current' | 'all'>(doc.plates.length > 1 ? 'all' : 'current')
  const [busy, setBusy] = useState(false)
  const cols = s.columns
  const setCols = (c: PlatemapColumn[]) => setPlatemap({ columns: c })
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= cols.length) return
    const c = cols.slice();
    [c[i], c[j]] = [c[j], c[i]]
    setCols(c)
  }
  const label = (k: string) => SPECIAL_LABEL[k] ?? doc.fields.find((f) => f.id === k)?.name ?? k
  const missingSpecial = Object.keys(SPECIAL_COLS).filter((k) => !cols.some((c) => c.key === k))
  const preview = platemapRows(doc, [plate], { ...s, layout: scope === 'all' ? s.layout : 'perPlate' })
  return (
    <Modal wide title="Export platemap (pycytominer)" okLabel={busy ? 'Exporting…' : scope === 'all' ? 'Export to folder…' : 'Save CSV…'} okDisabled={busy} onOk={() => {
      setBusy(true)
      exportPlatemap(scope)
        .then((msg) => { if (msg) alert(msg) })
        .catch((e) => alert('Export failed: ' + e.message))
        .finally(() => { setBusy(false); setUI({ dialog: null }) })
      return false
    }}>
      <div className="pm-grid">
        <div>
          <div className="pm-toolbar">
            <span className="label-sm" style={{ margin: 0 }}>Columns (in order)</span>
            <span className="sb-sp" />
            <button className="text-btn" title="Read the header row of an existing platemap and copy its exact column names and order" onClick={async () => { const h = await pickHeaderRow(); if (h?.length) loadTemplate(h) }}>⤓ Use header from CSV…</button>
          </div>
          <div className="pm-cols">
            {cols.map((c, i) => (
              <div key={c.key} className={'pm-col' + (c.on ? '' : ' off')}>
                <input type="checkbox" checked={c.on} onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                <span className="pm-src ellip" title={label(c.key)}>{label(c.key)}</span>
                <input className="pm-header" value={c.header} onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, header: e.target.value } : x)))} />
                <button className="icon-btn" onClick={() => move(i, -1)}>↑</button>
                <button className="icon-btn" onClick={() => move(i, 1)}>↓</button>
              </div>
            ))}
          </div>
          {missingSpecial.length > 0 && (
            <select value="" onChange={(e) => e.target.value && setCols([...cols, { key: e.target.value, header: SPECIAL_COLS[e.target.value], on: true }])}>
              <option value="">＋ Add column…</option>
              {missingSpecial.map((k) => <option key={k} value={k}>{SPECIAL_LABEL[k]} ({SPECIAL_COLS[k]})</option>)}
            </select>
          )}
        </div>
        <div>
          <Row label="Plates">
            <div className="seg">
              <button className={scope === 'current' ? 'on' : ''} onClick={() => setScope('current')}>Current</button>
              <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>All ({doc.plates.length})</button>
            </div>
          </Row>
          {scope === 'all' && (
            <Row label="Files">
              <div className="seg">
                <button className={s.layout === 'perPlate' ? 'on' : ''} onClick={() => setPlatemap({ layout: 'perPlate' })}>One per plate</button>
                <button className={s.layout === 'combined' ? 'on' : ''} onClick={() => setPlatemap({ layout: 'combined' })}>Combined</button>
              </div>
            </Row>
          )}
          <Row label="File name" hint={`→ ${s.fileName.replace('{plate}', plate.name).replace(/[^\w.+-]+/g, '_')}.${s.delimiter === ',' ? 'csv' : 'tsv'}  ({plate} = plate name)`}>
            <input value={s.fileName} onChange={(e) => setPlatemap({ fileName: e.target.value })} />
          </Row>
          <Row label="Format">
            <div className="seg">
              <button className={s.delimiter === ',' ? 'on' : ''} onClick={() => setPlatemap({ delimiter: ',' })}>CSV ,</button>
              <button className={s.delimiter === '\t' ? 'on' : ''} onClick={() => setPlatemap({ delimiter: '\t' })}>TSV ⇥</button>
            </div>
          </Row>
          <Row label="Options">
            <div className="checks" style={{ flexDirection: 'column', gap: 6 }}>
              <label className="check"><input type="checkbox" checked={s.onlyFilled} onChange={(e) => setPlatemap({ onlyFilled: e.target.checked })} />Only wells with data</label>
              <label className="check"><input type="checkbox" checked={s.inlineUnits} onChange={(e) => setPlatemap({ inlineUnits: e.target.checked })} />Units in values (10ng/ml, 1uM)</label>
              {scope === 'all' && <label className="check"><input type="checkbox" checked={s.barcodeFile} onChange={(e) => setPlatemap({ barcodeFile: e.target.checked })} />Also write barcode_platemap</label>}
            </div>
          </Row>
          <p className="hint">Settings are saved with the project. Importing one of your platemaps sets these columns automatically.</p>
        </div>
      </div>
      <div className="label-sm">Preview — {plate.name} ({preview.length - 1} rows)</div>
      <div className="pm-preview">
        <table>
          <thead><tr>{preview[0].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{preview.slice(1, 13).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </Modal>
  )
}

function About() {
  const keys: [string, string][] = [
    ['V / B / E', 'Select / Brush / Eraser'], ['Drag', 'Box select'], ['Shift / Ctrl + click', 'Add / toggle selection'],
    ['Header click/drag', 'Select rows / columns'], ['Ctrl+A / Ctrl+D', 'Select all / none'], ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / Redo'],
    ['Ctrl+C / Ctrl+V', 'Copy / paste wells'], ['Delete', 'Clear selected wells'], ['Ctrl+S', 'Save project'], ['Ctrl+E', 'Export figure'],
    ['Ctrl + wheel', 'Zoom'], ['Ctrl+0', 'Fit'],
  ]
  return (
    <Modal title="Keyboard shortcuts">
      <table className="keys"><tbody>{keys.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
    </Modal>
  )
}
