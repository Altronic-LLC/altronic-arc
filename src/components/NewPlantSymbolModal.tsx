import { useEffect, useMemo, useState } from "react";
import { FileUp, Info, X } from "lucide-react";
import {
  LAYOUT_COMPONENT_CATEGORIES,
  type LayoutComponent,
  type LayoutComponentCategory,
  type NewLayoutComponentInput,
} from "@/types/plant";
import {
  MAX_SYMBOL_MARKUP_CHARS,
  TRACE_MAX_PIXELS,
  buildSymbolSvg,
  dxfToArt,
  inkFromRgba,
  proportionsDiffer,
  retitleSymbolSvg,
  svgToArt,
  symbolKeyFor,
  tracedArt,
  type ArtResult,
  type SymbolArt,
} from "@/lib/plantSymbolImport";
import { sanitiseSvg, svgDataUrl } from "@/lib/plantSvg";
import { feetLabel } from "@/lib/plantGeometry";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { cn } from "@/lib/cn";
import { ChoiceSelect } from "./SearchableSelect";
import { ChoicePills } from "./ChoicePills";

// =============================================================================
// Plant Map → Symbols → Add symbol (a Plant Map admin). Pick a drawing — an
// SVG, a DXF from CAD, or a picture to trace — fill in what it is, and ARC
// builds the library's symbol from it (lib/plantSymbolImport.ts): inches, the
// key and title, the footprint, the front-edge notch. The preview IS the SVG
// that will be saved.
//
// Nothing is written until Add symbol; a file ARC can't use is refused with the
// reason. Pictures are traced in the browser (a canvas), at a threshold the
// person moves until the silhouette looks right.
//
// With `replacing`, the same form REPLACES a symbol with its next version
// (lib/plantSymbolVersions.ts): its details are filled in, a new drawing is
// optional, and the footprint changes only with a new drawing — the current one
// is drawn at its size. The key never changes.
// =============================================================================

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PICTURE = /\.(png|jpe?g|gif|webp|bmp)$/i;

interface Raster {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
}

/** A picture's pixels, shrunk to at most TRACE_MAX_PIXELS on its long side. */
async function readPicture(file: File): Promise<Raster> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, TRACE_MAX_PIXELS / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { rgba: ctx.getImageData(0, 0, w, h).data, w, h };
}

function titleFromFile(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface NewPlantSymbolModalProps {
  /** Keys already in the library — a new one never repeats them. */
  takenKeys: readonly string[];
  /** Replace this symbol with its next version, instead of adding one. */
  replacing?: LayoutComponent;
  busy: boolean;
  onClose: () => void;
  onCreate: (input: NewLayoutComponentInput) => Promise<void>;
}

export function NewPlantSymbolModal({ takenKeys, replacing, busy, onClose, onCreate }: NewPlantSymbolModalProps) {
  const [fileName, setFileName] = useState("");
  const [art, setArt] = useState<SymbolArt | null>(null);
  const [raster, setRaster] = useState<Raster | null>(null);
  const [threshold, setThreshold] = useState(128);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const r = replacing;
  const [title, setTitle] = useState(r?.title ?? "");
  /** The name filled in from the last file — replaced by the next file's until the person types their own. */
  const [autoTitle, setAutoTitle] = useState("");
  const [category, setCategory] = useState<LayoutComponentCategory>((r?.category as LayoutComponentCategory) ?? "Machine");
  const [width, setWidth] = useState(r ? String(r.footprintW) : "");
  const [depth, setDepth] = useState(r ? String(r.footprintD) : "");
  const [collides, setCollides] = useState(r && !r.collides ? "no" : "yes");
  const [clearance, setClearance] = useState(r ? String(r.clearance) : "0");
  const [rotate, setRotate] = useState(r && !r.allowRotate ? "No" : "Yes");
  const [resize, setResize] = useState(r?.allowResize ? "Yes" : "No");
  const [minPct, setMinPct] = useState(r?.allowResize ? String(Math.round(r.minScale * 100)) : "80");
  const [maxPct, setMaxPct] = useState(r?.allowResize ? String(Math.round(r.maxScale * 100)) : "150");
  const [fit, setFit] = useState<"contain" | "stretch">("contain");
  const [frontMark, setFrontMark] = useState(true);

  // A picture is re-traced as the threshold moves.
  useEffect(() => {
    if (!raster) return;
    const traced = tracedArt(inkFromRgba(raster.rgba, raster.w, raster.h, threshold), raster.w, raster.h);
    if (traced.ok) {
      setArt(traced.art);
      setProblem(null);
    } else {
      setArt(null);
      setProblem(traced.problem);
    }
  }, [raster, threshold]);

  function applyArt(result: ArtResult) {
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    setArt(result.art);
    if (result.art.sizeInches) {
      setWidth(String(result.art.sizeInches.w));
      setDepth(String(result.art.sizeInches.d));
    }
  }

  async function pick(file: File | undefined) {
    setArt(null);
    setRaster(null);
    setProblem(null);
    setFileName(file?.name ?? "");
    if (!file) return;
    if (!title.trim() || title === autoTitle) {
      const fromFile = titleFromFile(file.name);
      setTitle(fromFile);
      setAutoTitle(fromFile);
    }
    if (file.size > MAX_FILE_BYTES) return setProblem("That file is over 5 MB. A symbol needs only its outline.");
    const name = file.name.toLowerCase();
    if (name.endsWith(".svg") || file.type === "image/svg+xml") return applyArt(svgToArt(await file.text()));
    if (name.endsWith(".dxf")) return applyArt(dxfToArt(await file.text()));
    if (PICTURE.test(name) || /^image\//.test(file.type)) {
      try {
        setRaster(await readPicture(file));
      } catch {
        setProblem("ARC couldn't read that picture. Try saving it as a PNG.");
      }
      return;
    }
    if (name.endsWith(".dwg")) {
      return setProblem("A browser can't read DWG. Save it from CAD as a DXF (Save As → DXF), and pick that.");
    }
    if (name.endsWith(".pdf")) {
      return setProblem("PDFs can't be read here. Export the drawing as DXF or SVG, or save the page as a PNG to trace.");
    }
    setProblem("Pick an SVG, a DXF from CAD, or a picture (PNG or JPG).");
  }

  // Replacing without a new drawing keeps the current one, drawn at its own size.
  const sizeEditable = !r || !!art;
  const w = r && !art ? r.footprintW : Number(width);
  const d = r && !art ? r.footprintD : Number(depth);
  const sized = Number.isFinite(w) && Number.isFinite(d) && w > 0 && d > 0;
  const generatedKey = useMemo(() => symbolKeyFor(title, w || 0, d || 0, takenKeys), [title, w, d, takenKeys]);
  const key = r ? r.key : generatedKey;
  const svg = useMemo(() => {
    if (art) return sized ? buildSymbolSvg(art, { title: title.trim() || "Symbol", key, w, d, fit, frontMark }) : "";
    return r ? retitleSymbolSvg(r.svgMarkup, title.trim() || r.title) : "";
  }, [art, sized, title, key, w, d, fit, frontMark, r]);
  /** What the preview draws — a stored drawing is raw until sanitised. */
  const previewSvg = useMemo(() => (art ? svg : svg ? sanitiseSvg(svg) : ""), [art, svg]);
  const nextVersion = r ? r.version + 1 : 1;
  const tooBig = svg.length > MAX_SYMBOL_MARKUP_CHARS;
  const misfit = art && sized && proportionsDiffer(art, w, d);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!art && !r) return setError("Pick the drawing for the symbol.");
    if (!title.trim()) return setError("Give the symbol a name.");
    if (!sized) return setError("Enter the footprint — its real width and depth in inches.");
    if (w > 2400 || d > 2400) return setError("That footprint is over 200 ft. Check it's in inches.");
    const clear = Number(clearance || 0);
    if (!Number.isFinite(clear) || clear < 0) return setError("Clearance is inches, 0 or more.");
    const min = Number(minPct) / 100;
    const max = Number(maxPct) / 100;
    if (resize === "Yes" && !(min > 0 && min <= 1 && max >= 1)) {
      return setError("Smallest must be 100% or less and largest 100% or more.");
    }
    if (tooBig) return setError("That symbol is too detailed to store. Simplify the drawing, or lower the threshold.");
    const allowResize = resize === "Yes";
    if (
      r &&
      !art &&
      title.trim() === r.title &&
      category === r.category &&
      (collides === "yes") === r.collides &&
      clear === r.clearance &&
      (rotate === "Yes") === r.allowRotate &&
      allowResize === r.allowResize &&
      (!allowResize || (min === r.minScale && max === r.maxScale))
    ) {
      return setError("Nothing has changed. Pick a new drawing, or change a detail.");
    }
    setError(null);
    try {
      await onCreate({
        title: title.trim(),
        key,
        category,
        svgMarkup: svg,
        footprintW: w,
        footprintD: d,
        allowResize: resize === "Yes",
        allowRotate: rotate === "Yes",
        minScale: min,
        maxScale: max,
        collides: collides === "yes",
        clearance: clear,
        // A new drawing drops the old outline (it was traced round the old art);
        // keeping the drawing keeps it.
        collisionPolygon: r && !art ? r.collisionPolygon : null,
      });
    } catch (err) {
      setError(
        describeListWriteFailure(err, {
          action: r ? "replace that symbol" : "add that symbol",
          site: "Altronic_PMO",
          permission: "editing",
        }),
      );
    }
  }

  const label = "text-xs font-semibold uppercase tracking-wider text-fg-muted";

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={r ? "Replace a symbol" : "Add a symbol"}
        className="my-auto flex w-full max-w-3xl flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-fg">
            {r ? `Replace ${r.title} (v${r.version})` : "Add a symbol"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-sm p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>

        {r && (
          <p className="rounded-md border border-superior-blue/40 bg-superior-blue/10 p-2 text-sm text-fg">
            Saves a new version, v{nextVersion}. Layouts that use v{r.version} keep it until somebody updates them in a
            draft (Update symbols, in the editor), and a published layout changes only when that draft is published.
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <span className={label}>{r ? "New drawing (optional)" : "Drawing *"}</span>
          <label className="inline-flex cursor-pointer items-center gap-2 self-start rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2">
            <FileUp className="h-4 w-4" />
            {fileName ? "Choose a different file" : "Choose file"}
            <input
              type="file"
              accept=".svg,.dxf,.png,.jpg,.jpeg,.gif,.webp,.bmp,image/*"
              aria-label="Symbol drawing"
              className="sr-only"
              disabled={busy}
              onChange={(e) => void pick(e.target.files?.[0])}
            />
          </label>
          {fileName && <span className="text-xs text-fg-muted">{fileName}</span>}
          <p className="text-[11px] text-fg-muted">
            An SVG; a DXF saved from CAD (its real size is read from it); or a picture — a PNG or JPG of the machine
            seen from above — which ARC traces to an outline.
          </p>
          {problem && (
            <p role="alert" className="text-xs text-cooper-red">
              {problem}
            </p>
          )}
          {r && !art && <p className="text-[11px] text-fg-muted">No new drawing picked — the current one is kept.</p>}
          {r?.collisionPolygon && art && (
            <p className="text-[11px] text-fg" data-testid="outline-dropped">
              The current version has a traced outline the placement check uses. It belongs to the old drawing, so
              the new version is checked as its rectangle.
            </p>
          )}
        </div>

        {raster && (
          <label className="flex flex-col gap-1">
            <span className={label}>Trace threshold</span>
            <span className="flex items-center gap-3">
              <input
                type="range"
                min={10}
                max={245}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                aria-label="Trace threshold"
                disabled={busy}
                className="w-64"
              />
              <span className="text-xs text-fg-muted">Lighter keeps less of the picture, darker keeps more.</span>
            </span>
          </label>
        )}

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Preview — the symbol exactly as it will be saved. */}
          <div className="flex flex-col gap-2">
            <span className={label}>Preview</span>
            <div className="flex min-h-48 items-center justify-center rounded-md border border-border bg-white p-3">
              {previewSvg ? (
                <img
                  src={svgDataUrl(previewSvg)}
                  alt={`${title || "Symbol"} preview`}
                  data-testid="symbol-preview"
                  className="max-h-56 max-w-full"
                  style={{ aspectRatio: `${w} / ${d}`, width: w >= d ? "100%" : "auto", height: w >= d ? "auto" : "14rem" }}
                />
              ) : (
                <span className="text-sm text-gray-500">
                  {art ? "Enter the footprint to see the symbol." : "Pick a drawing to see it here."}
                </span>
              )}
            </div>
            {previewSvg && (
              <p className="text-xs text-fg-muted">
                {feetLabel(w)} × {feetLabel(d)} · key <span className="font-mono">{key}</span> · the notch marks the front
              </p>
            )}
            {art && art.notes.length > 0 && (
              <ul className="flex flex-col gap-1" aria-label="About this drawing">
                {art.notes.map((n) => (
                  <li key={n} className="flex items-start gap-1.5 text-xs text-fg-muted">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {n}
                  </li>
                ))}
              </ul>
            )}
            {misfit && (
              <p className="text-xs text-fg" data-testid="symbol-misfit">
                The drawing's shape doesn't match the footprint —{" "}
                {fit === "contain" ? "it's centred inside it. Choose Stretch to fill it." : "it's stretched to fill it."}
              </p>
            )}
            {tooBig && (
              <p role="alert" className="text-xs text-cooper-red">
                That symbol is too detailed to store ({Math.round(svg.length / 1000)}k characters).
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={label}>Name *</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. CNC Router 5x10" className="select" disabled={busy} />
            </label>
            <div className="flex flex-col gap-1.5">
              <span className={label}>Category</span>
              <ChoiceSelect
                value={category}
                onChange={(v) => setCategory((v || "Other") as LayoutComponentCategory)}
                options={
                  (LAYOUT_COMPONENT_CATEGORIES as readonly string[]).includes(category)
                    ? [...LAYOUT_COMPONENT_CATEGORIES]
                    : [category, ...LAYOUT_COMPONENT_CATEGORIES]
                }
                clearable={false}
                ariaLabel="Category"
                emptyLabel="Pick a category"
                disabled={busy}
              />
            </div>
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1.5">
                <span className={label}>Width (in) *</span>
                <input
                  type="number"
                  min={1}
                  step="any"
                  value={sizeEditable ? width : String(w)}
                  onChange={(e) => setWidth(e.target.value)}
                  className="select disabled:opacity-60"
                  disabled={busy || !sizeEditable}
                />
              </label>
              <label className="flex flex-1 flex-col gap-1.5">
                <span className={label}>Depth (in) *</span>
                <input
                  type="number"
                  min={1}
                  step="any"
                  value={sizeEditable ? depth : String(d)}
                  onChange={(e) => setDepth(e.target.value)}
                  className="select disabled:opacity-60"
                  disabled={busy || !sizeEditable}
                />
              </label>
            </div>
            {!sizeEditable && (
              <p className="-mt-1 text-[11px] text-fg-muted">
                To change the footprint, pick a new drawing — the current one is drawn at this size.
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <span className={label}>On the floor</span>
              <ChoicePills
                label="On the floor"
                name="symbol-collides"
                value={collides}
                onChange={setCollides}
                disabled={busy}
                options={[
                  { value: "yes", label: "Solid — nothing may overlap it" },
                  { value: "no", label: "A floor marking" },
                ]}
              />
            </div>
            <label className="flex flex-col gap-1.5">
              <span className={label}>Clearance (in)</span>
              <input type="number" min={0} step="any" value={clearance} onChange={(e) => setClearance(e.target.value)} className="select" disabled={busy} />
            </label>
            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col gap-1.5">
                <span className={label}>Can be turned</span>
                <ChoicePills label="Can be turned" name="symbol-rotate" value={rotate} onChange={setRotate} disabled={busy} options={["Yes", "No"]} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className={label}>Can be resized</span>
                <ChoicePills label="Can be resized" name="symbol-resize" value={resize} onChange={setResize} disabled={busy} options={["Yes", "No"]} />
              </div>
            </div>
            {resize === "Yes" && (
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className={label}>Smallest (%)</span>
                  <input type="number" value={minPct} onChange={(e) => setMinPct(e.target.value)} className="select" disabled={busy} />
                </label>
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className={label}>Largest (%)</span>
                  <input type="number" value={maxPct} onChange={(e) => setMaxPct(e.target.value)} className="select" disabled={busy} />
                </label>
              </div>
            )}
            {/* How a NEW drawing is fitted — nothing to fit while the current one is kept. */}
            {sizeEditable && (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className={label}>Fit the drawing</span>
                  <ChoicePills
                    label="Fit the drawing"
                    name="symbol-fit"
                    value={fit}
                    onChange={(v) => setFit(v as "contain" | "stretch")}
                    disabled={busy}
                    options={[
                      { value: "contain", label: "Keep its proportions" },
                      { value: "stretch", label: "Stretch to the footprint" },
                    ]}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-fg">
                  <input type="checkbox" checked={frontMark} onChange={(e) => setFrontMark(e.target.checked)} disabled={busy} />
                  Mark the front (the bottom edge) with a notch
                </label>
              </>
            )}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-cooper-red">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
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
            className={cn("rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50")}
          >
            {r ? (busy ? "Saving…" : `Save as v${nextVersion}`) : busy ? "Adding…" : "Add symbol"}
          </button>
        </div>
      </form>
    </div>
  );
}
