# Plant Map — roadmap and next steps

The Plant Map (Operations) draws each building's layout to scale over its walls
drawing, places the equipment on it, and checks that nothing overlaps. Later it
becomes a live map of machine status. This file tracks where it stands and what
comes next; the detailed rules are in `CLAUDE.md` under "Plant Map".

Last updated 2026-11-18, at v0.223.0.

## Who can see it

Only people on the **Plant Map Roles** list (PMO site). There is no Dashboard
card, menu row or "Coming soon" for anyone else, and a link reaching someone
not on the list says who to ask.

| Tag | Can |
|---|---|
| `viewer` | look at every layout and symbol |
| `editor` | start layouts and edit drafts |
| `admin` | everything an editor can, plus publish, delete, manage symbols and the roles list |

An ARC admin can manage the roles list (from the Admin page) and nothing else.
Rolling it out to more people is a matter of adding them to the list — no
deploy.

## Built (v0.223.0)

- **Phase 1 — data and viewing.** The three lists and the document library
  (`scripts/create-plant-map-lists.ps1`), the layouts list with a tab per
  building, the plan (pan and zoom), the placement check, roles.
- **Phase 2 — the editor.** Drag symbols from the palette, move / turn /
  resize on the plan, alignment guides, undo / redo, draw aisles and no-go
  areas with labels, Save draft. A published layout is changed through a new
  draft.
- **New layout.** Upload a walls drawing (reviewed before it's saved: size,
  warnings, keep-outs offered as editable areas) or reuse a building's drawing.
- **Symbols.** Add from SVG, DXF or a traced picture; replace (a new version —
  layouts keep theirs until updated in a draft); retire and restore; a
  collision outline drawn on the form; label symbols that write each item's
  name inside them.
- **Layers.** Items on layers and groups (e.g. Safety → extinguishers), shown
  and hidden per viewer; made, renamed and removed in the editor.
- **Phase 3 — publish.** Publish a draft (blocked while it has placement
  problems); the old version becomes Superseded. Publish writes the files for
  Power BI to `published/`: a composite SVG (element id = tag id) and a tags
  CSV.
- **Real data loaded.** Main Plant and Engineering & Sales from the CAD
  extract (`scripts/load-plant-cad-extract.ps1`), including the Safety layer
  and the area labels.

## Decisions needed

1. **Where live machine state comes from.** CMMS asset status (Down / In
   Service) first, then Fabric. This shapes Phases 4 and 5.
2. **Sign-off on the builder.** Reports are deliberately code-defined
   dashboards; the Plant Map is a builder that people edit. That difference
   needs agreeing.
3. **Must every placed machine be a CMMS asset?** Linking an item to an asset
   is optional today. Live status can only colour items that are linked.

## Next steps

| Phase | What | Depends on |
|---|---|---|
| — | **Review and use** — key people added to Plant Map Roles, feedback collected | this PR |
| 5 (first slice) | **Machine status colouring** — each linked machine coloured by its CMMS Asset Status, plus a kiosk view of the map | decisions 1 and 3 |
| 4 | **Overlays** — a Plant Overlays list; views drawn over a published layout (status, zones, heat) | decision 1 |
| 5 | **Live status from Fabric** — machine state beyond what CMMS records | decision 1 |
| 6 | **Power BI** — a report on the files Publish already writes to `published/` | nothing in ARC |

Recommended order: the status colouring first — it uses data ARC already has
and is the reason the map exists — then overlays.

## Smaller items

- **Clearance isn't checked.** Symbols carry a clearance distance, but the
  placement check doesn't apply it yet. Applying it would flag machines set
  too close together.
- **Drawing a symbol inside ARC** — shelved; a symbol is changed by replacing
  its file.
- **Hallways on Engineering & Sales** are `hallway` symbols, not aisle areas;
  swapped by hand in the editor if wanted.

## Running against the live lists

Before the first deploy (done 2026-11-18):

```
.\scripts\create-plant-map-lists.ps1 -NoSeed
.\scripts\load-plant-cad-extract.ps1 -FillLabels -Apply
```

Both are idempotent. The list ids are repo variables, passed by `deploy.yml`.
