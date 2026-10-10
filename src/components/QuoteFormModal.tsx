import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Loader2, X } from "lucide-react";
import {
  DEFAULT_BUDGETARY_TEXT,
  DEFAULT_QUOTE_VALIDITY_DAYS,
  type Quote,
} from "@/types/quote";
import type { QuotePatch } from "@/lib/quoteMapper";
import { manageCustomersGate } from "@/lib/quoteRoles";
import { useCreateQuote, useUpdateQuoteFields } from "@/hooks/useQuotes";
import { useQuoteCustomers } from "@/hooks/useQuoteCustomers";
import { useMyQuoteAccess } from "@/hooks/useQuoteRoles";
import { useFormDraft } from "@/hooks/useFormDraft";
import { SingleSelect } from "./SearchableSelect";
import { ChoicePills } from "./ChoicePills";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { DraftRestoredNotice } from "./DraftRestoredNotice";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// New quote / edit a quote's header.
//
// The quote NUMBER is never typed — `IQ-<customer code>-<global seq>-R1`,
// computed by the API from a fresh read at save time. So the customer can only
// be picked on CREATE: it is baked into the number, and a quote for another
// customer is another quote.
//
// Only ACTIVE customers are offered. Only a quote manager adds customers — the
// picker says so, and links to the customer list for someone who can.
//
// Budgetary: every new-product quote is budgetary unless unticked, so it
// defaults to Yes on create. Ticking it with an EMPTY text seeds the default
// wording; text somebody has written is never overwritten. Budgetary text and
// Quote notes PRINT on the customer's quote, and say so beside them.
//
// Create only keeps a draft (useFormDraft); an edit is seeded from the record.
// =============================================================================

interface QuoteFormModalProps {
  /** Present = edit this quote's header; absent = raise a new quote. */
  quote?: Quote;
  onClose: () => void;
  /** Called with the saved quote's id (create and edit). */
  onSaved?: (id: number) => void;
}

type DraftFields = {
  contactName: string;
  contactEmail: string;
  validityDays: string;
  budgetaryText: string;
  quoteNotes: string;
};

export const PRINTED_NOTE = "Printed on the customer's quote.";

export function QuoteFormModal({ quote, onClose, onSaved }: QuoteFormModalProps) {
  const editing = !!quote;
  const create = useCreateQuote();
  const update = useUpdateQuoteFields();
  const busy = create.isPending || update.isPending;
  const access = useMyQuoteAccess();
  const canAddCustomers = manageCustomersGate(access).allowed;
  const { data: customers = [] } = useQuoteCustomers();

  const draft = useFormDraft<DraftFields>(editing ? null : "newQuote");
  const [text, setText] = useState<DraftFields>(() => ({
    contactName: quote?.contactName ?? "",
    contactEmail: quote?.contactEmail ?? "",
    validityDays: String(quote?.validityDays ?? DEFAULT_QUOTE_VALIDITY_DAYS),
    budgetaryText: quote ? quote.budgetaryText : DEFAULT_BUDGETARY_TEXT,
    quoteNotes: quote?.quoteNotes ?? "",
    ...draft.initial,
  }));
  useEffect(() => {
    if (!editing) draft.save(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const [customerId, setCustomerId] = useState<string | null>(
    quote?.customerId !== null && quote?.customerId !== undefined ? String(quote.customerId) : null,
  );
  const [budgetary, setBudgetary] = useState<boolean>(quote ? quote.budgetary : true);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const customerOptions = useMemo(
    () =>
      customers
        .filter((c) => c.active)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` })),
    [customers],
  );
  const currentCustomer = quote ? customers.find((c) => c.id === quote.customerId) : undefined;

  useEffect(() => {
    if (editing) firstFieldRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  function setField(key: keyof DraftFields, value: string) {
    setText((prev) => ({ ...prev, [key]: value }));
  }

  function pickBudgetary(v: string) {
    const on = v === "Yes";
    setBudgetary(on);
    // Seed only an EMPTY text — wording somebody wrote is never overwritten.
    if (on && !text.budgetaryText.trim()) setField("budgetaryText", DEFAULT_BUDGETARY_TEXT);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validity = Number(text.validityDays);
    if (!editing && !customerId) return setError("Pick a customer.");
    if (!Number.isInteger(validity) || validity < 1) {
      return setError("Validity must be a whole number of days, 1 or more.");
    }
    const email = text.contactEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return setError("The contact email doesn't look like an email address.");
    }
    setError(null);

    try {
      if (quote) {
        const next: Required<Pick<QuotePatch, "contactName" | "contactEmail" | "validityDays" | "budgetary" | "budgetaryText" | "quoteNotes">> = {
          contactName: text.contactName.trim(),
          contactEmail: email,
          validityDays: validity,
          budgetary,
          budgetaryText: text.budgetaryText,
          quoteNotes: text.quoteNotes,
        };
        const patch: QuotePatch = {};
        for (const key of Object.keys(next) as (keyof typeof next)[]) {
          if (next[key] !== quote[key]) (patch as Record<string, unknown>)[key] = next[key];
        }
        if (Object.keys(patch).length > 0) await update.mutateAsync({ id: quote.id, patch });
        onClose();
        onSaved?.(quote.id);
        return;
      }
      const customer = customers.find((c) => String(c.id) === customerId);
      if (!customer) return setError("Pick a customer.");
      const created = await create.mutateAsync({
        customerId: customer.id,
        customerCode: customer.code,
        contactName: text.contactName.trim(),
        contactEmail: email,
        validityDays: validity,
        budgetary,
        budgetaryText: text.budgetaryText,
        quoteNotes: text.quoteNotes,
      });
      draft.clear();
      onClose();
      onSaved?.(created.id);
    } catch {
      setError("Couldn't save — see the message above the page, and try again.");
    }
  }

  const title = quote ? `Edit ${quote.quoteNumber}` : "New quote";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
              <FileText className="h-4 w-4 text-accent" />
              {title}
            </h2>
            <p className="text-[11px] text-fg-muted">
              {quote ? "The quote number and customer don't change." : "The quote number is assigned on save."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form id="quote-form" noValidate onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {draft.restored && (
            <div className="mb-4">
              <DraftRestoredNotice
                note="Only the text fields were kept — re-pick the customer."
                onDiscard={() => {
                  draft.clear();
                  setText({
                    contactName: "",
                    contactEmail: "",
                    validityDays: String(DEFAULT_QUOTE_VALIDITY_DAYS),
                    budgetaryText: DEFAULT_BUDGETARY_TEXT,
                    quoteNotes: "",
                  });
                }}
                onKeep={draft.dismissNotice}
              />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Customer" required={!editing} plain className="sm:col-span-2">
              {editing ? (
                <p className="text-sm text-fg">
                  {currentCustomer ? `${currentCustomer.name} (${currentCustomer.code})` : "No customer"}
                </p>
              ) : (
                <>
                  <SingleSelect
                    selected={customerId}
                    onChange={setCustomerId}
                    options={customerOptions}
                    allLabel="Pick a customer"
                    ariaLabel="Customer"
                    searchPlaceholder="Search customers…"
                    disabled={busy}
                  />
                  <p className="mt-1 text-[11px] text-fg-muted">
                    Not listed? Only a quote manager can add customers.{" "}
                    {canAddCustomers && (
                      <Link to="/sales/quotes/customers" className="text-accent underline-offset-2 hover:underline">
                        Add a customer
                      </Link>
                    )}
                  </p>
                </>
              )}
            </Field>

            <Field label="Contact name">
              <input
                ref={firstFieldRef}
                value={text.contactName}
                onChange={(e) => setField("contactName", e.target.value)}
                className="input"
                disabled={busy}
              />
            </Field>

            <Field label="Contact email">
              <input
                type="email"
                value={text.contactEmail}
                onChange={(e) => setField("contactEmail", e.target.value)}
                className="input"
                disabled={busy}
              />
            </Field>

            <Field label="Validity (days)" required>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={text.validityDays}
                onChange={(e) => setField("validityDays", e.target.value)}
                className="input"
                disabled={busy}
              />
            </Field>

            <Field label="Budgetary" plain>
              <ChoicePills
                label="Budgetary"
                name="quote-budgetary"
                options={["Yes", "No"]}
                value={budgetary ? "Yes" : "No"}
                onChange={pickBudgetary}
                disabled={busy}
              />
            </Field>

            {budgetary && (
              <Field label="Budgetary text" className="sm:col-span-2" hint={PRINTED_NOTE}>
                <AutoGrowTextarea
                  style={{ minHeight: "5rem" }}
                  value={text.budgetaryText}
                  onChange={(e) => setField("budgetaryText", e.target.value)}
                  rows={4}
                  className="input resize-y"
                  disabled={busy}
                />
              </Field>
            )}

            <Field label="Quote notes" className="sm:col-span-2" hint={PRINTED_NOTE}>
              <AutoGrowTextarea
                style={{ minHeight: "4rem" }}
                value={text.quoteNotes}
                onChange={(e) => setField("quoteNotes", e.target.value)}
                rows={3}
                placeholder="e.g. Prices FOB Girard, OH. Lead time 6–8 weeks ARO."
                className="input resize-y"
                disabled={busy}
              />
            </Field>
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm text-cooper-red">
              {error}
            </p>
          )}
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="quote-form"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editing ? "Save" : "Create quote"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  required,
  className,
  plain,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  /** Render a <div> instead of a <label> — for controls that label themselves. */
  plain?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  const Wrapper = plain ? "div" : "label";
  return (
    <Wrapper className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-1 text-cooper-red">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] font-semibold text-fg-muted">{hint}</span>}
    </Wrapper>
  );
}
