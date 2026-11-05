import { useState } from "react";
import { Loader2, Package, X } from "lucide-react";
import { useSavePanelBomPart } from "@/hooks/usePanelBom";
import { panelBomPartProblem, type PanelBomPartInput } from "@/lib/panelBom";
import { formatSapPartNumber } from "@/lib/sapPartNumber";
import { NO_CATEGORY, PANEL_BOM_CLUSTERS, type PanelBomPart } from "@/types/panelBom";
import { ChoiceSelect } from "./SearchableSelect";
import { SuggestInput } from "./SuggestInput";
import { YesNoField } from "./YesNoField";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Add or change one part on the Panel SAP BOM Builder's parts list
// (BusinessIT#59). A panel Super User or an ARC admin — asked again inside the
// save. No cost field: cost is SAP's, read through Fabric, never stored here.
// No delete: a part that stops being used is retired (Active = No).
// =============================================================================

const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted";

interface Draft {
  sap: string;
  alt: string;
  description: string;
  cluster: string;
  category: string;
  standard: boolean;
  preferred: boolean;
  doNotQuote: boolean;
  datasheet: string;
  qtyIfUsed: string;
  active: boolean;
}

function draftOf(p: PanelBomPart | null): Draft {
  return {
    sap: p?.sapPartNumber ?? "",
    alt: p?.altronicPartNumber ?? "",
    description: p?.description ?? "",
    cluster: p ? String(p.cluster) : "",
    category: p && p.category !== NO_CATEGORY ? p.category : "",
    standard: p?.standard ?? false,
    preferred: p?.preferred ?? false,
    doNotQuote: p?.doNotQuote ?? false,
    datasheet: p?.datasheet ?? "",
    qtyIfUsed: p?.qtyIfUsed == null ? "" : String(p.qtyIfUsed),
    active: p?.active ?? true,
  };
}

function inputOfPartDraft(d: Draft): PanelBomPartInput {
  // Unreadable text becomes NaN, which panelBomPartProblem refuses.
  const qty = d.qtyIfUsed.trim() === "" ? null : Number(d.qtyIfUsed);
  return {
    sapPartNumber: d.sap.trim(),
    altronicPartNumber: d.alt,
    description: d.description,
    cluster: d.cluster === "" ? -1 : Number(d.cluster),
    category: d.category,
    standard: d.standard,
    preferred: d.preferred,
    doNotQuote: d.doNotQuote,
    datasheet: d.datasheet,
    qtyIfUsed: qty,
    active: d.active,
  };
}

export function PanelBomPartFormModal({
  part,
  categories,
  onClose,
}: {
  /** null = a new part. */
  part: PanelBomPart | null;
  /** Categories already in use, for suggestions. */
  categories: string[];
  onClose: () => void;
}) {
  const save = useSavePanelBomPart();
  const [d, setD] = useState<Draft>(() => draftOf(part));
  const [error, setError] = useState<string | null>(null);
  const busy = save.isPending;
  const overlayDismiss = useOverlayDismiss(onClose, busy);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = inputOfPartDraft(d);
    const problem = panelBomPartProblem(input);
    if (problem) return setError(problem);
    setError(null);
    try {
      await save.mutateAsync({ id: part?.id ?? null, input });
      onClose();
    } catch {
      setError("Couldn't save — see the message on screen, and try again.");
    }
  }


  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" {...overlayDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={part ? `Edit ${part.sapPartNumber}` : "Add a part"}
        onClick={(e) => e.stopPropagation()}
        className="mt-[6vh] flex w-full max-w-xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <Package className="h-4 w-4 text-accent" />
            {part ? part.sapPartNumber : "Add a part"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
          <label>
            <span className={LABEL}>
              SAP part #<span className="ml-1 text-cooper-red">*</span>
            </span>
            <input
              className="input"
              value={d.sap}
              onChange={(e) => set("sap", formatSapPartNumber(e.target.value))}
              placeholder="####-####-##"
              inputMode="numeric"
            />
          </label>
          <label>
            <span className={LABEL}>MFG / Altronic #</span>
            <input className="input" value={d.alt} onChange={(e) => set("alt", e.target.value)} />
          </label>
          <label className="sm:col-span-2">
            <span className={LABEL}>
              Description<span className="ml-1 text-cooper-red">*</span>
            </span>
            <input className="input" value={d.description} onChange={(e) => set("description", e.target.value)} />
          </label>
          <div>
            <span className={LABEL}>
              Cluster<span className="ml-1 text-cooper-red">*</span>
            </span>
            <ChoiceSelect
              ariaLabel="Cluster"
              emptyLabel="Pick a cluster"
              value={d.cluster}
              onChange={(v) => set("cluster", v)}
              options={PANEL_BOM_CLUSTERS.map((name, i) => ({ value: String(i), label: `${i} · ${name}` }))}
            />
            <span className="mt-1 block text-xs text-fg-muted">Sets where its SAP item number falls.</span>
          </div>
          <div>
            <span className={LABEL}>Category</span>
            <SuggestInput ariaLabel="Category" value={d.category} onChange={(v) => set("category", v)} options={categories} placeholder={NO_CATEGORY} />
          </div>
          <label>
            <span className={LABEL}>Qty if used</span>
            <input className="input" inputMode="decimal" value={d.qtyIfUsed} onChange={(e) => set("qtyIfUsed", e.target.value)} />
            <span className="mt-1 block text-xs text-fg-muted">The usual quantity — a hint in the builder.</span>
          </label>
          <label>
            <span className={LABEL}>Datasheet</span>
            <input className="input" value={d.datasheet} onChange={(e) => set("datasheet", e.target.value)} placeholder="File name" />
          </label>
          <LabelledYesNo name="bom-part-standard" label="Standard" checked={d.standard} onChange={(v) => set("standard", v)} />
          <LabelledYesNo name="bom-part-preferred" label="Preferred" checked={d.preferred} onChange={(v) => set("preferred", v)} />
          <LabelledYesNo name="bom-part-dnq" label="Do Not Quote" checked={d.doNotQuote} onChange={(v) => set("doNotQuote", v)} />
          <LabelledYesNo
            name="bom-part-active"
            label="Active"
            checked={d.active}
            onChange={(v) => set("active", v)}
            hint="No retires it: off the picker, kept on BOMs that use it."
          />
          {error && <p className="text-sm text-cooper-red sm:col-span-2">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-border pt-3 sm:col-span-2">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {part ? "Save" : "Add part"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * A yes/no column with its name shown ABOVE the pills. YesNoField's own
 * `label` is only the accessible name; every form puts the visible heading
 * above it (the Build Request form's Lead Free, for one). Both BOM dialogs
 * share this.
 */
export function LabelledYesNo({
  name,
  label,
  checked,
  onChange,
  hint,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  return (
    <div>
      <span className={LABEL}>{label}</span>
      <YesNoField name={name} label={label} value={checked ? "Yes" : ""} onChange={(v) => onChange(v === "Yes")} />
      {hint && <span className="mt-1 block text-xs text-fg-muted">{hint}</span>}
    </div>
  );
}
