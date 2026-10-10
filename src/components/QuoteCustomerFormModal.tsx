import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, Lock, Plus, Save, X } from "lucide-react";
import type { QuoteCustomer } from "@/types/quote";
import {
  useCreateQuoteCustomer,
  useQuoteCustomers,
  useUpdateQuoteCustomer,
} from "@/hooks/useQuoteCustomers";
import { QuoteCustomerCodeTakenError } from "@/api/quoteCustomers";
import {
  customerCodeCandidates,
  customerCodeProblem,
  findSimilarCustomers,
  proposeCustomerCode,
} from "@/lib/quoteCustomerCode";
import { ChoicePills } from "./ChoicePills";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Add or edit a Quote Customer (a quote MANAGER only — the caller gates the
// button, and every write asks `manageCustomersGate` again in its mutationFn).
//
// The CODE is the `COO` in `IQ-COO-0042-R1`:
//   * PROPOSED from the name as it is typed, until somebody edits the code by
//     hand — then it is theirs and the name stops touching it.
//   * A clash is SHOWN, with alternatives offered as one-click chips. It is
//     never silently suffixed: a clash usually means the customer already
//     exists under another spelling, and COO2 would hide that.
//   * FROZEN at creation — read-only when editing, because every quote number
//     already issued carries it.
//
// A similar NAME is a warning, not a block: two genuinely different customers
// can share a word, and the manager is the one who knows.
// =============================================================================

export function QuoteCustomerFormModal({
  customer,
  onClose,
}: {
  /** null = create a new customer. */
  customer: QuoteCustomer | null;
  onClose: () => void;
}) {
  const editing = customer !== null;
  const { data: customers = [] } = useQuoteCustomers();
  const create = useCreateQuoteCustomer();
  const update = useUpdateQuoteCustomer();
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(customer?.name ?? "");
  const [code, setCode] = useState(customer?.code ?? "");
  // Once the user types in the code box, the name stops driving it.
  const [codeEdited, setCodeEdited] = useState(editing);
  const [customerNumber, setCustomerNumber] = useState(customer?.customerNumber ?? "");
  const [active, setActive] = useState(customer?.active ?? true);
  const [note, setNote] = useState(customer?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  // Codes SharePoint refused at save time, which the loaded list may not show yet.
  const [refusedCodes, setRefusedCodes] = useState<string[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, pending);

  const takenCodes = useMemo(
    () => [...customers.filter((c) => c.id !== customer?.id).map((c) => c.code), ...refusedCodes],
    [customers, customer?.id, refusedCodes],
  );

  const codeProblem = editing ? null : customerCodeProblem(code, takenCodes);
  const clash = !editing && !!code.trim() && takenCodes.some((t) => t.trim().toUpperCase() === code.trim().toUpperCase());
  const candidates = useMemo(
    () => (clash ? customerCodeCandidates(name || code, takenCodes) : []),
    [clash, name, code, takenCodes],
  );
  const similar = useMemo(
    () => (name.trim() ? findSimilarCustomers(name, customers, customer?.id) : []),
    [name, customers, customer?.id],
  );

  function handleNameChange(next: string) {
    setName(next);
    if (!codeEdited) setCode(next.trim() ? proposeCustomerCode(next) : "");
  }

  function handleCodeChange(next: string) {
    setCodeEdited(true);
    setCode(next.toUpperCase());
  }

  function pickCandidate(next: string) {
    setCodeEdited(true);
    setCode(next);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!name.trim()) {
      setError("Customer name is required.");
      return;
    }
    if (codeProblem) {
      setError(codeProblem);
      return;
    }
    setError(null);
    try {
      if (editing) {
        await update.mutateAsync({
          id: customer.id,
          patch: { name: name.trim(), customerNumber, active, note },
        });
      } else {
        await create.mutateAsync({
          name: name.trim(),
          code: code.trim().toUpperCase(),
          customerNumber,
          note,
        });
      }
      onClose();
    } catch (err) {
      if (err instanceof QuoteCustomerCodeTakenError) {
        // Somebody took it since the list loaded. Remember it as taken so the
        // clash shows and alternatives are offered — never auto-suffix.
        setRefusedCodes((prev) => (prev.includes(err.code) ? prev : [...prev, err.code]));
        setError(err.message);
        return;
      }
      setError(err instanceof Error ? err.message : "Couldn't save the customer — please retry.");
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
        aria-label={editing ? "Edit customer" : "Add customer"}
        onClick={(ev) => ev.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            {editing ? <Save className="h-4 w-4 text-accent" /> : <Plus className="h-4 w-4 text-accent" />}
            {editing ? "Edit customer" : "Add customer"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            className="rounded p-1 text-fg-muted hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-5 py-4" noValidate>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Customer name</span>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(ev) => handleNameChange(ev.target.value)}
              className="input"
              placeholder="Cooper Machinery Services"
            />
          </label>

          {similar.length > 0 && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 px-3 py-2 text-xs text-fg"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ajax-yellow" />
              <div>
                <span className="font-semibold">Possible duplicate:</span>{" "}
                {similar.map((c) => `${c.name} (${c.code})`).join(", ")}. Check this isn't a customer
                that already exists before adding it.
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1 text-xs">
            <label htmlFor="quote-customer-code" className="font-semibold uppercase tracking-wider text-fg-muted">
              Customer code
            </label>
            {editing ? (
              <>
                <div
                  id="quote-customer-code"
                  className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-sm text-fg"
                >
                  <Lock className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
                  {customer.code}
                </div>
                <span className="text-[11px] text-fg-muted">
                  The code is fixed once a customer is created — every quote number already issued carries it.
                </span>
              </>
            ) : (
              <>
                <input
                  id="quote-customer-code"
                  type="text"
                  value={code}
                  onChange={(ev) => handleCodeChange(ev.target.value)}
                  maxLength={5}
                  className="input font-mono uppercase"
                  placeholder="COO"
                  aria-invalid={!!codeProblem && (submitted || clash)}
                />
                <span className="text-[11px] text-fg-muted">
                  {codeEdited
                    ? "2–5 letters or digits. Used in every quote number for this customer, and fixed once saved."
                    : "Proposed from the name — type over it to choose your own. Fixed once saved."}
                </span>
                {clash && (
                  <div className="rounded-md border border-cooper-red/40 bg-cooper-red/5 px-3 py-2 text-xs text-fg">
                    <p>
                      <span className="font-semibold text-cooper-red">{code.trim().toUpperCase()}</span> is already used by
                      another customer. Is this customer already on the list? If not, pick another code:
                    </p>
                    {candidates.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {candidates.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => pickCandidate(c)}
                            aria-label={`Use code ${c}`}
                            className="rounded-full border border-border bg-surface px-2.5 py-0.5 font-mono text-xs font-semibold text-fg hover:border-accent hover:text-accent"
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {!clash && submitted && codeProblem && (
                  <span className="text-[11px] text-cooper-red">{codeProblem}</span>
                )}
              </>
            )}
          </div>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Customer number (SAP sold-to)</span>
            <input
              type="text"
              inputMode="numeric"
              value={customerNumber}
              onChange={(ev) => setCustomerNumber(ev.target.value)}
              className="input font-mono"
              placeholder="0001042"
            />
          </label>

          {editing && (
            <div className="flex flex-col gap-1 text-xs">
              <ChoicePills
                label="Active"
                name="quote-customer-active"
                options={["Yes", "No"]}
                value={active ? "Yes" : "No"}
                onChange={(v) => setActive(v === "Yes")}
                disabled={pending}
              />
              <span className="text-[11px] text-fg-muted">
                A retired customer leaves the picker; quotes already naming it keep showing it.
              </span>
            </div>
          )}

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-fg-muted">Note (optional)</span>
            <textarea value={note} onChange={(ev) => setNote(ev.target.value)} rows={2} className="input" />
          </label>

          {error && (
            <div role="alert" className="rounded-md border border-cooper-red/40 bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">
              {error}
            </div>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {editing ? "Save" : "Add customer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
