import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { Person } from "@/types/task";
import type { SapCustomer } from "@/types/pricing";
import { useCreatePricingRequest } from "@/hooks/usePricingRequests";
import { useSapCustomerSearch } from "@/hooks/usePricingLookup";
import { SAP_DATA_CONNECTED } from "@/api/pricingLookup";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople, personKey } from "@/lib/people";
import { SingleSelect } from "./SearchableSelect";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// New pricing request (Ray, 2026-10-13): Altronic #, SAP # (optional — a part
// is sometimes set up with only an Altronic number), description, who it's
// for, notes, and the customer, looked up from SAP.
//
// The customer is picked from SAP (sold-to, name, customer group — the group
// is what decides their discount). While SAP data isn't connected the lookup
// says so and the three are typed instead, so a request is never blocked.
// =============================================================================

export function PricingRequestFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const create = useCreatePricingRequest();
  const me = useCurrentUser();
  const directory = useDirectoryPeople();
  const pending = create.isPending;

  const [altronic, setAltronic] = useState("");
  const [sap, setSap] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [requesterKey, setRequesterKey] = useState<string | null>(personKey(me));
  const [customer, setCustomer] = useState<SapCustomer | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [manual, setManual] = useState<SapCustomer>({ soldTo: "", name: "", customerGroup: "" });
  const [error, setError] = useState<string | null>(null);

  const search = useSapCustomerSearch(customer ? "" : customerQuery);
  const typingCustomer = !SAP_DATA_CONNECTED || search.notConnected;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, onClose]);
  const overlayDismiss = useOverlayDismiss(onClose, pending);

  const people = useMemo(() => mergePeople([me], directory), [me, directory]);
  const requesterOptions = useMemo(
    () =>
      people
        .filter((p) => p.email)
        .map((p) => ({ value: personKey(p), label: p.email === me.email ? `Me (${p.displayName})` : p.displayName }))
        .sort((a, b) => (a.label.startsWith("Me (") ? -1 : b.label.startsWith("Me (") ? 1 : a.label.localeCompare(b.label))),
    [people, me.email],
  );
  const requester: Person | null = people.find((p) => personKey(p) === requesterKey) ?? null;

  const chosen: SapCustomer | null = typingCustomer
    ? manual.name.trim()
      ? manual
      : null
    : customer;

  const missing = [
    !altronic.trim() && "Altronic part #",
    !description.trim() && "Description",
    !requester && "Requested by",
    !chosen && "Customer",
  ].filter(Boolean) as string[];

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (missing.length > 0) {
      setError(`Fill in: ${missing.join(", ")}.`);
      return;
    }
    setError(null);
    try {
      const { created } = await create.mutateAsync({
        altronicPartNumber: altronic.trim(),
        sapPartNumber: sap.trim(),
        description: description.trim(),
        requestedBy: requester!,
        notes: notes.trim(),
        customerSoldTo: chosen!.soldTo.trim(),
        customerName: chosen!.name.trim(),
        customerGroup: chosen!.customerGroup.trim(),
      });
      onClose();
      onSaved(created.id);
    } catch {
      // The hook toasts the reason; the form stays open with what was typed.
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" {...overlayDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New pricing request"
        onClick={(ev) => ev.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display text-lg font-semibold text-fg">New pricing request</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Altronic part #" required>
              <input value={altronic} onChange={(e) => setAltronic(e.target.value)} className="input" autoFocus />
            </Field>
            <Field label="SAP part #" hint="If you know it. ARC looks it up in SAP either way.">
              <input value={sap} onChange={(e) => setSap(e.target.value)} className="input" />
            </Field>
          </div>
          <Field label="Description" required hint="Replaced by SAP's description once ARC finds the part — yours is kept too.">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="input" />
          </Field>

          <div className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">
              Requested by <span className="text-cooper-red">*</span>
            </span>
            <SingleSelect
              allLabel="Who is this for?"
              searchPlaceholder="Type a name…"
              options={requesterOptions}
              selected={requesterKey}
              onChange={setRequesterKey}
              ariaLabel="Requested by"
            />
          </div>

          <div className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">
              Customer <span className="text-cooper-red">*</span>
            </span>
            {typingCustomer ? (
              <>
                <p className="rounded-md border border-ajax-yellow/40 bg-ajax-yellow/10 px-2 py-1.5 text-[11px] text-fg">
                  SAP customer lookup isn't connected yet — type the customer in.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input
                    aria-label="Sold-to number"
                    placeholder="Sold-to #"
                    value={manual.soldTo}
                    onChange={(e) => setManual({ ...manual, soldTo: e.target.value })}
                    className="input"
                  />
                  <input
                    aria-label="Customer name"
                    placeholder="Customer name"
                    value={manual.name}
                    onChange={(e) => setManual({ ...manual, name: e.target.value })}
                    className="input sm:col-span-2"
                  />
                </div>
                <input
                  aria-label="Customer group"
                  placeholder="Customer group (decides their discount)"
                  value={manual.customerGroup}
                  onChange={(e) => setManual({ ...manual, customerGroup: e.target.value })}
                  className="input"
                />
              </>
            ) : customer ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2/50 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-fg">{customer.name}</span>
                  <span className="ml-2 font-mono text-xs text-fg-muted">{customer.soldTo}</span>
                  <span className="ml-2 text-xs text-fg-muted">group {customer.customerGroup || "—"}</span>
                </span>
                <button type="button" onClick={() => setCustomer(null)} className="text-xs text-accent hover:underline">
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  aria-label="Search SAP customers"
                  placeholder="Search SAP customers by name or sold-to #…"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  className="input"
                />
                {customerQuery.trim().length >= 2 && (
                  <ul className="max-h-48 overflow-y-auto rounded-md border border-border" role="listbox" aria-label="SAP customers">
                    {search.isLoading && <li className="px-3 py-2 text-fg-muted">Searching…</li>}
                    {search.data?.length === 0 && <li className="px-3 py-2 text-fg-muted">No SAP customer matches.</li>}
                    {search.data?.map((c) => (
                      <li key={c.soldTo}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={false}
                          onClick={() => setCustomer(c)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
                        >
                          <span className="text-fg">{c.name}</span>
                          <span className="font-mono text-xs text-fg-muted">{c.soldTo}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <Field label="Notes" hint="Context for the pricing manager — volumes, timing, what the customer asked for.">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className="input" />
          </Field>

          {error && (
            <div role="alert" className="rounded-md border border-cooper-red/40 bg-cooper-red/10 px-2 py-1.5 text-xs text-cooper-red">
              {error}
            </div>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Submit request
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">
        {label} {required && <span className="text-cooper-red">*</span>}
      </span>
      {children}
      {hint && <span className="text-[11px] text-fg-muted">{hint}</span>}
    </label>
  );
}
