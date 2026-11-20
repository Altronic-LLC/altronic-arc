import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import type { LayoutComponent, PlantAreaKind } from "@/types/plant";
import { PLANT_AREA_KIND_LABELS } from "@/types/plant";
import { feetLabel } from "@/lib/plantGeometry";
import { removeKeepouts, type WallsDrawing } from "@/lib/plantSvg";
import { keepoutsToAreas, type DrawingReview, type KeepoutChoice } from "@/lib/plantDrawingReview";
import { cn } from "@/lib/cn";
import { PlantCanvas } from "./PlantCanvas";

// =============================================================================
// The New layout form's review of an uploaded walls drawing (rules in
// lib/plantDrawingReview.ts): a preview with what ARC found highlighted, any
// warnings, the size to confirm, and the drawing's keep-outs — each ticked one
// comes off the drawing and becomes an editable aisle or no-go area on the
// layout. Controlled: the form holds the choices and the confirmation, and
// does the conversion on Start.
// =============================================================================

const NO_COMPONENTS: ReadonlyMap<number, LayoutComponent> = new Map();
const KINDS: PlantAreaKind[] = ["aisle", "no-go"];

interface PlantDrawingReviewProps {
  drawing: WallsDrawing;
  review: DrawingReview;
  choices: KeepoutChoice[];
  onChoicesChange: (next: KeepoutChoice[]) => void;
  sizeConfirmed: boolean;
  onSizeConfirmedChange: (next: boolean) => void;
  disabled?: boolean;
}

export function PlantDrawingReview({
  drawing,
  review,
  choices,
  onChoicesChange,
  sizeConfirmed,
  onSizeConfirmedChange,
  disabled,
}: PlantDrawingReviewProps) {
  const converted = useMemo(() => new Set(choices.filter((c) => c.convert).map((c) => c.id)), [choices]);
  // What the layout will start as: the drawing without the ticked keep-outs, and those as areas.
  const previewSvg = useMemo(() => removeKeepouts(drawing.svg, converted), [drawing.svg, converted]);
  const previewAreas = useMemo(() => keepoutsToAreas(choices), [choices]);
  const found = useMemo(() => drawing.obstacles.filter((o) => !converted.has(o.id)), [drawing.obstacles, converted]);
  const kept = choices.length - converted.size;

  const patch = (id: string, next: Partial<KeepoutChoice>) =>
    onChoicesChange(choices.map((c) => (c.id === id ? { ...c, ...next } : c)));
  const setAll = (convert: boolean) => onChoicesChange(choices.map((c) => ({ ...c, convert })));

  return (
    <section aria-label="Review the drawing" className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-3">
      <p className="text-xs text-fg-muted" data-testid="walls-summary">
        {review.sizeLabel} · {review.walls} wall{review.walls === 1 ? "" : "s"}, {review.columns} column
        {review.columns === 1 ? "" : "s"}, {choices.length} keep-out area{choices.length === 1 ? "" : "s"}
      </p>

      <PlantCanvas
        title="Walls drawing preview"
        extent={drawing.extent}
        wallsSvg={previewSvg}
        items={[]}
        areas={previewAreas}
        components={NO_COMPONENTS}
        found={found}
        height="36vh"
        wheelZoom={false}
      />
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-muted">
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400/70 align-middle" />
          Walls and columns ARC checks against
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-gray-500 align-middle" />
          Keep-outs staying in the drawing
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-blue-500/40 align-middle" />
          Editable aisles and no-go areas
        </span>
      </p>

      {review.warnings.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-md border border-ajax-yellow/50 bg-ajax-yellow/10 p-2.5" aria-label="Drawing warnings">
          {review.warnings.map((w) => (
            <li key={w} className="flex items-start gap-2 text-xs text-fg">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ajax-yellow" />
              {w}
            </li>
          ))}
        </ul>
      )}

      <label className="flex items-start gap-2 text-sm font-medium text-fg">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={sizeConfirmed}
          onChange={(e) => onSizeConfirmedChange(e.target.checked)}
          disabled={disabled}
        />
        <span>
          The building is {review.sizeLabel}
          <span className="block text-xs font-normal text-fg-muted">
            Every symbol is drawn to scale against this, so a wrong size makes every machine the wrong size.
          </span>
        </span>
      </label>

      {choices.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Keep-outs in the drawing</h3>
            <span className="flex gap-3 text-xs">
              <button type="button" onClick={() => setAll(true)} disabled={disabled} className="text-accent hover:underline">
                Make all editable
              </button>
              <button type="button" onClick={() => setAll(false)} disabled={disabled} className="text-accent hover:underline">
                Keep all in the drawing
              </button>
            </span>
          </div>
          <p className="text-xs text-fg-muted">
            Ticked ones come off the drawing and start as aisles and no-go areas on this layout, which you can move,
            resize and relabel. Unticked ones stay in the drawing and can't be changed in ARC
            {kept > 0 ? ` (${kept} staying)` : ""}. Door swings stay by default — they go with their doors.
          </p>
          <ul className="flex max-h-56 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border bg-surface">
            {choices.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5" data-keepout={c.id}>
                <input
                  type="checkbox"
                  checked={c.convert}
                  onChange={(e) => patch(c.id, { convert: e.target.checked })}
                  disabled={disabled}
                  aria-label={`Make ${c.label} editable`}
                />
                <input
                  value={c.label}
                  onChange={(e) => patch(c.id, { label: e.target.value })}
                  disabled={disabled || !c.convert}
                  aria-label={`Label for ${c.id}`}
                  className="select h-8! w-44! py-0! text-sm"
                />
                <span className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label={`Kind for ${c.id}`}>
                  {KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={c.kind === k}
                      onClick={() => patch(c.id, { kind: k })}
                      disabled={disabled || !c.convert}
                      className={cn(
                        "px-2 py-1 text-xs font-medium disabled:opacity-50",
                        // The colour each kind has on the plan: aisles blue, no-go areas red.
                        c.kind === k
                          ? k === "aisle"
                            ? "bg-superior-blue text-white"
                            : "bg-cooper-red text-white"
                          : "text-fg-muted hover:bg-surface-2",
                      )}
                    >
                      {PLANT_AREA_KIND_LABELS[k]}
                    </button>
                  ))}
                </span>
                <span className="ml-auto text-[11px] tabular-nums text-fg-muted">
                  {c.detail || "keep-out"} · {feetLabel(c.w)} × {feetLabel(c.d)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
