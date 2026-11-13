# QC Forms in Arc – Digitization Roadmap

Oct 28, 2026 · Tim Webster. Trimmed copy of the Claude Doc "QC Forms in Arc – Digitization Roadmap" for this repository: local file paths and customer names are left out. The doc is the source of truth; refresh this copy when it changes.

## Summary

About 60 unit QC forms remain after merging duplicates, and three templates cover all of them. Build a reusable form engine from the CPU-95 code first, then add forms in batches, highest volume and simplest first.

- **What was reviewed:** every blank form in the Forms library, filled 2024–2025 scans from 36 archive folders, and the CPU-95 (QCFRM-012) build in Arc.
- **Why the engine first:** CPU-95 is 12–15 files per form (fields, mapper, API, hooks, list page, form, sheet layout, PDF, tests, column JSON, list script). Copying that 60 times is the main cost risk. Most pieces are already descriptor-driven, so they can be made shared.
- **Fresh start:** none of these forms has old data to migrate, so no migration scripts, legacy columns or blank-vs-No questions.
- Volume figures are rough: scanned pages estimated from file sizes, not unit counts.

## Decisions (settled)

| # | Decision | Outcome | Notes |
| --- | --- | --- | --- |
| 1 | Engine before form #2, or keep cloning CPU-95 | Engine first | 12–15 files per form × ~60 forms. CLAUDE.md's "nothing is shared beyond the registry" note will change. |
| 2 | One SharePoint list per form, or one shared list | One list per form on PMO, built from each form's column JSON by one generic script | Keeps real columns for filtering and reporting. Generalizes `create-qc-cpu95-pmo-list.ps1`. |
| 3 | PDF export | Every form gets the CPU-95-style export that reproduces its paper sheet, blank and filled | The per-form sheet layout is the largest per-form cost, so the engine makes it as cheap as possible. |
| 4 | Log sheets | One record per unit; the list view is the log, the export prints the multi-unit grid | Search by serial number, report per unit. |
| 5 | Dormant forms | Tim to review; they stay last (Phase 7) | 30+ forms have no 2024–2025 scans. |
| 6 | Firing-angle actuals (CIS, TEM, CPU-2000) | Same as CPU-95: "all actuals at spec", and an actual is filled in for any cylinder not at spec | Every filled sample writes "@ spec" across the Actual column. |
| 7 | Header entry | Scan the Altronic barcode label (SAP#, ALT#, S/N) with the CPU-95 Enter-as-Tab order | Operators stick the label over the P/N and S/N boxes on almost every sheet. |
| 8 | Form numbers and revisions | Use each form's current name in document control for now; revisit when document control comes into Arc | Arc document control could then link form names and revs to the digital forms. |

## The form engine

Three templates, built from shared blocks, cover every form in scope. A new form should be a column JSON, a field descriptor file, a registry entry and a sheet layout for its paper export.

**Every form keeps all of CPU-95's behaviour.** The engine is a refactor of CPU-95, not a lighter version of it:

- Paper-replica PDF export, blank and filled, including a blank for one variant
- Barcode scan into the header, with Enter moving to the next field and never saving
- Part-number variants that show, hide and reword fields live as the P/N is typed
- Pre-filled specs per part number that never overwrite a typed value
- Status lights (In Queue, In Process, In Repair, Complete) and the status-grouped sort
- Saved drafts, no delete (correct with an edit), and the mobile card/table split
- Only the fields the unit shows reach paper; long text continues on an extra page rather than being cut

| Template | Shape | Forms (examples) | Count |
| --- | --- | --- | --- |
| A. Unit test sheet | One record per unit; sections of checks and measurements with spec limits; part-number variants show or hide fields | IPMD, TEM, DISN/CEC, NGI-5000, Alt III, Alt V, CPU-2000, CIS | ~20 |
| B. Checklist | Header + Yes/No/N/A item list + sign-off; per unit or per production order | GET, Series X and GEM log sheets, GEW G2, SAFI2 and other QAFRM checklists, QCFRM-038 to 041, Moris, Panel QC | ~31 |
| C. Unit log | One record per unit, listed as a running log; the export prints the multi-unit grid | WCD-10/11, CD1, CD200, 24V alternator, CCD6 power supply, PLC+ MAC logs | ~10 |

**Shared blocks to pull out of CPU-95:**

- **Altronic header:** board date codes, Altronic P/N, S/N, SAP#, customer, invoice, test stand, date tested. Scan order and Enter-as-Tab come straight from CPU-95.
- **Check item:** Yes / No / N/A, where blank means not answered. Operators already handwrite N/A on GET-family sheets that have no N/A box.
- **Measurement:** a number with a spec low/high and an out-of-spec flag.
- **Temperature pass:** the same block repeated at initial (23–25°C) and final (60–75°C). Used by IPMD, DISN/CEC, TEM, CIS, NGI, WCD, CCD6.
- **Burn-in log:** oven ON/OFF date-times (CPU-95's datetime kind).
- **Firing-angle grid:** spec/actual by cylinder with "all at spec"; CW/CCW deviation mode for Alt III and Alt V.
- **Variants by part number:** CPU-95's `only` / `hiddenIn` / `labelIn` rules, plus pre-filled specs per part number.
- **Module table:** S/N, P/N and firmware per module, for Panel QC and the GET-family board work-order grids.
- **Sign-off:** final test by, final inspection by, date, comments. No delete; correct with an edit.
- **Status and list:** In Queue / In Process / In Repair / Complete, and the mobile card/table split.
- **Export:** one shared renderer (today's `qcFormPdf.ts`) draws any form's sheet layout. Each form supplies only its layout in pixels of its scanned blank. Forms in the same family (the GET / GEM / Series X sheets, the Yes/No checklists, the logs) share one parameterized layout, so most forms add layout data, not layout code. The GE family's is `qcGeLogSheet.ts` (GET-1 first): a form describes its title, checks, board work orders and footer as data.

## Phased roadmap

Phase 0 builds the engine; phases 1–3 are where the scans show the volume, so they come first. Phases 4–7 can be reordered once the three templates exist.

0. **Form engine, pulled out of CPU-95.** Generic list, form, API, list script and paper export, driven by column JSON, descriptors and a sheet layout. *Gate: the pilot ships with full CPU-95 behaviour, paper export included, and no form-specific code.* **Done 2026-10-23** (v0.202.1).
1. **GET checklist family (template B).** GET-1 (pilot), Series X QCFRM-035, GEM-1, GEM-2, GEW G2 REPFRM-042, ActucomSG, GET-2. *Gate: the GET-family sheets run in Arc with no paper copy.* **In progress:** GET-1 built 2026-10-26 (v0.203.0) at /qc-forms/get-1, with the first family layout, the GE log sheet (`qcGeLogSheet.ts`); its PMO list was created and the repo variable set on 26 Oct. Operations later said they don't do many GET-1s and haven't in the last couple of weeks; Series X is the larger group. Series X QCFRM-035 built 28 Oct (v0.207.0) at /qc-forms/series-x, on the same GE log sheet; its PMO list was created and the repo variable set on 28 Oct. Next by volume: GEW G2 REPFRM-042.
2. **High-volume unit test sheets (template A).** IPMD QCFRM-015, TEM QCFRM-016, CEC/DISN QCFRM-010, NGI-5000 QCFRM-037. Adds temperature passes, burn-in log, firing grid. *Gate: the test-sheet template handles two temperature passes and part-number variants.*
3. **Altronic variant sheets (template A).** Alt III QCFRM-002 with NG, Alt V QCFRM-001 + 032 merged, CPU-2000 QCFRM-013 and 017, CIS QCFRM-011. *Gate: variant tables agreed with operations.*
4. **Unit logs (template C).** WCD-10/11 log, CD1 / CDI 791 log, CD200 log.
5. **QA and production checklists (template B).** SAFI2 QAFRM-002, QAFRM-020, 003, 007, 014, 024, QCFRM-038 to 041, Moris, CPU-2000 diag QCFRM-014.
6. **Panel QC (template B + module table).** Final/functional pairs for 5812-013, DE-3000, DE-4000, FLEX VHP, AFR-500; PQF-011 readings. Rework links to Panel QC Issues.
7. **Dormant forms, confirm before building.** IPMD2, NGI-1000, WCD-20, CCD6, Gov 10/50, AGV5, QCFRM-034, Alt II DC, CPU-II, CPU-III, small logs, PLC+.

## Form inventory

"None" means no 2024–2025 scans in the archive copy. Size is relative to CPU-95 (XL).

| Form | Product | Template | 2024–25 scans | Size | Phase |
| --- | --- | --- | --- | --- | --- |
| QCFRM-012 | CPU-95 ignition module | A | in Arc | XL | Done |
| QCFRM-035 | Series X controller | B | 542 pp 2024, 441 pp 2025 | S | 1 — built, list created |
| GET-1 | GET controller | B | ~75 pp 2024, ~135 pp 2025; few lately | S | 1 (pilot) — built, list created |
| GEM-1 | GEM ECU | B | 32 pp 2024, plus 2025 | S | 1 |
| GEM-2 | GEM SFU | B | 24 pp 2024, plus 2025 | S | 1 |
| REPFRM-042 | GEW G2 final inspection | B | ~660 pp 2024, ~550 pp 2025 | M | 1 |
| ActucomSG | ActucomSG visual inspection | B | none | S | 1 |
| GET-2 | GET returned units | B | none | S | 1, if returns are in scope |
| QCFRM-015 | IPMD | A | ~750 pp 2024, ~1,300 pp 2025 | M | 2 |
| QCFRM-010 | CEC-800, DISN-800/801 | A | ~850 pp 2024, ~260 pp 2025 | M | 2 |
| QCFRM-016 | TEM (903-2, ZS2 TEM20) | A | ~800 pp 2024, ~500 pp 2025 | M | 2 |
| QCFRM-037 | NGI-5000 logic module | A | ~620 pp 2025 | M | 2 |
| QCFRM-002 | Altronic III (44 variants, plus NG) | A | ~460 pp 2024 | L | 3 |
| QCFRM-001 + 032 | Altronic V and V NG (merge) | A | ~600 pp 2024 | M–L | 3 |
| QCFRM-013 | CPU-2000 output module | A | in CPU 2000 folder | L | 3 |
| QCFRM-017 | CPU-2000 logic module | A | ~420 pp in 2024 folder (sheets dated 2023) | L | 3 |
| QCFRM-011 | CIS | A | 10 pp 2025 | M–L | 3 |
| No number | WCD-10/11 log (791061-1/-2) | C | ~28 pp 2024 (~14 units/pp), 7 pp 2025 | M | 4 |
| No number | CD1 / CDI 791 log | C | 13 pp 2024, more in 2025 (~19 units/pp) | S–M | 4 |
| No number | CD200 log | C | 8 pp 2024 (~19 units/pp) | M | 4 |
| QAFRM-002 | SAFI2 final inspection (per PO) | B | ~265 pp 2024 | M | 5 |
| QAFRM-020 | MPM final (per PO) | B | none | M | 5 |
| QAFRM-003 | EX-200 board final | B | none | M | 5 |
| QAFRM-007 | CCD6 pre/post-test inspection | B | none | S | 5 |
| QAFRM-014 | HV harness rail | B | none | S | 5 |
| QAFRM-024 | 810080 sensor adapter housing | B | none | S | 5 |
| QCFRM-038 to 041 | Cable, eSuppressor and TEM micro checklists (per PO) | B | none | S | 5 |
| 79120X-1, 79121X-1 | Moris 1 and 2 final | B | none | S | 5 |
| QCFRM-014 | CPU-2000 diagnostic module (fold in 020) | B | none | S | 5 |
| PQF-001/002 | 5812-013 panel functional / final | B | none | S / M | 6 |
| PQF-004 (+005) | DE-3000 panel | B | none | M | 6 |
| PQF-006/007 | DE-4000 panel final / functional | B | none | M / S | 6 |
| PQF-012/013 | FLEX VHP panel final / functional | B | none | M / S | 6 |
| PQF-014/015 | AFR-500 panel functional / final | B | none | S / M | 6 |
| PQF-011 | 5900C electrical observations | A | none | M | 6 |
| PQF-009 | Unknown (rights-protected file) | ? | none | ? | 6, once readable |
| QCFRM-019 | IPMD2 (791971-16) | A | none | L | 7 |
| QCFRM-030 | NGI-1000 | A | none | M | 7 |
| QCFRM-021 | WCD-20 | A | none | S–M | 7 |
| QCFRM-028 | CCD6 ignition | A | none | M | 7 |
| QCFRM-003 | Gov 10/50 final test | A | none | L | 7 |
| QCFRM-004 | AGV5 gas valve | A | none | S | 7 |
| QCFRM-034 | 691074 timing indicator + CoC | A | none | S | 7 |
| QCFRM-009 | Altronic II DC converter | A | none | S | 7 |
| QCFRM-006 | CPU-II | A | none | L | 7 |
| QCFRM-007 | CPU-III | A | none | M | 7 |
| QCFRM-018 | 24V alternator log | C | none | S | 7 |
| QCFRM-029 | CCD6 power supply log | C | none | S | 7 |
| QCFRM-027 | CIM test log | C | none | S | 7 |
| QCFRM-031 | GPN test log | C | none | S | 7 |
| QCFRM-036 | Secondary potting log | C | none | S | 7 |
| QCFRM-022 to 026 | PLC+ MAC logs (VSM+, MOD+, DE3000+, DET+, SPEED+) | C | none | S | 7 (one form) |
| DL500-EX | DL500-EX test log | C | none | S | 7 |

## Findings and cleanup

- [ ] WCD-10/11, CD1 and CD200 logs have no form number and no blank in the library. The WCD scans are a "QC FORM WCD-10 TS Rev 10/14" log, not QCFRM-021 (WCD-20). Numbering waits for document control in Arc (decision 8).
- [ ] Altronic III NG has no variant sheet. Testers cross out the cover P/N on QCFRM-002 and write the 381815-xx NG number in.
- [ ] QCFRM-032 (Alt V NG) is half-adopted. About half the 2024 NG units are on QCFRM-001 with "NG" handwritten. Merge 001 and 032 into one digital form with NG variants.
- [ ] QCFRM-020 duplicates QCFRM-014 (291105-2 sheet). Retire 020.
- [ ] ActucomSG checklist's footer reads REPFRM-0042 Rev 2, which clashes with GEW G2 (REPFRM-0042 Rev 10).
- [ ] Scanned sheets carry old numbers and revs: CEC "QC FRM 25 3/01", DISN "Rev 10/96", TEM 2024 on Rev 1, NGI-5000 on a "QCFRM-xxx Rev 0" draft.
- [ ] PQF-005 and PQF-009 are rights-protected (Microsoft RMS) and need exporting by someone with access.
- [ ] QCFRM-034 has calibration due dates printed on the form; those should come from equipment data.
- [ ] QCFRM-040's header says 672340-2 but the column says -1.
- [ ] The Forms library's QC index workbook is out of date (omits PanelQC and QAForms; QCFRM-013's blank is a differently named workbook).
- [ ] GET-1 Rev 3 prints "681 105-2 WO#", but operators correct it to 105-3 by hand on nearly every 2025 sheet. Arc records 105-3 (Tim, 2026-10-26); the form needs revising. Its "(2 WO#'s per board)" note also doesn't match its one blank per board.
- [ ] QCFRM-035 Rev 0 prints "681 105-2 WO#" too. Series X sheets use 105-2 as printed into early 2025, then operators correct it to 105-3 by hand from about mid-2025. Arc records 105-3, as on GET-1; the form needs revising.
- [ ] QCFRM-035's fifteen checks are word for word GET-1's; Arc shares them between the two forms. A revision to either form's checks should say whether the other changes too.
- [ ] GET-1 volume is lower than the archive suggested: operations say few have been done lately, and Series X is the larger group.
- [ ] GET-1 sheets carry hand marks with no field: a circled D (Deviation, often "Flange"), a circled F, and "Tested" / "SFI". Arc puts them in Notes for now.
- [ ] Comments are almost always blank and one person usually signs both test and inspection. Ask operations whether two sign-offs are still required.
