# Seeding density optimisation

**Goal:** find the best seeding density for HepG2 and Huh7 on a 24-well plate before a screen. Six densities from 5,000 to 160,000 cells/well, two replicate rows per cell line.

<figure markdown="span">
  ![Seeding layout](../assets/screens/ex-seeding-24.png){ .shot width="720" }
  <figcaption>Fill = seeding density (Viridis, log); ring = cell line; label = density.</figcaption>
</figure>

## Steps

1. **New project → 24-well.**
2. **Cell lines:** select rows A–B → `HepG2`, rows C–D → `Huh7`.
3. **Densities:** select A1:D6 and run **Serial dilution** with *Field* = **Seeding density**, top dose `160000` (cells/well), factor `2`, *Across rows*, and **High → low unticked** so density rises left to right.
4. **Layers:** Fill = Seeding density with the **Viridis** ramp, **Log** scale; Fill intensity off; Ring = Cell line; Text label = Seeding density. Increase **Label size** in the Figure tab so the numbers fit.

!!! info "Serial dilution works on any number field"
    Use it for seeding gradients, serum percentages, MOI titrations or time courses, not just compound doses.
