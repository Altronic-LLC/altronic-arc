import { useMemo, useState } from "react";
import { Boxes, Loader2, Plus, Trash2, X } from "lucide-react";
import { useSavePanelBomKit } from "@/hooks/usePanelBom";
import { partsBySap, sapKey, type PanelBomKitInput } from "@/lib/panelBom";
import { formatSapPartNumber } from "@/lib/sapPartNumber";
import { NO_CATEGORY, type PanelBomKit, type PanelBomPart } from "@/types/panelBom";
import { SuggestInput } from "./SuggestInput";
import { LabelledYesNo } from "./PanelBomPartFormModal";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Add or change one kit on the Panel SAP BOM Builder (BusinessIT#59). A panel
// Super User or an ARC admin. A kit is its components: quantity, SAP #, MFG #
// and description each. A component with NO SAP # is allowed — it lands in
// the builder's "enter in SAP by hand" box — but needs a description so it
// can be. Typing an SAP # that's on the parts list fills in a blank MFG # and
// description.
// =============================================================================

const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted";

interface ComponentDraft {
  qty: string;
  sap: string;
  mfg: string;
  description: string;
}

export function PanelBomKitFormModal({
  kit,
  parts,
  categories,
  onClose,
}: {
  /** null = a new kit. */
  kit: PanelBomKit | null;
  parts: readonly PanelBomPart[];
  categories: string[];
  onClose: () => void;
}) {
  const save = useSavePanelBomKit();
  const bySap = useMemo(() => partsBySap(parts), [parts]);
  const [name, setName] = useState(kit?.name ?? "");
  const [description, setDescription] = useState(kit?.description ?? "");
  const [category, setCategory] = useState(kit && kit.category !== NO_CATEGORY ? kit.category : "");
  const [standard, setStandard] = useState(kit?.standard ?? false);
  const [preferred, setPreferred] = useState(kit?.preferred ?? false);
  const [active, setActive] = useState(kit?.active ?? true);
  const [components, setComponents] = useState<ComponentDraft[]>(() =>
    kit?.components.length
      ? kit.components.map((c) => ({ qty: String(c.qty), sap: c.sapPartNumber, mfg: c.mfgPartNumber, description: c.description }))
      : [{ qty: "1", sap: "", mfg: "", description: "" }],
  );
  const [error, setError] = useState<string | null>(null);
  const busy = save.isPending;
  const overlayDismiss = useOverlayDismiss(onClose, busy);

  function setComponent(i: number, patch: Partial<ComponentDraft>) {
    setComponents((prev) =>
      prev.map((c, j) => {
        if (j !== i) return c;
        const next = { ...c, ...patch };
        // A listed SAP # fills in what's still blank — never over typing.
        if (patch.sap !== undefined) {
          const p = bySap.get(sapKey(next.sap));
          if (p) {
            if (!next.mfg.trim()) next.mfg = p.altronicPartNumber;
            if (!next.description.trim()) next.description = p.description;
          }
        }
        return next;
      }),
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const input: PanelBomKitInput = {
      name,
      description,
      category,
      standard,
      preferred,
      active,
      components: components
        .filter((c) => c.sap.trim() || c.mfg.trim() || c.description.trim())
        .map((c) => ({ qty: Number(c.qty), sapPartNumber: c.sap.trim(), mfgPartNumber: c.mfg.trim(), description: c.description.trim() })),
    };
    setError(null);
    try {
      await save.mutateAsync({ id: kit?.id ?? null, input });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the kit.");
    }
  }


  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" {...overlayDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={kit ? `Edit ${kit.name}` : "Add a kit"}
        onClick={(e) => e.stopPropagation()}
        className="mt-[4vh] flex w-full max-w-3xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <Boxes className="h-4 w-4 text-accent" />
            {kit ? kit.name : "Add a kit"}
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
        {kit?.componentsCorrupt ? (
          <p className="px-5 py-4 text-sm text-cooper-red">
            ARC couldn't read this kit's components, so it won't let them be edited here — saving would replace them. Fix the
            Components value on the Panel BOM Kits list in SharePoint.
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4 px-5 py-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label>
                <span className={LABEL}>
                  Kit name<span className="ml-1 text-cooper-red">*</span>
                </span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="KIT-…" />
                {kit && <span className="mt-1 block text-xs text-fg-muted">Saved BOMs find a kit by name — renaming one takes it off them.</span>}
              </label>
              <div>
                <span className={LABEL}>Category</span>
                <SuggestInput ariaLabel="Category" value={category} onChange={setCategory} options={categories} placeholder={NO_CATEGORY} />
              </div>
              <label className="sm:col-span-2">
                <span className={LABEL}>Description</span>
                <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
              {/* One row, so the components list below starts higher up. */}
              <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-3">
                <LabelledYesNo name="bom-kit-standard" label="Standard" checked={standard} onChange={setStandard} />
                <LabelledYesNo name="bom-kit-preferred" label="Preferred" checked={preferred} onChange={setPreferred} />
                <LabelledYesNo name="bom-kit-active" label="Active" checked={active} onChange={setActive} />
                <p className="-mt-2 text-xs text-fg-muted sm:col-span-3">
                  Active: No retires the kit — off the picker, kept on BOMs that use it.
                </p>
              </div>
            </div>

            <div>
              <span className={LABEL}>Components</span>
              <div className="flex flex-col gap-2">
                {components.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 sm:flex-nowrap">
                    <input
                      className="input w-16! text-right"
                      aria-label={`Component ${i + 1} quantity`}
                      inputMode="decimal"
                      value={c.qty}
                      onChange={(e) => setComponent(i, { qty: e.target.value })}
                    />
                    <input
                      className="input w-36!"
                      aria-label={`Component ${i + 1} SAP #`}
                      placeholder="SAP # (optional)"
                      title="Leave blank for a part that isn't in SAP — it's entered in SAP by hand"
                      inputMode="numeric"
                      value={c.sap}
                      onChange={(e) => setComponent(i, { sap: formatSapPartNumber(e.target.value) })}
                    />
                    <input
                      className="input w-36!"
                      aria-label={`Component ${i + 1} MFG #`}
                      placeholder="MFG #"
                      value={c.mfg}
                      onChange={(e) => setComponent(i, { mfg: e.target.value })}
                    />
                    <input
                      className="input min-w-0 flex-1"
                      aria-label={`Component ${i + 1} description`}
                      placeholder="Description"
                      value={c.description}
                      onChange={(e) => setComponent(i, { description: e.target.value })}
                    />
                    <button
                      type="button"
                      aria-label={`Remove component ${i + 1}`}
                      onClick={() => setComponents((prev) => prev.filter((_, j) => j !== i))}
                      className="rounded p-1.5 text-fg-muted hover:bg-surface-2 hover:text-cooper-red"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setComponents((prev) => [...prev, { qty: "1", sap: "", mfg: "", description: "" }])}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
              >
                <Plus className="h-4 w-4" /> Add component
              </button>
              {components.some((c) => c.sap && !bySap.has(sapKey(c.sap))) && (
                <p className="mt-2 text-xs text-ajax-yellow">
                  An SAP # that isn't on the parts list can't be numbered on a BOM — add the part first, or the builder will
                  list it to enter by hand.
                </p>
              )}
            </div>

            {error && <p className="text-sm text-cooper-red">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {kit ? "Save" : "Add kit"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
