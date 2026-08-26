import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, X } from "lucide-react";
import { SUPPLIER_STATUSES, type Person } from "@/types/task";
import { useCreateSupplier, useSuppliers, collectSupplierPeople } from "@/hooks/useSuppliers";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople, personKey } from "@/lib/people";
import { ChoiceSelect, SingleSelect } from "./SearchableSelect";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// New supplier — created bare (company/BP number/address/website/status +
// Assigned Buyer); Notes, Core Competency, Score and comments are added from
// the detail page's own cards, the same "create, then fill in" pattern as
// EIRs, ECNs and Customer Notes.
// =============================================================================

export function SupplierFormModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateSupplier();
  const { data: suppliers = [] } = useSuppliers();
  const directory = useDirectoryPeople();
  const allPeople = mergePeople(collectSupplierPeople(suppliers), directory);

  const [companyName, setCompanyName] = useState("");
  const [businessPartnerNumber, setBusinessPartnerNumber] = useState("");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState("");
  const [assignedBuyerKey, setAssignedBuyerKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !create.isPending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [create.isPending, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, create.isPending);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) {
      setError("Company name is required.");
      return;
    }
    setError(null);
    const assignedBuyer: Person | null = assignedBuyerKey
      ? allPeople.find((p) => personKey(p) === assignedBuyerKey) ?? null
      : null;
    try {
      const created = await create.mutateAsync({
        companyName,
        businessPartnerNumber,
        address,
        website,
        status: (status || null) as (typeof SUPPLIER_STATUSES)[number] | null,
        assignedBuyer,
        watchers: [],
      });
      onClose();
      navigate(`/supply-chain/supplier/${created.id}`);
    } catch {
      setError("Couldn't add the supplier — please retry.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New supplier"
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            <Plus className="h-4 w-4 text-accent" /> New Supplier
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={create.isPending}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <FieldLabel label="Company Name *">
            <input
              ref={nameRef}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Arrow Electronics"
              className="input"
              disabled={create.isPending}
            />
          </FieldLabel>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Business Partner Number">
              <input
                value={businessPartnerNumber}
                onChange={(e) => setBusinessPartnerNumber(e.target.value)}
                className="input"
                disabled={create.isPending}
              />
            </FieldLabel>
            <FieldLabel label="Status">
              <ChoiceSelect
                value={status}
                onChange={setStatus}
                options={SUPPLIER_STATUSES}
                emptyLabel="Not set"
                disabled={create.isPending}
              />
            </FieldLabel>
          </div>

          <FieldLabel label="Address">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="input"
              disabled={create.isPending}
            />
          </FieldLabel>

          <FieldLabel label="Website">
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="input"
              disabled={create.isPending}
            />
          </FieldLabel>

          <FieldLabel label="Assigned Buyer">
            <SingleSelect
              allLabel="No buyer assigned"
              searchPlaceholder="Search people…"
              options={allPeople.map((p) => ({ value: personKey(p), label: p.displayName }))}
              selected={assignedBuyerKey}
              onChange={setAssignedBuyerKey}
              disabled={create.isPending}
            />
          </FieldLabel>

          {error && <p className="text-sm text-cooper-red">{error}</p>}

          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={create.isPending}
              className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
            >
              {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add supplier
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
