import { useState, type ReactNode } from 'react'
import {
  useStore, setUI, select, selectWhere, setValues, clearWells, curPlate, usedValues, renameValue,
  setValueColor, applyPalette, setLayer, setStyle, jumpTo, commit, coalesced, coerce, moveField, setUnit, renameNumber, type Tool,
} from '../store'
import {
  type Doc, type Field, type Value, type LayerKind, type Plate, LAYER_KINDS, LAYER_INFO, PALETTES, RAMPS,
  allWells, isEdge, hasData, fmt, parseWell, nextColor, parseNumUnit, normUnit, wellUnit, unitGroupsFor, UNIT_GROUPS,
} from '../model'
import { ColorSwatch } from './ColorPicker'

export function Section({ title, children, right, defaultOpen = true }: { title: string; children: ReactNode; right?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="section">
      <div className="section-head" onClick={() => setOpen(!open)}>
        <span className={'caret' + (open ? ' open' : '')}>▸</span>
        <span className="section-title">{title}</span>
        <span className="sb-sp" />
        <span onClick={(e) => e.stopPropagation()}>{right}</span>
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  )
}

/** Unit dropdown grouped by kind (molar, mass/volume, …). Unknown units (typed or imported) are kept as an extra option. */
export function UnitSelect({ value, onChange, role, mixed, empty }: { value: string; onChange: (u: string) => void; role: Field['role']; mixed?: boolean; empty?: string }) {
  const groups = unitGroupsFor(role)
  const all = UNIT_GROUPS.flatMap((g) => g.units)
  const match = all.find((u) => normUnit(u) === normUnit(value)) ?? value
  const others = UNIT_GROUPS.filter((g) => !groups.includes(g))
  return (
    <select className="unit-select" value={mixed ? '\u0000' : match} title="Unit" onChange={(e) => onChange(e.target.value)}>
      {mixed && <option value={'\u0000'} disabled>mixed</option>}
      {empty !== undefined && <option value="">{empty}</option>}
      {match && !all.includes(match) && <option value={match}>{match}</option>}
      {groups.map((g) => <optgroup key={g.label} label={g.label}>{g.units.map((u) => <option key={u} value={u}>{u}</option>)}</optgroup>)}
      {others.length > 0 && <optgroup label="Other units">{others.flatMap((g) => g.units).map((u) => <option key={u} value={u}>{u}</option>)}</optgroup>}
    </select>
  )
}

// ================= LEFT: tools + fields =================
const TOOLS: [Tool, string, string, string][] = [
  ['select', '⬚', 'Select', 'V'],
  ['brush', '🖌', 'Brush (paint a value)', 'B'],
  ['erase', '⌫', 'Eraser (clear wells)', 'E'],
]

export function LeftPanel() {
  const tool = useStore((s) => s.ui.tool)
  const plate = useStore((s) => curPlate(s))
  const sel = useStore((s) => s.ui.selection)
  return (
    <div className="panel left">
      <Section title="Tools">
        <div className="tool-row">
          {TOOLS.map(([t, icon, label, key]) => (
            <button key={t} className={'tool' + (tool === t ? ' active' : '')} title={`${label} (${key})`} onClick={() => setUI({ tool: t })}>
              <span className="tool-icon">{icon}</span>
              <span className="tool-label">{label.split(' ')[0]}</span>
            </button>
          ))}
        </div>
        <div className="label-sm">Select</div>
        <div className="chip-grid">
          <button onClick={() => select(allWells(plate))}>All</button>
          <button onClick={() => select([])}>None</button>
          <button onClick={() => selectWhere((w) => !sel.has(w))}>Invert</button>
          <button onClick={() => selectWhere((w) => isEdge(plate, w))}>Edge</button>
          <button onClick={() => selectWhere((w) => isEdge(plate, w, 2))}>Edge ×2</button>
          <button onClick={() => selectWhere((w) => !isEdge(plate, w))}>Inner</button>
          <button onClick={() => selectWhere((w) => !hasData(plate.wells[w]))}>Empty</button>
          <button onClick={() => selectWhere((w) => hasData(plate.wells[w]))}>Filled</button>
          <button onClick={() => selectWhere((w) => { const [r, c] = parseWell(w)!; return (r + c) % 2 === 0 })}>Checker</button>
        </div>
        <div className="label-sm">Screening tools</div>
        <div className="wizard-list">
          <button onClick={() => setUI({ dialog: 'dilution' })}><b>Serial dilution</b><small>dose series on selection</small></button>
          <button onClick={() => setUI({ dialog: 'controls' })}><b>Distribute controls</b><small>spread pos/neg/DMSO</small></button>
          <button onClick={() => setUI({ dialog: 'randomize' })}><b>Randomize layout</b><small>seeded shuffle</small></button>
          <button onClick={() => setUI({ dialog: 'replicate' })}><b>Replicate plates</b><small>copies ± randomized</small></button>
          <button onClick={() => setUI({ dialog: 'compress' })}><b>4 × 96 → 384</b><small>quadrant interleave</small></button>
        </div>
      </Section>
      <FieldsPanel />
    </div>
  )
}

function FieldsPanel() {
  const fields = useStore((s) => s.doc.fields)
  return (
    <Section title="Fields & values" right={<button className="text-btn" onClick={() => setUI({ dialog: 'field', dialogArg: undefined })}>＋ Field</button>}>
      <div className="fields">
        {fields.map((f) => <FieldRow key={f.id} f={f} />)}
      </div>
    </Section>
  )
}

const TYPE_ICON: Record<string, string> = { category: '◉', number: '#', text: 'T', bool: '☑' }

function FieldRow({ f }: { f: Field }) {
  const doc = useStore((s) => s.doc)
  const plate = useStore((s) => curPlate(s))
  const brush = useStore((s) => s.ui.brush)
  const [open, setOpen] = useState(f.type === 'category')
  const [adding, setAdding] = useState('')
  const [addUnit, setAddUnit] = useState<string | undefined>(f.unit)
  const used = usedValues(doc, f.id)
  const values: Value[] = f.type === 'category' ? [...new Set([...used, ...Object.keys(f.colors)])] : used
  const counts = new Map<Value, number>()
  for (const w of Object.values(plate.wells)) if (w[f.id] !== undefined) counts.set(w[f.id], (counts.get(w[f.id]) ?? 0) + 1)
  // Numbers are listed per value+unit, so 10 nM and 10 ng/ml stay separate.
  const numEntries = new Map<string, { v: number; u: string; count: number }>()
  if (f.type === 'number') {
    for (const p of doc.plates) for (const w of Object.values(p.wells)) {
      const v = w[f.id]
      if (typeof v !== 'number') continue
      const u = wellUnit(w, f) ?? '', k = v + '|' + normUnit(u)
      const e = numEntries.get(k) ?? { v, u, count: 0 }
      if (p === plate) e.count++
      numEntries.set(k, e)
    }
  }
  const nums = [...numEntries.values()].sort((a, b) => a.u.localeCompare(b.u) || a.v - b.v)

  return (
    <div className="field">
      <div className="field-head" onClick={() => setOpen(!open)}>
        <span className={'caret' + (open ? ' open' : '')}>▸</span>
        <span className="type-icon" title={f.type}>{TYPE_ICON[f.type]}</span>
        <span className="field-name">{f.name}</span>
        {f.unit && <span className="unit">{f.unit}</span>}
        {f.derive && <span className="unit" title="Auto-filled">← {doc.fields.find((x) => x.id === f.derive!.from)?.name}</span>}
        <span className="sb-sp" />
        <span className="field-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" title="Move up" onClick={() => moveField(f.id, -1)}>↑</button>
          <button className="icon-btn" title="Edit field" onClick={() => setUI({ dialog: 'field', dialogArg: f.id })}>⚙</button>
        </span>
      </div>
      {open && (
        <div className="values">
          {f.type === 'category' && (
            <div className="palette-row">
              <select value="" onChange={(e) => e.target.value && applyPalette(f.id, e.target.value)}>
                <option value="">Apply palette…</option>
                {Object.keys(PALETTES).map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
          )}
          {f.type === 'number'
            ? nums.slice(0, 200).map((e) => (
              <ValueRow key={e.v + '|' + e.u} f={f} v={e.v} u={e.u} count={e.count}
                brushing={brush?.fieldId === f.id && brush.value === e.v && normUnit(brush.unit ?? f.unit) === normUnit(e.u)} />
            ))
            : values.slice(0, 200).map((v) => (
              <ValueRow key={String(v)} f={f} v={v} count={counts.get(v) ?? 0} brushing={brush?.fieldId === f.id && brush.value === v} />
            ))}
          {!values.length && <div className="hint">No values yet. Select wells and type in the Inspector{f.type === 'category' ? ', or add one below' : ''}.</div>}
          {(f.type === 'category' || f.type === 'number' || f.type === 'text') && (
            <form className="add-value" onSubmit={(e) => {
              e.preventDefault()
              const v = coerce(f, adding)
              if (v === undefined) return
              if (f.type === 'number') {
                setUI({ tool: 'brush', brush: { fieldId: f.id, value: v, unit: parseNumUnit(adding)?.unit ?? addUnit ?? f.unit } })
                setAdding('')
                return
              }
              if (f.type === 'category') commit(`Add ${f.name} "${v}"`, (d) => {
                const df = d.fields.find((x) => x.id === f.id)!
                if (!df.colors[v as string]) df.colors[v as string] = nextColor(df as Field, d.fields as Field[])
              })
              setUI({ tool: 'brush', brush: { fieldId: f.id, value: v } })
              setAdding('')
            }}>
              <div className="add-row">
                <input placeholder={f.type === 'number' ? 'value → brush' : 'new value → brush'} value={adding} onChange={(e) => setAdding(e.target.value)} />
                {f.type === 'number' && <UnitSelect value={addUnit ?? ''} role={f.role} empty="—" onChange={(u) => setAddUnit(u || undefined)} />}
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

function ValueRow({ f, v, u, count, brushing }: { f: Field; v: Value; u?: string; count: number; brushing: boolean }) {
  const [edit, setEdit] = useState(false)
  const [text, setText] = useState(String(v))
  const isNum = f.type === 'number'
  const matches = (w: string) => {
    const d = curPlate().wells[w]
    return d?.[f.id] === v && (!isNum || normUnit(wellUnit(d, f)) === normUnit(u))
  }
  return (
    <div className={'value-row' + (brushing ? ' brushing' : '')}>
      {f.type === 'category' && typeof v === 'string'
        ? <ColorSwatch color={f.colors[v] ?? '#888888'} onChange={(c) => setValueColor(f.id, v, c)} size={14} />
        : <span className="num-dot" />}
      {edit ? (
        <input
          autoFocus className="value-edit" value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { setEdit(false); if (isNum) renameNumber(f.id, v as number, u || undefined, text); else renameValue(f.id, v, text) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(String(v)); setEdit(false) } }}
        />
      ) : (
        <span className="value-name" title="Click: select wells · Double-click: edit everywhere (e.g. 10 nM)" onClick={(e) => selectWhere(matches, e.shiftKey ? 'add' : 'replace')} onDoubleClick={() => { setText(isNum && u ? `${v} ${u}` : String(v)); setEdit(true) }}>
          {fmt(v)}{isNum && u ? <span className="unit"> {u}</span> : null}
        </span>
      )}
      <span className="count">{count || ''}</span>
      <button className={'icon-btn' + (brushing ? ' on' : '')} title="Paint with this value" onClick={() => setUI({ tool: 'brush', brush: { fieldId: f.id, value: v, unit: isNum ? u || undefined : undefined } })}>🖌</button>
    </div>
  )
}

// ================= RIGHT: tabbed =================
const TABS = [['inspector', 'Inspector'], ['layers', 'Layers'], ['style', 'Figure'], ['history', 'History'], ['checks', 'Checks']] as const

export function RightPanel() {
  const tab = useStore((s) => s.ui.rightTab)
  const issues = useStore((s) => runChecks(s.doc).length)
  return (
    <div className="panel right">
      <div className="rtabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={'rtab' + (tab === k ? ' active' : '')} onClick={() => setUI({ rightTab: k })}>
            {label}{k === 'checks' && issues > 0 && <span className="badge">{issues}</span>}
          </button>
        ))}
      </div>
      <div className="rbody">
        {tab === 'inspector' && <Inspector />}
        {tab === 'layers' && <Layers />}
        {tab === 'style' && <StylePanel />}
        {tab === 'history' && <History />}
        {tab === 'checks' && <Checks />}
      </div>
    </div>
  )
}

function Inspector() {
  const sel = useStore((s) => s.ui.selection)
  const plate = useStore((s) => curPlate(s))
  const fields = useStore((s) => s.doc.fields)
  const doc = useStore((s) => s.doc)
  const wells = [...sel]
  if (!wells.length) return (
    <div className="empty-state">
      <div className="big">⬚</div>
      <p>Select wells on the plate to edit their values.</p>
      <p className="hint">Drag to box-select · Shift adds · Ctrl toggles · click row/column headers · Ctrl+A all</p>
    </div>
  )
  const key = wells.join(',') + '|' + plate.id
  return (
    <div className="inspector">
      <div className="insp-head">
        <b>{wells.length} well{wells.length > 1 ? 's' : ''}</b>
        <span className="hint ellip">{wells.slice(0, 12).join(', ')}{wells.length > 12 ? '…' : ''}</span>
      </div>
      {fields.map((f) => <FieldInput key={f.id + key + JSON.stringify(wells.map((w) => plate.wells[w]?.[f.id]))} f={f} wells={wells} plate={plate} doc={doc} />)}
      <div className="insp-actions">
        <button className="btn" onClick={() => clearWells(wells)}>Clear all values</button>
        <button className="btn" onClick={() => setUI({ dialog: 'field', dialogArg: undefined })}>＋ Custom field</button>
      </div>
    </div>
  )
}

function FieldInput({ f, wells, plate, doc }: { f: Field; wells: string[]; plate: Plate; doc: Doc }) {
  const isNum = f.type === 'number'
  const vals = new Set(wells.map((w) => plate.wells[w]?.[f.id]))
  const uniform = vals.size === 1 ? [...vals][0] : undefined
  const mixed = vals.size > 1
  const init = uniform === undefined ? '' : String(uniform)
  const [text, setText] = useState(init)
  // Unit dropdown: the unit shared by the selected wells that have a value (field default when none has one).
  const units = new Set(wells.filter((w) => plate.wells[w]?.[f.id] !== undefined).map((w) => normUnit(wellUnit(plate.wells[w], f))))
  const firstUnit = wells.map((w) => plate.wells[w]).find((d) => d?.[f.id] !== undefined)
  const [unit, setUnitState] = useState(units.size === 1 ? wellUnit(firstUnit, f) ?? '' : f.unit ?? '')
  const commitText = () => {
    if (text === init) return
    if (!isNum) return setValues(wells, f.id, coerce(f, text))
    const pu = parseNumUnit(text)
    if (text.trim() && !pu) { setText(init); return }
    // A unit typed in the box ("10 nM") wins over the dropdown.
    setValues(wells, f.id, pu?.n, undefined, pu?.unit ?? (unit || null))
  }
  const listId = 'dl-' + f.id
  return (
    <div className="insp-row">
      <label title={f.name}>{f.name}{!isNum && f.unit && <span className="unit"> ({f.unit})</span>}</label>
      <div className="insp-input">
        {f.type === 'category' && typeof uniform === 'string' && f.colors[uniform] !== undefined && (
          <ColorSwatch color={f.colors[uniform] ?? '#888'} onChange={(c) => setValueColor(f.id, uniform, c)} size={20} />
        )}
        {f.type === 'bool' ? (
          <select value={mixed ? 'mixed' : init} onChange={(e) => e.target.value !== 'mixed' && setValues(wells, f.id, e.target.value === '' ? undefined : e.target.value === 'true')}>
            {mixed && <option value="mixed">— mixed —</option>}
            <option value="">—</option><option value="true">yes</option><option value="false">no</option>
          </select>
        ) : (
          <>
            <input
              value={text}
              type="text"
              inputMode={f.type === 'number' ? 'decimal' : undefined}
              list={f.type === 'category' ? listId : undefined}
              placeholder={mixed ? '— mixed —' : ''}
              onChange={(e) => setText(e.target.value)}
              onBlur={commitText}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setText(init) }}
            />
            {isNum && (
              <UnitSelect value={unit} role={f.role} mixed={units.size > 1} empty="—" onChange={(u) => { setUnitState(u); setUnit(wells, f.id, u) }} />
            )}
            {f.type === 'category' && (
              <datalist id={listId}>{[...new Set([...usedValues(doc, f.id), ...Object.keys(f.colors)])].map((v) => <option key={String(v)} value={String(v)} />)}</datalist>
            )}
          </>
        )}
        {(uniform !== undefined || mixed) && <button className="icon-btn" title="Clear" onClick={() => setValues(wells, f.id, undefined)}>×</button>}
      </div>
    </div>
  )
}

function Layers() {
  const doc = useStore((s) => s.doc)
  return (
    <div className="layers">
      <p className="hint">Each layer encodes one field. Combine them, e.g. fill = compound, intensity = concentration, ring = cell line.</p>
      {LAYER_KINDS.map((k) => <LayerRow key={k} k={k} doc={doc} />)}
    </div>
  )
}

function LayerRow({ k, doc }: { k: LayerKind; doc: Doc }) {
  const l = doc.layers[k]
  const f = doc.fields.find((x) => x.id === l.fieldId)
  const numeric = f?.type === 'number'
  const usesRamp = numeric && k !== 'label' && k !== 'hatch' && k !== 'bar'
  const allowed = doc.fields.filter((x) => (k === 'shade' || k === 'bar' ? x.type === 'number' : true))
  return (
    <div className={'layer' + (l.visible ? '' : ' off')}>
      <div className="layer-head">
        <button className={'eye' + (l.visible ? ' on' : '')} title="Toggle visibility" onClick={() => setLayer(k, { visible: !l.visible })}>{l.visible ? '◉' : '○'}</button>
        <span className="layer-name">{LAYER_INFO[k]}</span>
        <select value={l.fieldId ?? ''} onChange={(e) => setLayer(k, { fieldId: e.target.value || null, visible: !!e.target.value })}>
          <option value="">— none —</option>
          {allowed.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      {(numeric && k !== 'label' && k !== 'hatch') && (
        <div className="layer-opts">
          <select value={l.scale} onChange={(e) => setLayer(k, { scale: e.target.value as 'linear' | 'log' })}>
            <option value="linear">Linear</option><option value="log">Log</option>
          </select>
          {usesRamp && k !== 'shade' && (
            <>
              <select value="" onChange={(e) => e.target.value && setLayer(k, { ramp: RAMPS[e.target.value] })}>
                <option value="">Ramp…</option>
                {Object.keys(RAMPS).map((r) => <option key={r}>{r}</option>)}
              </select>
              <div className="ramp" style={{ background: `linear-gradient(90deg, ${l.ramp.join(',')})` }} />
              {l.ramp.map((c, i) => (
                <ColorSwatch key={i} color={c} size={14} onChange={(nc) => setLayer(k, { ramp: l.ramp.map((x, j) => (j === i ? nc : x)) })} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function StylePanel() {
  const st = useStore((s) => s.doc.style)
  const name = useStore((s) => s.doc.name)
  const row = (label: string, el: ReactNode) => <div className="form-row"><label>{label}</label><div>{el}</div></div>
  const num = (k: 'wellSize' | 'gap' | 'fontSize' | 'labelSize', min: number, max: number) => (
    <div className="slider">
      <input type="range" min={min} max={max} value={st[k]} onChange={(e) => setStyle({ [k]: +e.target.value })} />
      <input type="number" min={min} max={max} value={st[k]} onChange={(e) => setStyle({ [k]: Math.max(min, Math.min(max, +e.target.value || min)) })} />
    </div>
  )
  const color = (k: 'background' | 'plateColor' | 'emptyColor' | 'outline') => <ColorSwatch color={st[k]} onChange={(c) => setStyle({ [k]: c })} size={20} />
  const check = (k: 'showHeaders' | 'showTitle' | 'showLegend' | 'transparent', label: string) => (
    <label className="check"><input type="checkbox" checked={st[k]} onChange={(e) => setStyle({ [k]: e.target.checked })} />{label}</label>
  )
  return (
    <div className="style-panel">
      <Section title="Project">
        {row('Name', <input value={name} onChange={(e) => coalesced('Rename project', (d) => { d.name = e.target.value })} />)}
      </Section>
      <Section title="Wells">
        {row('Shape', (
          <div className="seg">
            {(['circle', 'square'] as const).map((s) => <button key={s} className={st.wellShape === s ? 'on' : ''} onClick={() => setStyle({ wellShape: s })}>{s === 'circle' ? '● Round' : '■ Square'}</button>)}
          </div>
        ))}
        {row('Size', num('wellSize', 8, 140))}
        {row('Spacing', num('gap', 0, 40))}
        {row('Label size', num('labelSize', 5, 30))}
      </Section>
      <Section title="Text & legend">
        {row('Font', (
          <select value={st.font} onChange={(e) => setStyle({ font: e.target.value })}>
            {['Arial, Helvetica, sans-serif', 'Helvetica, Arial, sans-serif', 'Inter, Arial, sans-serif', '"DejaVu Sans", sans-serif', '"Times New Roman", serif', '"Courier New", monospace'].map((f) => <option key={f} value={f}>{f.split(',')[0].replace(/"/g, '')}</option>)}
          </select>
        ))}
        {row('Font size', num('fontSize', 7, 32))}
        <div className="checks">{check('showTitle', 'Title')}{check('showHeaders', 'Row/col headers')}{check('showLegend', 'Legend')}</div>
        {row('Legend', (
          <div className="seg">
            {(['right', 'bottom'] as const).map((s) => <button key={s} className={st.legendPos === s ? 'on' : ''} onClick={() => setStyle({ legendPos: s })}>{s}</button>)}
          </div>
        ))}
      </Section>
      <Section title="Colors">
        {row('Background', <div className="inline">{color('background')}{check('transparent', 'Transparent')}</div>)}
        {row('Plate body', color('plateColor'))}
        {row('Empty well', color('emptyColor'))}
        {row('Outline', color('outline'))}
      </Section>
    </div>
  )
}

function History() {
  const history = useStore((s) => s.history)
  const index = useStore((s) => s.index)
  return (
    <div className="history">
      <p className="hint">Click any step to go back. New edits after going back discard the greyed steps.</p>
      {history.map((h, i) => (
        <div key={i} className={'hist' + (i === index ? ' cur' : '') + (i > index ? ' future' : '')} onClick={() => jumpTo(i)}>
          <span className="hist-dot" />
          <span className="hist-label">{h.label}</span>
          <span className="hist-time">{new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )).reverse()}
    </div>
  )
}

// ================= validation =================
export interface Issue { level: 'error' | 'warn' | 'info'; plateId: string; msg: string; wells: string[] }

let lastDoc: Doc | null = null, lastIssues: Issue[] = []
export function runChecks(doc: Doc): Issue[] {
  if (doc === lastDoc) return lastIssues
  const role = (r: string) => doc.fields.find((f) => f.role === r)
  const tr = role('treatment'), dose = role('dose'), ctrl = role('control'), cell = role('cell')
  const out: Issue[] = []
  const names = new Map<string, number>()
  doc.plates.forEach((p) => names.set(p.name, (names.get(p.name) ?? 0) + 1))
  for (const p of doc.plates) {
    const filled = Object.keys(p.wells).filter((w) => hasData(p.wells[w]))
    if (!filled.length) continue
    if ((names.get(p.name) ?? 0) > 1) out.push({ level: 'error', plateId: p.id, msg: `Duplicate plate name "${p.name}"`, wells: [] })
    const has = (w: string, f?: Field) => !!f && p.wells[w]?.[f.id] !== undefined
    if (ctrl) {
      // A well is a control if the Control field is set, or any field says "Control" (e.g. treatment_group).
      const cw = filled.filter((w) => has(w, ctrl) || Object.values(p.wells[w]).some((v) => typeof v === 'string' && /^control$/i.test(v)))
      if (!cw.length) out.push({ level: 'warn', plateId: p.id, msg: 'No control wells on this plate', wells: [] })
      else {
        const rows = new Set(cw.map((w) => parseWell(w)![0])), cols = new Set(cw.map((w) => parseWell(w)![1]))
        if (cw.length >= 4 && (rows.size < Math.min(p.rows / 2, cw.length) || cols.size < Math.min(p.cols / 2, cw.length)))
          out.push({ level: 'info', plateId: p.id, msg: `Controls cluster in ${rows.size} row(s) / ${cols.size} column(s) — positional bias risk`, wells: cw })
        if (cw.some((w) => isEdge(p, w))) out.push({ level: 'info', plateId: p.id, msg: 'Some controls sit on edge wells', wells: cw.filter((w) => isEdge(p, w)) })
      }
    }
    if (tr && dose) {
      const noDose = filled.filter((w) => has(w, tr) && !has(w, dose) && !has(w, ctrl))
      if (noDose.length) out.push({ level: 'warn', plateId: p.id, msg: `${noDose.length} treated well(s) without ${dose.name}`, wells: noDose })
      const noTr = filled.filter((w) => has(w, dose) && !has(w, tr))
      if (noTr.length) out.push({ level: 'warn', plateId: p.id, msg: `${noTr.length} well(s) with ${dose.name} but no ${tr.name}`, wells: noTr })
    }
    if (tr) {
      const edge = filled.filter((w) => has(w, tr) && isEdge(p, w))
      if (edge.length) out.push({ level: 'info', plateId: p.id, msg: `${edge.length} treated well(s) on plate edge (evaporation/edge effect)`, wells: edge })
    }
    for (const f of doc.fields) {
      if (!f.derive || (!Object.keys(f.derive.map).length && !filled.some((w) => has(w, f)))) continue
      const src = doc.fields.find((x) => x.id === f.derive!.from)
      const miss = filled.filter((w) => typeof p.wells[w][f.derive!.from] === 'string' && !has(w, f))
      if (src && miss.length) {
        const unknown = [...new Set(miss.map((w) => String(p.wells[w][src.id])))]
        out.push({ level: 'warn', plateId: p.id, msg: `${f.name} unknown for ${src.name}: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? '…' : ''} (set it once, or map it in the field settings)`, wells: miss })
      }
    }
    if (cell && filled.some((w) => has(w, cell))) {
      const miss = filled.filter((w) => !has(w, cell))
      if (miss.length) out.push({ level: 'warn', plateId: p.id, msg: `${miss.length} filled well(s) without ${cell.name}`, wells: miss })
    }
  }
  lastDoc = doc; lastIssues = out
  return out
}

function Checks() {
  const doc = useStore((s) => s.doc)
  const issues = runChecks(doc)
  if (!issues.length) return <div className="empty-state"><div className="big ok">✓</div><p>No issues found.</p></div>
  return (
    <div className="checks-list">
      {issues.map((x, i) => (
        <div key={i} className={'issue ' + x.level} onClick={() => { setUI({ plateId: x.plateId }); select(x.wells) }}>
          <span className="issue-icon">{x.level === 'error' ? '⛔' : x.level === 'warn' ? '⚠' : 'ℹ'}</span>
          <div><div>{x.msg}</div><small>{doc.plates.find((p) => p.id === x.plateId)?.name}{x.wells.length ? ' · click to select' : ''}</small></div>
        </div>
      ))}
    </div>
  )
}
