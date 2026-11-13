import { useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { ClipboardCheck, Plus } from "lucide-react";
import { useQcFormRecords } from "@/hooks/useQcForms";
import {
  QC_FORM_STATUS_LABEL,
  qcFormStatus,
  qcFormStatusSortKey,
  qcNounHeading,
  type QcFormRecord,
  type QcFormSpec,
  type QcFormStatus,
  type QcListColumn,
} from "@/lib/qcFormEngine";
import { qcFormById } from "@/lib/qcForms";
import { fromDateInputValue, formatSpDate } from "@/lib/spDates";
import { tokenizeQuery } from "@/lib/itemSearch";
import type { SortColumn } from "@/lib/tableSort";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SearchInput } from "@/components/SearchInput";
import { LoadingTasks } from "@/components/LoadingTasks";
import { DetailTopBar } from "@/components/DetailTopBar";
import { SortableHeader } from "@/components/SortableTableHeader";
import { QcFormModal } from "@/components/QcFormModal";
import { QcFormExportButton } from "@/components/QcFormExportButton";
import { generateQcFormPdf, qcFormPdfFileName } from "@/lib/qcFormPdf";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { toIsoDate } from "@/lib/dateInput";

// =============================================================================
// Any QC form's list of submitted sheets — `/qc-forms/:formId`, one screen for
// every form in the registry (lib/qcForms.ts).
//
// A plain table, not a detail-page + list pair: clicking a row opens the SAME
// form modal in edit mode, matching QC Time Tracking's "no detail page" shape.
// Any signed-in user can add or edit a sheet; there is no delete (see
// api/qcForms.ts).
// =============================================================================

const STATUS_DOT: Record<QcFormStatus, string> = {
  new: "bg-ajax-yellow",
  queued: "bg-superior-blue",
  repair: "bg-cooper-red",
  complete: "bg-cooper-green",
};

/** The route: the form whose id is in the URL, or back to the landing page for one that isn't there. */
export function QcFormPage() {
  const { formId } = useParams();
  const spec = qcFormById(formId);
  if (!spec) return <Navigate to="/qc-forms" replace />;
  return <QcFormView key={spec.id} spec={spec} />;
}

function cellText(column: QcListColumn, record: QcFormRecord): string {
  const raw = record.values[column.key] || "";
  return column.kind === "date" ? formatSpDate(fromDateInputValue(raw)) : raw || "—";
}

function sortColumns(spec: QcFormSpec): SortColumn<QcFormRecord>[] {
  return [
    {
      key: "status",
      label: "Status",
      kind: "number",
      value: (r) => QC_FORM_STATUS_LABEL[qcFormStatus(spec, r)],
      sortValue: (r) => qcFormStatusSortKey(spec, r),
    },
    ...spec.list.columns.map((c): SortColumn<QcFormRecord> =>
      c.kind === "date"
        ? {
            key: c.key,
            label: c.label,
            kind: "date",
            value: (r) => r.values[c.key] || "",
            sortValue: (r) => fromDateInputValue(r.values[c.key] || ""),
          }
        : { key: c.key, label: c.label, kind: c.kind, value: (r) => r.values[c.key] || "" },
    ),
  ];
}

export function QcFormView({ spec }: { spec: QcFormSpec }) {
  const { data: records = [], isLoading } = useQcFormRecords(spec);
  const [query, setQuery] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<QcFormRecord | null>(null);
  const [blankVariant, setBlankVariant] = useState("");

  const columns = useMemo(() => sortColumns(spec), [spec]);
  const blankVariants = spec.sheet.blankVariants;
  const heading = qcNounHeading(spec);

  const filtered = useMemo(() => {
    if (!query) return records;
    const tokens = tokenizeQuery(query);
    return records.filter((r) => {
      const haystack = spec.list.searchKeys.map((k) => r.values[k]).join(" ").toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [records, query, spec]);

  const table = useSortableTable({
    rows: filtered,
    columns,
    stableKey: (r) => r.id,
    initialKey: "status",
    initialDirection: "asc",
  });

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="QC Forms" listTo="/qc-forms" />

      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
          <ClipboardCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            {spec.formNumber} — {spec.name}
          </h1>
          <p className="text-sm text-fg-muted">{spec.pageDescription}</p>
        </div>
        {/* Which unit the blank form is for — only its lines, or every variant's. */}
        <div className="flex w-full items-center gap-2 sm:w-auto">
          {blankVariants && (
            <div className="min-w-0 flex-1 sm:w-64 sm:flex-none">
              <ChoiceSelect
                value={blankVariant}
                onChange={setBlankVariant}
                options={blankVariants.map((v) => ({ value: v.id, label: v.label }))}
                emptyLabel={spec.sheet.blankVariantsEmptyLabel ?? "Every variant"}
                ariaLabel="Blank form for"
                title="Which unit the blank form is for"
              />
            </div>
          )}
          <div className="shrink-0 whitespace-nowrap">
            <QcFormExportButton
              label="Blank form"
              title={`Download a blank ${spec.formNumber} sheet (PDF) to fill in by hand`}
              build={async () => ({
                blob: await generateQcFormPdf(spec, null, {
                  exportedOn: toIsoDate(new Date()),
                  blankVariantId: blankVariant || null,
                }),
                fileName: qcFormPdfFileName(spec, null, blankVariant || null),
              })}
            />
          </div>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          New {heading}
        </button>
      </header>

      <SearchInput value={query} onChange={setQuery} placeholder={spec.list.searchPlaceholder} />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
          <h2 className="text-sm font-medium text-fg">
            {isLoading ? "Loading…" : `${table.rows.length} sheet${table.rows.length === 1 ? "" : "s"}`}
            {!isLoading && table.rows.length !== records.length && (
              <span className="ml-1 text-fg-muted">of {records.length}</span>
            )}
          </h2>
        </div>

        {isLoading ? (
          <LoadingTasks noun={`${spec.shortName} ${spec.noun}s`} />
        ) : table.rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            {query
              ? `No ${spec.noun}s match that search.`
              : `No ${spec.noun}s yet. Click "New ${heading}" to add the first.`}
          </div>
        ) : (
          <>
            {/* Phone: a card per sheet — the table's columns don't fit a narrow
                screen even truncated, so most of them would render as a wall
                of dashes. Every column gets its own labelled row instead. */}
            <div className="divide-y divide-border sm:hidden">
              {table.rows.map((record) => (
                <RecordCard key={record.id} spec={spec} record={record} onEdit={() => setEditing(record)} />
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    {columns.map(({ key, label }) => (
                      <SortableHeader key={key} label={label} {...table.headerProps(key)} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((record) => (
                    <Row key={record.id} spec={spec} record={record} onEdit={() => setEditing(record)} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showNew && <QcFormModal spec={spec} onClose={() => setShowNew(false)} />}
      {editing && <QcFormModal spec={spec} record={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function StatusDot({ status, className = "" }: { status: QcFormStatus; className?: string }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]} ${className}`}
      title={QC_FORM_STATUS_LABEL[status]}
    />
  );
}

function Row({ spec, record, onEdit }: { spec: QcFormSpec; record: QcFormRecord; onEdit: () => void }) {
  return (
    <tr onClick={onEdit} className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2">
      <td className="px-4 py-2">
        <StatusDot status={qcFormStatus(spec, record)} />
      </td>
      {spec.list.columns.map((column, i) => (
        <td
          key={column.key}
          className={`whitespace-nowrap px-4 py-2 ${i === 0 ? "font-medium text-fg" : "text-fg-muted"} ${
            column.kind === "date" ? "tabular-nums" : ""
          }`}
        >
          {cellText(column, record)}
        </td>
      ))}
    </tr>
  );
}

/** One sheet, phone layout — status + the first column lead, every other column is a labelled row. */
function RecordCard({ spec, record, onEdit }: { spec: QcFormSpec; record: QcFormRecord; onEdit: () => void }) {
  const status = qcFormStatus(spec, record);
  const [titleColumn, ...rest] = spec.list.columns;
  return (
    // A real <button>, not a <div> — unlike QC Time Tracking's card, there's
    // no delete/edit icon competing for the tap target here, so the whole
    // card can be the one button.
    <button
      type="button"
      onClick={onEdit}
      className="flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-2"
    >
      <div className="flex items-center gap-2">
        <StatusDot status={status} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{cellText(titleColumn, record)}</span>
        <span className="shrink-0 text-xs text-fg-muted">{QC_FORM_STATUS_LABEL[status]}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        {rest.map((column) => (
          <div key={column.key} className="contents">
            <dt className="text-fg-muted">{column.label}</dt>
            <dd className="truncate text-right text-fg">{cellText(column, record)}</dd>
          </div>
        ))}
      </dl>
    </button>
  );
}
