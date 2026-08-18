import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin, X } from "lucide-react";
import {
  US_STATES,
  VISIT_CUSTOMER_STATUSES,
  VISIT_REASONS,
  type VisitReport,
  type VisitReportInput,
} from "@/types/task";
import { useCreateVisitReport, useUpdateVisitReport, useVisitReports } from "@/hooks/useVisitReports";
import { rmNameOptions } from "@/lib/visitReportMapper";
import { toDateInputValue, fromDateInputValue } from "@/lib/spDates";
import { ChoiceSelect } from "./SearchableSelect";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { DateField } from "./DateField";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// New / Edit Visit Report.
//
// The six fields SharePoint marks required are required here too — Customer
// Name, RM Name, Reason, Visit Date, Customer Status and Visit Summary. The
// rest (Action Items, Product, City, State) are optional, because plenty of
// real reports have them blank.
//
// The RM Name picker offers the column's choices PLUS anyone already in the
// data, so editing a 2022 report doesn't quietly reassign it to whoever
// happens to be in the list today. See rmNameOptions.
// =============================================================================

interface VisitReportFormModalProps {
  /** Omit to create a new report; pass one to edit it. */
  report?: VisitReport;
  onClose: () => void;
  /** Called with the new report's id after a successful create. */
  onCreated?: (id: number) => void;
}

function emptyDraft(): VisitReportInput {
  return {
    customerName: "",
    rmName: "",
    reasonForVisit: "",
    visitSummary: "",
    actionItems: "",
    // A report is normally filed the day of (or just after) the visit.
    visitDate: fromDateInputValue(toDateInputValue(new Date())),
    customerStatus: "",
    product: "",
    city: "",
    state: "",
  };
}

function draftFrom(report: VisitReport): VisitReportInput {
  return {
    customerName: report.customerName,
    rmName: report.rmName,
    reasonForVisit: report.reasonForVisit,
    visitSummary: report.visitSummary,
    actionItems: report.actionItems,
    visitDate: report.visitDate,
    customerStatus: report.customerStatus,
    product: report.product,
    city: report.city,
    state: report.state,
  };
}

export function VisitReportFormModal({
  report,
  onClose,
  onCreated,
}: VisitReportFormModalProps) {
  const mode = report ? "edit" : "create";
  const { data: reports = [] } = useVisitReports();
  const create = useCreateVisitReport();
  const update = useUpdateVisitReport();
  const busy = create.isPending || update.isPending;

  const [draft, setDraft] = useState<VisitReportInput>(() =>
    report ? draftFrom(report) : emptyDraft(),
  );
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const managers = useMemo(() => rmNameOptions(reports), [reports]);
  const overlayDismiss = useOverlayDismiss(onClose, busy);

  function set<K extends keyof VisitReportInput>(key: K, value: VisitReportInput[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.customerName.trim()) return setError("Customer Name is required.");
    if (!draft.rmName) return setError("RM Name is required.");
    if (!draft.reasonForVisit) return setError("Reason For Visit is required.");
    if (!draft.visitDate) return setError("Visit Date is required.");
    if (!draft.customerStatus) return setError("Customer Status is required.");
    if (!draft.visitSummary.trim()) return setError("Visit Summary is required.");
    setError(null);

    try {
      if (report) {
        await update.mutateAsync({ id: report.id, input: draft });
        onClose();
      } else {
        const created = await create.mutateAsync(draft);
        onClose();
        onCreated?.(created.id);
      }
    } catch {
      // The hook toasts the reason; keep the modal open so nothing is lost.
      setError("Couldn't save — see the message above the page, and try again.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "create" ? "New visit report" : "Edit visit report"}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <MapPin className="h-4 w-4 text-accent" />
            {mode === "create" ? "New Visit Report" : "Edit Visit Report"}
          </h2>
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

        <form
          id="visit-report-form"
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Customer Name" required>
              <input
                ref={firstFieldRef}
                value={draft.customerName}
                onChange={(e) => set("customerName", e.target.value)}
                placeholder="Who did you visit?"
                className="input"
              />
            </Field>

            <Field label="RM Name" required>
              <ChoiceSelect
                value={draft.rmName}
                onChange={(v) => set("rmName", v)}
                options={managers}
                emptyLabel="Pick a regional manager"
                searchPlaceholder="Search managers…"
                disabled={busy}
              />
            </Field>

            <Field label="Reason For Visit" required>
              <ChoiceSelect
                value={draft.reasonForVisit}
                onChange={(v) => set("reasonForVisit", v)}
                options={VISIT_REASONS}
                emptyLabel="Pick a reason"
                disabled={busy}
              />
            </Field>

            <Field label="Visit Date" required>
              <DateField
                value={toDateInputValue(draft.visitDate)}
                onChange={(v) => set("visitDate", fromDateInputValue(v))}
                disabled={busy}
              />
            </Field>

            <Field label="Customer Status" required>
              <ChoiceSelect
                value={draft.customerStatus}
                onChange={(v) => set("customerStatus", v)}
                options={VISIT_CUSTOMER_STATUSES}
                emptyLabel="Pick a status"
                disabled={busy}
              />
            </Field>

            <Field label="Product(s)">
              <input
                value={draft.product}
                onChange={(e) => set("product", e.target.value)}
                placeholder="What was the visit about?"
                className="input"
              />
            </Field>

            <Field label="City">
              <input
                value={draft.city}
                onChange={(e) => set("city", e.target.value)}
                placeholder="Enter city"
                className="input"
              />
            </Field>

            <Field label="State">
              <ChoiceSelect
                value={draft.state}
                onChange={(v) => set("state", v)}
                options={US_STATES}
                emptyLabel="Pick a state"
                searchPlaceholder="Search states…"
                disabled={busy}
              />
            </Field>

            <Field label="Visit Summary" required className="sm:col-span-2">
              <AutoGrowTextarea
                style={{ minHeight: "7rem" }}
                value={draft.visitSummary}
                onChange={(e) => set("visitSummary", e.target.value)}
                rows={4}
                placeholder="What happened on the visit?"
                className="input resize-y"
              />
            </Field>

            <Field label="Action Items" className="sm:col-span-2">
              <AutoGrowTextarea
                style={{ minHeight: "5rem" }}
                value={draft.actionItems}
                onChange={(e) => set("actionItems", e.target.value)}
                rows={3}
                placeholder="What needs doing next? One per line."
                className="input resize-y"
              />
            </Field>
          </div>

          {error && <p className="mt-4 text-sm text-cooper-red">{error}</p>}

          {mode === "create" && (
            <p className="mt-4 text-[11px] text-fg-muted">
              Attachments — photos, quotes, notes — can be added once the report
              is saved.
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
            form="visit-report-form"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {mode === "create" ? "File report" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-1 text-cooper-red">*</span>}
      </span>
      {children}
    </label>
  );
}
