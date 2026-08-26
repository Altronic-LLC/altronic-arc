import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, X } from "lucide-react";
import { CUSTOMER_GROUPS, CUSTOMER_TYPES, type Person } from "@/types/task";
import { useCreateCustomerNote, useCustomerNotes, collectCustomerNotePeople } from "@/hooks/useCustomerNotes";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople, personKey } from "@/lib/people";
import { ChoiceSelect, MultiSelect, SingleSelect } from "./SearchableSelect";
import { PersonMultiField } from "./PersonMultiField";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// New customer — Customer Notes is created bare (name + numbers + group/type +
// CSR/KAM); General/Compliance Notes and comments are added from the detail
// page's own cards, the same "create, then fill in from the detail page"
// pattern as EIRs and ECNs.
// =============================================================================

export function CustomerNoteFormModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateCustomerNote();
  const { data: notes = [] } = useCustomerNotes();
  const directory = useDirectoryPeople();
  const allPeople = mergePeople(collectCustomerNotePeople(notes), directory);

  const [customerName, setCustomerName] = useState("");
  const [oldCustomerNumber, setOldCustomerNumber] = useState("");
  const [sapCustomerNumber, setSapCustomerNumber] = useState("");
  const [group, setGroup] = useState("");
  const [customerTypes, setCustomerTypes] = useState<string[]>([]);
  const [csr, setCsr] = useState<Person[]>([]);
  const [kamKey, setKamKey] = useState<string | null>(null);
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
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return;
    }
    setError(null);
    const kam = kamKey ? allPeople.find((p) => personKey(p) === kamKey) ?? null : null;
    try {
      const created = await create.mutateAsync({
        customerName,
        oldCustomerNumber,
        sapCustomerNumber,
        group: (group || null) as (typeof CUSTOMER_GROUPS)[number] | null,
        customerTypes: customerTypes as (typeof CUSTOMER_TYPES)[number][],
        csr,
        kam,
      });
      onClose();
      navigate(`/sales/customers/${created.id}`);
    } catch {
      setError("Couldn't add the customer — please retry.");
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
        aria-label="New customer"
        onClick={(e) => e.stopPropagation()}
        className="my-4 w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            <Plus className="h-4 w-4 text-accent" /> New Customer
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
          <FieldLabel label="Customer Name *">
            <input
              ref={nameRef}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Arrow Engine Company"
              className="input"
              disabled={create.isPending}
            />
          </FieldLabel>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="SAP Customer Number">
              <input
                value={sapCustomerNumber}
                onChange={(e) => setSapCustomerNumber(e.target.value)}
                className="input"
                disabled={create.isPending}
              />
            </FieldLabel>
            <FieldLabel label="Old Customer Number">
              <input
                value={oldCustomerNumber}
                onChange={(e) => setOldCustomerNumber(e.target.value)}
                className="input"
                disabled={create.isPending}
              />
            </FieldLabel>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Group">
              <ChoiceSelect
                value={group}
                onChange={setGroup}
                options={CUSTOMER_GROUPS}
                emptyLabel="No group"
                searchPlaceholder="Search groups…"
                disabled={create.isPending}
              />
            </FieldLabel>
            <FieldLabel label="Customer Type">
              <MultiSelect
                allLabel="None set"
                options={CUSTOMER_TYPES.map((t) => ({ value: t, label: t }))}
                selected={customerTypes}
                onChange={setCustomerTypes}
              />
            </FieldLabel>
          </div>

          <FieldLabel label="CSR">
            <PersonMultiField
              value={csr}
              allPeople={allPeople}
              emptyLabel="No CSR assigned"
              onToggle={(p) => {
                const key = personKey(p);
                setCsr((prev) =>
                  prev.some((x) => personKey(x) === key)
                    ? prev.filter((x) => personKey(x) !== key)
                    : [...prev, p],
                );
              }}
            />
          </FieldLabel>

          <FieldLabel label="KAM">
            <SingleSelect
              allLabel="No KAM assigned"
              searchPlaceholder="Search people…"
              options={allPeople.map((p) => ({ value: personKey(p), label: p.displayName }))}
              selected={kamKey}
              onChange={setKamKey}
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
              Add customer
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
