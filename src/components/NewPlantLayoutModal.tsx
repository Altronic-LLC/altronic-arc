import { useMemo, useState } from "react";
import { FileUp, Map as MapIcon, X } from "lucide-react";
import type { NewPlantLayoutInput, PlantLayout } from "@/types/plant";
import { buildingSource } from "@/lib/plantLayoutDoc";
import { MAX_WALLS_SVG_BYTES, readWallsSvg, removeKeepouts, type WallsDrawing } from "@/lib/plantSvg";
import { feetLabel } from "@/lib/plantGeometry";
import { keepoutsToAreas, reviewWallsDrawing, type KeepoutChoice } from "@/lib/plantDrawingReview";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { cn } from "@/lib/cn";
import { SuggestInput } from "./SuggestInput";
import { PlantDrawingReview } from "./PlantDrawingReview";

// =============================================================================
// Start a plant layout: its building (an existing one, or a new name — which
// starts a new building and its own tab), a name, an area, and the walls
// drawing.
//
//   * An EXISTING building reuses the drawing its layouts already have
//     (`buildingSource`: its published layout, else its newest), so nothing
//     is uploaded and the library doesn't fill with copies (Tim, 2026-11-06).
//     Its aisles and no-go areas come along unless unticked. "Upload a
//     different drawing" is there for a building that has been altered.
//   * A NEW building needs its drawing (an SVG in inches — lib/plantSvg.ts has
//     the rules). It is read and checked HERE, before anything is written, so
//     a bad file is refused with a reason rather than leaving a file in the
//     library and no layout. A file picked always wins over the building's.
//   * An uploaded drawing is REVIEWED before Start (PlantDrawingReview): a
//     preview with what ARC found, warnings, the size to confirm (required),
//     and its keep-outs — the ticked ones come off the drawing that's saved
//     and start as editable areas on the layout.
// =============================================================================

interface NewPlantLayoutModalProps {
  /** The buildings that already have layouts — offered, not required. */
  buildings: string[];
  /** Every layout — where an existing building's drawing is found. */
  layouts: readonly PlantLayout[];
  /** The building tab the list was on, if any. */
  defaultBuilding?: string;
  busy: boolean;
  onClose: () => void;
  onCreate: (input: NewPlantLayoutInput) => Promise<void>;
}

export function NewPlantLayoutModal({ buildings, layouts, defaultBuilding = "", busy, onClose, onCreate }: NewPlantLayoutModalProps) {
  const [building, setBuilding] = useState(defaultBuilding);
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [fileName, setFileName] = useState("");
  const [drawing, setDrawing] = useState<WallsDrawing | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Asked to upload a different drawing for an existing building. */
  const [replaceWalls, setReplaceWalls] = useState(false);
  const [copyAreas, setCopyAreas] = useState(true);
  const [choices, setChoices] = useState<KeepoutChoice[]>([]);
  const [sizeConfirmed, setSizeConfirmed] = useState(false);
  const review = useMemo(() => (drawing ? reviewWallsDrawing(drawing) : null), [drawing]);

  const source = buildingSource(layouts, building);
  // A file picked wins; otherwise an existing building's own drawing.
  const usingExisting = source !== null && drawing === null && !replaceWalls;
  const showUpload = !usingExisting;

  async function pick(file: File | undefined) {
    setDrawing(null);
    setFileProblem(null);
    setFileName(file?.name ?? "");
    if (!file) return;
    if (!/\.svg$/i.test(file.name) && file.type !== "image/svg+xml") {
      setFileProblem("Pick an SVG file (.svg). Export the drawing from CAD as SVG first.");
      return;
    }
    if (file.size > MAX_WALLS_SVG_BYTES) {
      setFileProblem("That drawing is over 2 MB. Leave only the walls, doors and columns, and run it through SVGO.");
      return;
    }
    const check = readWallsSvg(await file.text());
    if (!check.ok) {
      setFileProblem(check.problem);
      return;
    }
    setDrawing(check.drawing);
    setChoices(reviewWallsDrawing(check.drawing).keepouts);
    setSizeConfirmed(false);
    if (!title.trim() && check.drawing.building) setTitle(check.drawing.building);
    if (!building.trim() && check.drawing.building) setBuilding(check.drawing.building);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!building.trim()) return setError("Pick the building, or type the name of a new one.");
    if (!title.trim()) return setError("Give the layout a name, like the building it's for.");
    if (!usingExisting && !drawing) return setError("Pick the building's walls drawing.");
    if (!usingExisting && !sizeConfirmed) {
      return setError(`Check the building's size and tick "The building is ${review?.sizeLabel}" — or pick another drawing.`);
    }
    setError(null);
    const converted = new Set(choices.filter((c) => c.convert).map((c) => c.id));
    const input: NewPlantLayoutInput =
      usingExisting && source
        ? {
            building,
            title,
            area,
            walls: { kind: "existing", fileId: source.fileId },
            extent: source.extent,
            areas: copyAreas ? source.areas : [],
          }
        : {
            building,
            title,
            area,
            // The ticked keep-outs leave the saved drawing and start as the layout's areas.
            walls: { kind: "upload", svg: removeKeepouts(drawing!.svg, converted), fileName },
            extent: drawing!.extent,
            areas: keepoutsToAreas(choices),
          };
    try {
      await onCreate(input);
    } catch (err) {
      setError(describeListWriteFailure(err, { action: "start that layout", site: "Altronic_PMO", permission: "editing" }));
    }
  }

  const isNewBuilding =
    building.trim() !== "" && !buildings.some((b) => b.toLowerCase() === building.trim().toLowerCase());

  return (
    <div
      // Centred by the form's auto margins, NOT items-center: centring a dialog
      // taller than the window pushes its top above the scroll area, out of reach
      // (Tim, 2026-11-06, once the drawing review made it that tall).
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="New plant layout"
        className={cn(
          "my-auto flex w-full flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-xl",
          drawing && showUpload ? "max-w-4xl" : "max-w-lg",
        )}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-fg">New plant layout</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-sm p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Name *</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Main Plant"
            className="select"
            disabled={busy}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Building *</span>
          <SuggestInput
            value={building}
            onChange={setBuilding}
            options={buildings}
            placeholder="Pick one, or type a new building"
            ariaLabel="Building"
            disabled={busy}
          />
          {isNewBuilding && (
            <span className="text-[11px] text-fg-muted" data-testid="new-building">
              A new building — it gets its own tab on the Layouts list.
            </span>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Area</span>
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="e.g. Production floor"
            className="select"
            disabled={busy}
          />
        </label>

        {usingExisting && source && (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3" data-testid="existing-walls">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Walls drawing</span>
            <p className="flex items-start gap-2 text-sm text-fg">
              <MapIcon className="mt-0.5 h-4 w-4 shrink-0 text-cooper-green" />
              <span>
                Uses {source.layout.building}&rsquo;s drawing, from {source.layout.title} v{source.layout.version} —{" "}
                {feetLabel(source.extent.w)} × {feetLabel(source.extent.h)}. Nothing new is uploaded.
              </span>
            </p>
            {source.areas.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-fg">
                <input type="checkbox" checked={copyAreas} onChange={(e) => setCopyAreas(e.target.checked)} disabled={busy} />
                Start with its {source.areas.length} aisle{source.areas.length === 1 ? "" : "s"} and no-go area
                {source.areas.length === 1 ? "" : "s"}
              </label>
            )}
            <button
              type="button"
              onClick={() => setReplaceWalls(true)}
              disabled={busy}
              className="self-start text-xs font-medium text-accent hover:underline"
            >
              Upload a different drawing
            </button>
          </div>
        )}

        {showUpload && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Walls drawing (SVG) *</span>
            <label className="inline-flex cursor-pointer items-center gap-2 self-start rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2">
              <FileUp className="h-4 w-4" />
              {fileName ? "Choose a different file" : "Choose file"}
              <input
                type="file"
                accept=".svg,image/svg+xml"
                aria-label="Walls drawing"
                className="sr-only"
                disabled={busy}
                onChange={(e) => void pick(e.target.files?.[0])}
              />
            </label>
            {fileName && <span className="text-xs text-fg-muted">{fileName}</span>}
            {fileProblem && (
              <p role="alert" className="text-xs text-cooper-red">
                {fileProblem}
              </p>
            )}
            {drawing && review && (
              <PlantDrawingReview
                drawing={drawing}
                review={review}
                choices={choices}
                onChoicesChange={setChoices}
                sizeConfirmed={sizeConfirmed}
                onSizeConfirmedChange={setSizeConfirmed}
                disabled={busy}
              />
            )}
            <p className="text-[11px] text-fg-muted">
              In inches, with a viewBox of the building's size. Walls, columns and keep-outs as rectangles in groups named
              walls, columns and keepout let ARC check that nothing is placed on them.
            </p>
            {source && (
              <button
                type="button"
                onClick={() => {
                  setReplaceWalls(false);
                  setDrawing(null);
                  setFileName("");
                  setFileProblem(null);
                }}
                disabled={busy}
                className="self-start text-xs font-medium text-accent hover:underline"
              >
                Use {source.layout.building}&rsquo;s drawing instead
              </button>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-cooper-red">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Starting…" : "Start layout"}
          </button>
        </div>
      </form>
    </div>
  );
}
