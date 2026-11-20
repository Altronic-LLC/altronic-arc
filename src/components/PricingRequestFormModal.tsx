import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { Person } from "@/types/task";
import type { SapCustomer } from "@/types/pricing";
import { useCreatePricingRequest } from "@/hooks/usePricingRequests";
import { useSapPartAsYouType } from "@/hooks/usePricingLookup";
import { needsSapSignIn } from "@/api/pricingLookup";
import { signInToFabric } from "@/api/fabric";
import { pushToast } from "./Toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople, personKey } from "@/lib/people";
import { SingleSelect } from "./SearchableSelect";
import { SapCustomerPicker } from "./SapCustomerPicker";
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
  const [error, setError] = useState<string | null>(null);

  // Ray, 2026-10-13: somebody who only knows the SAP number gets the Altronic
  // (old) number pulled in from SAP — and the other way round. Looked up when
  // they leave either box; only BLANK boxes are filled, never one they typed.
  // Looked up AS THEY TYPE (Ray, 2026-10-17): an SAP number the moment its
  // 10th digit lands, an Altronic number after a short pause.
  const found = useSapPartAsYouType(altronic, sap);
  const sapPart = found.data ?? null;
  useEffect(() => {
    if (!sapPart) return;
    setAltronic((v) => (v.trim() ? v : sapPart.altronicPartNumber));
    setSap((v) => (v.trim() ? v : sapPart.sapPartNumber));
    setDescription((v) => (v.trim() ? v : sapPart.description));
  }, [sapPart]);
  // Dev demo with live SAP only: nothing has signed in to Microsoft yet.
  const signInNeeded = found.isError && needsSapSignIn(found.error);
  const [signingIn, setSigningIn] = useState(false);
  async function signIn() {
    setSigningIn(true);
    try {
      await signInToFabric();
      await found.refetch();
    } catch (err) {
      pushToast({ message: `Couldn't sign in to SAP: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSigningIn(false);
    }
  }

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

  const chosen = customer && customer.name.trim() ? customer : null;

  const missing = [
    !altronic.trim() && !sap.trim() && "Altronic or SAP part #",
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
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-sm p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Altronic part #">
              <input value={altronic} onChange={(e) => setAltronic(e.target.value)} className="input" autoFocus />
            </Field>
            <Field label="SAP part #">
              <input value={sap} onChange={(e) => setSap(e.target.value)} className="input" />
            </Field>
          </div>
          <p className="-mt-1 text-[11px] text-fg-muted" role="status">
            {signInNeeded ? (
              <>
                Sign in to SAP to look the part up —{" "}
                <button
                  type="button"
                  onClick={() => void signIn()}
                  disabled={signingIn}
                  className="font-semibold text-accent hover:underline disabled:opacity-50"
                >
                  {signingIn ? "signing in…" : "Sign in to SAP"}
                </button>
              </>
            ) : sapPart
              ? `Found in SAP: ${sapPart.altronicPartNumber} · ${sapPart.sapPartNumber} — ${sapPart.description}`
              : found.isFetching
                ? "Looking it up in SAP…"
                : found.isError && !found.notConnected
                  ? "SAP couldn't be checked from here — type both numbers if you know them. The pricing team checks it."
                  : found.isSuccess && found.askedAnything
                    ? "Not found in SAP — the request goes to be set up in SAP first."
                    : "Either number will do — ARC looks the other one up in SAP."}
          </p>
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
            <SapCustomerPicker value={customer} onChange={setCustomer} />
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
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs hover:bg-accent/90 disabled:opacity-50"
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
