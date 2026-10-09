# File formats

## `.platemap` (project)

A JSON file holding the whole project: plates, well values, fields (including colors, units and auto-fill mappings), layers, figure style and platemap export settings. Being plain text, it works well with version control and can be inspected with any JSON tool.

```json
{
  "version": 1,
  "name": "Dose-response demo",
  "plates": [
    { "id": "p1", "name": "Plate 1", "rows": 8, "cols": 12, "barcode": "BR00123456",
      "wells": { "B3": { "cell": "HepG2", "compound": "Staurosporine", "conc": 1 },
                 "B4": { "cell": "HepG2", "compound": "TGF", "conc": 10, "conc@unit": "ng/ml" } } }
  ],
  "fields": [ { "id": "conc", "name": "Concentration", "type": "number", "unit": "µM", "role": "dose", "exportName": "concentration" } ]
}
```

A well-level `"<field>@unit"` key stores a unit that differs from the field's default.

## Platemap CSV (pycytominer)

One row per well with data, columns as configured. Default:

```csv
WellRow,WellCol,well_position,celltype,treatment,concentration,vehicle,compound_class,treatment_group
```

- `well_position` is zero-padded (`B02`).
- Numbers include their unit (`10ng/ml`, `1uM`); vehicle is a plain `0`.
- File name: `platemap_<plate>.csv` (pattern editable).

## `barcode_platemap.csv`

```csv
Assay_Plate_Barcode,Plate_Map_Name
BR00123456,platemap_CP_screen_01
```

## Data CSV

**File → Export data: CSV**: one row per well on every plate.

```csv
plate,well,row,column,Cell line,Compound,Concentration (µM),…
Plate 1,B3,B,3,HepG2,Staurosporine,1,…
```

## Import

Recognized well columns: `well`, `well_position`, `Metadata_Well`, or `WellRow` + `WellCol`. Plate columns: `plate`, `plate_map_name`, `Metadata_Plate`. Delimiter (comma or tab) is detected automatically. See [Saving & importing](../user-guide/saving-and-importing.md#importing-tables).

## Figures

| Format | Details |
|---|---|
| PDF | Vector, one page per plate, page size fitted to the figure |
| SVG | Vector, fonts as text, editable in Illustrator/Inkscape |
| PNG | Raster at 150–1200 dpi with the DPI recorded in the file |
