import { useMemo, useState } from "react";
import { ClipboardCheck, Plus } from "lucide-react";
import { useQcCpu95Records } from "@/hooks/useQcCpu95";
import type { QcCpu95Record } from "@/types/task";
import { qcCpu95Status, qcCpu95StatusSortKey, type QcCpu95Status } from "@/lib/qcCpu95Mapper";
import { fromDateInputValue, formatSpDate } from "@/lib/spDates";
import { tokenizeQuery } from "@/lib/itemSearch";
import type { SortColumn } from "@/lib/tableSort";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SearchInput } from "@/components/SearchInput";
import { LoadingTasks } from "@/components/LoadingTasks";
import { DetailTopBar } from "@/components/DetailTopBar";
import { SortableHeader } from "@/components/SortableTableHeader";
import { QcCpu95FormModal } from "@/components/QcCpu95FormModal";

// =============================================================================
// QCFRM-012 (CPU-95) — list of submitted test sheets.
//
// A plain table, not a detail-page + list pair: clicking a row opens the SAME
// giant form modal in edit mode, matching QC Time Tracking's "no detail page"
// shape. Any signed-in user can add or edit a sheet; there is no delete (see
// api/qcCpu95.ts).
// =============================================================================

const STATUS_LABEL: Record<QcCpu95Status, string> = {
  new: "In Process",
  queued: "In Queue",
  repair: "In Repair",
  complete: "Complete",
};

const STATUS_DOT: Record<QcCpu95Status, string> = {
  new: "bg-ajax-yellow",
  queued: "bg-superior-blue",
  repair: "bg-cooper-red",
  complete: "bg-cooper-green",
};

function matches(record: QcCpu95Record, query: string): boolean {
  if (!query) return true;
  const haystack = [
    record.values.serialNumber,
    record.values.altronicPartNumber,
    record.values.customer,
    record.values.testStandNumber,
    record.values.testMemoryNumber,
    record.values.finalTestBy,
    record.values.finalInspectionBy,
    record.values.comments,
  ]
    .join(" ")
    .toLowerCase();
  return tokenizeQuery(query).every((token) => haystack.includes(token));
}

const COLUMNS: SortColumn<QcCpu95Record>[] = [
  {
    key: "status",
    label: "Status",
    kind: "number",
    value: (r) => STATUS_LABEL[qcCpu95Status(r)],
    sortValue: (r) => qcCpu95StatusSortKey(r),
  },
  { key: "serialNumber", label: "Serial / Unit #", value: (r) => r.values.serialNumber || "" },
  {
    key: "altronicPartNumber",
    label: "Altronic Part #",
    value: (r) => r.values.altronicPartNumber || "",
  },
  { key: "customer", label: "Customer", value: (r) => r.values.customer || "" },
  {
    key: "testStandNumber",
    label: "Test Stand #",
    kind: "numeric-text",
    value: (r) => r.values.testStandNumber || "",
  },
  {
    key: "dateTested",
    label: "Date Tested",
    kind: "date",
    value: (r) => r.values.dateTested || "",
    sortValue: (r) => fromDateInputValue(r.values.dateTested || ""),
  },
  { key: "finalTestBy", label: "Final Test By", value: (r) => r.values.finalTestBy || "" },
  {
    key: "finalInspectionDate",
    label: "Final Inspection Date",
    kind: "date",
    value: (r) => r.values.finalInspectionDate || "",
    sortValue: (r) => fromDateInputValue(r.values.finalInspectionDate || ""),
  },
];

export function QcCpu95View() {
  const { data: records = [], isLoading } = useQcCpu95Records();
  const [query, setQuery] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<QcCpu95Record | null>(null);

  const filtered = useMemo(
    () => records.filter((r) => matches(r, query)),
    [records, query],
  );

  const table = useSortableTable({
    rows: filtered,
    columns: COLUMNS,
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
            QCFRM-012 — CPU-95 Ignition Module
          </h1>
          <p className="text-sm text-fg-muted">
            Electrical test and inspection — CPU-95, CPU-95C, Varispark, and EVS variants.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          New Test Sheet
        </button>
      </header>

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search serial#, part#, customer, test stand, tester…"
      />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
          <h2 className="text-sm font-medium text-fg">
            {isLoading
              ? "Loading…"
              : `${table.rows.length} sheet${table.rows.length === 1 ? "" : "s"}`}
            {!isLoading && table.rows.length !== records.length && (
              <span className="ml-1 text-fg-muted">of {records.length}</span>
            )}
          </h2>
        </div>

        {isLoading ? (
          <LoadingTasks noun="CPU-95 test sheets" />
        ) : table.rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            {query
              ? "No test sheets match that search."
              : 'No test sheets yet. Click "New Test Sheet" to add the first.'}
          </div>
        ) : (
          <>
            {/* Phone: a card per sheet — the table's eight columns don't fit a
                narrow screen even truncated, so most of them would render as
                a wall of dashes. Every field gets its own labelled row instead. */}
            <div className="divide-y divide-border sm:hidden">
              {table.rows.map((record) => (
                <RecordCard key={record.id} record={record} onEdit={() => setEditing(record)} />
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    {COLUMNS.map(({ key, label }) => (
                      <SortableHeader key={key} label={label} {...table.headerProps(key)} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((record) => (
                    <Row key={record.id} record={record} onEdit={() => setEditing(record)} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showNew && <QcCpu95FormModal onClose={() => setShowNew(false)} />}
      {editing && <QcCpu95FormModal record={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Row({ record, onEdit }: { record: QcCpu95Record; onEdit: () => void }) {
  const status = qcCpu95Status(record);
  return (
    <tr
      onClick={onEdit}
      className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
    >
      <td className="px-4 py-2">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`}
          title={STATUS_LABEL[status]}
        />
      </td>
      <td className="whitespace-nowrap px-4 py-2 font-medium text-fg">
        {record.values.serialNumber || "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
        {record.values.altronicPartNumber || "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
        {record.values.customer || "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
        {record.values.testStandNumber || "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">
        {formatSpDate(fromDateInputValue(record.values.dateTested || ""))}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
        {record.values.finalTestBy || "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">
        {formatSpDate(fromDateInputValue(record.values.finalInspectionDate || ""))}
      </td>
    </tr>
  );
}

/** One test sheet, phone layout — status + serial number lead, everything else is a labelled row. */
function RecordCard({ record, onEdit }: { record: QcCpu95Record; onEdit: () => void }) {
  const status = qcCpu95Status(record);
  const rows: Array<[string, string]> = [
    ["Altronic Part #", record.values.altronicPartNumber || "—"],
    ["Customer", record.values.customer || "—"],
    ["Test Stand #", record.values.testStandNumber || "—"],
    ["Date Tested", formatSpDate(fromDateInputValue(record.values.dateTested || ""))],
    ["Final Test By", record.values.finalTestBy || "—"],
    ["Final Inspection Date", formatSpDate(fromDateInputValue(record.values.finalInspectionDate || ""))],
  ];
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
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
          title={STATUS_LABEL[status]}
        />
        <span className="min-w-0 flex-1 truncate font-medium text-fg">
          {record.values.serialNumber || "—"}
        </span>
        <span className="shrink-0 text-xs text-fg-muted">{STATUS_LABEL[status]}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="truncate text-right text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </button>
  );
}
