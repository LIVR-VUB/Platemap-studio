# Saving & importing

## Projects

A project holds all plates, fields, colors, layers, figure style and export settings in one `.platemap` file (readable JSON).

| Action | How |
|---|---|
| Save | **File → Save project** (++ctrl+s++) |
| Save under a new name | **File → Save project as…** (++ctrl+shift+s++) |
| Open | **File → Open project…** (++ctrl+o++), or double-click a `.platemap` file |
| New | **File → New project…** (++ctrl+n++) |

A **●** next to the project name in the title bar means there are unsaved changes.

## Autosave

The app saves your work in the background after **every edit**. If it closes unexpectedly, choose **Continue last session** on the start screen to pick up where you left off.

!!! tip
    Autosave covers crashes and accidental closes. Still save `.platemap` files to share projects or keep versions.

## Importing tables

**File → Import table / platemap (CSV/TSV)…** reads a well-by-well table and adds it as new plate(s). It understands:

- **pycytominer platemaps:** `WellRow, WellCol, well_position, …`
- **This app's CSV export:** `plate, well, row, column, …`
- **Exports from the old Streamlit plate map tool,** including `*_color` columns (colors are kept) and `*_units` columns.
- Any table with a **`well`** (A1 or A01) or **`well_position`** column, or **WellRow + WellCol**.

What happens on import:

1. **Plates:** a `plate` / `plate_map_name` column splits rows into plates. Without one, the **file name** becomes the plate name (`platemap_NF1_plate19.csv` → plate `NF1_plate19`).
2. **Format:** the smallest standard format that fits the wells is chosen.
3. **Columns** are matched to existing fields by export name, field name or common synonyms (`celltype` → Cell line, `treatment` → Compound, `concentration`/`dose` → Concentration…). Unknown columns become new fields that keep the exact header.
4. **Values with units** (`10ng/ml`, `1uM`) are split into number and unit.
5. **Vehicle, compound class and treatment group** mappings are learned from the file, ready for [auto-fill](../advanced/auto-fill.md).
6. For pycytominer platemaps, the **header becomes the export template**, so exporting gives back exactly the same columns.

See the worked example: [Bringing in existing platemaps](../examples/existing-platemaps.md).

## Exporting data

| Menu item | Output |
|---|---|
| **Export platemap (pycytominer)…** | Your exact column layout, one file per plate, plus `barcode_platemap.csv`. See [Platemap export](../advanced/platemap-export.md) |
| **Export data: CSV (all wells)** | One row per well on every plate, including empty wells |
| **Export data: CSV (filled wells)** | Same, only wells with data |
| **Export figure…** | PDF / SVG / PNG. See [Figure export](../advanced/figure-export.md) |
