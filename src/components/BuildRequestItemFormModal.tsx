import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { useCreateBuildRequestItem } from "@/hooks/useBuildRequests";
import {
  BUILD_REQUEST_DISPOSITIONS,
  BUILD_REQUEST_PART_TYPES,
  type BuildRequest,
  type BuildRequestDisposition,
  type BuildRequestPartType,
} from "@/types/task";
import { AutoGrowTextarea } from "./AutoGrowTextarea";

interface BuildRequestItemFormModalProps {
  buildRequest: BuildRequest;
  onClose: () => void;
}

/**
 * "Add Part" modal — creates a Build Request Item under the given header.
 * Deliberately asks only for the fields a requestor knows up front; Part
 * Status / WO No / checklists get filled in later on the item card by
 * engineering + manufacturing.
 */
export function BuildRequestItemFormModal({ buildRequest, onClose }: BuildRequestItemFormModalProps) {
  const createItem = useCreateBuildRequestItem();

  const [partNumber, setPartNumber] = useState("");
  const [partDesc, setPartDesc] = useState("");
  const [qty, setQty] = useState("");
  const [drawingNo, setDrawingNo] = useState("");
  const [drawingRev, setDrawingRev] = useState("");
  const [revisionDate, setRevisionDate] = useState("");
  const [partType, setPartType] = useState<BuildRequestPartType | "">("");
  const [disposition, setDisposition] = useState<BuildRequestDisposition | "">("");
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const firstInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = partNumber.trim();
    if (!trimmed) {
      setError("Part number is required.");
      return;
    }
    setError(null);
    setBusy(true);

    try {
      const parsedQty = qty.trim() ? parseInt(qty, 10) : null;
      await createItem.mutateAsync({
        partNumber: trimmed,
        buildRequestLookupId: buildRequest.id,
        partDesc: partDesc.trim() || undefined,
        qty: parsedQty != null && !Number.isNaN(parsedQty) ? parsedQty : null,
        drawingNo: drawingNo.trim() || undefined,
        drawingRev: drawingRev.trim() || undefined,
        revisionDate: revisionDate.trim() || undefined,
        partType: partType || null,
        disposition: disposition || null,
        specialInstructions: specialInstructions.trim() || undefined,
        // Default the part's project to the header's first project reference.
        projectRefLookupId: buildRequest.parentProjects[0]?.lookupId ?? null,
      });
      onClose();
    } catch {
      setError("Couldn't add the part — please retry.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={() => !busy && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            <Plus className="h-4 w-4 text-accent" /> Add Part
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-xs text-fg-muted">
          Adding to <span className="font-mono font-semibold">{buildRequest.brNo}</span> —{" "}
          {buildRequest.title}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_0.6fr]">
            <FieldLabel label="Part Number *">
              <input
                ref={firstInputRef}
                type="text"
                required
                value={partNumber}
                onChange={(e) => setPartNumber(e.target.value)}
                placeholder="e.g. 591044-2"
                className="select"
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Qty">
              <input
                type="number"
                min="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
          </div>

          <FieldLabel label="Part Description">
            <input
              type="text"
              value={partDesc}
              onChange={(e) => setPartDesc(e.target.value)}
              placeholder="e.g. PCB Assembly, Hub V4 Main Board"
              className="select"
              disabled={busy}
            />
          </FieldLabel>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FieldLabel label="Drawing No">
              <input
                type="text"
                value={drawingNo}
                onChange={(e) => setDrawingNo(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Drawing Rev">
              <input
                type="text"
                value={drawingRev}
                onChange={(e) => setDrawingRev(e.target.value)}
                className="select"
                disabled={busy}
              />
            </FieldLabel>
            <FieldLabel label="Revision Date">
              <input
                type="text"
                value={revisionDate}
                onChange={(e) => setRevisionDate(e.target.value)}
                placeholder="e.g. 06/12/2026"
                className="select"
                disabled={busy}
              />
            </FieldLabel>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Part Type">
              <select
                value={partType}
                onChange={(e) => setPartType(e.target.value as BuildRequestPartType | "")}
                className="select"
                disabled={busy}
              >
                <option value="">Not set</option>
                {BUILD_REQUEST_PART_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </FieldLabel>
            <FieldLabel label="Disposition">
              <select
                value={disposition}
                onChange={(e) => setDisposition(e.target.value as BuildRequestDisposition | "")}
                className="select"
                disabled={busy}
              >
                <option value="">Not set</option>
                {BUILD_REQUEST_DISPOSITIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </FieldLabel>
          </div>

          <FieldLabel label="Special Instructions">
            <AutoGrowTextarea
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.target.value)}
              rows={3}
              disabled={busy}
              className="w-full resize-y rounded-md border border-border bg-bg p-3 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
            />
          </FieldLabel>

          {partType === "PCB" && (
            <div className="rounded-md border border-superior-blue/30 bg-superior-blue/5 px-3 py-2 text-xs text-fg-muted">
              PCB parts get the data-package checklist (BOMs, Gerbers, fiducials…) on the part
              card after it's added.
            </div>
          )}
          {partType === "Harness" && (
            <div className="rounded-md border border-superior-blue/30 bg-superior-blue/5 px-3 py-2 text-xs text-fg-muted">
              Harness parts get the harness checklist (terminals, tooling, processes) on the
              part card after it's added.
            </div>
          )}

          {error && (
            <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
              {error}
            </div>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !partNumber.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "Adding…" : "Add Part"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
