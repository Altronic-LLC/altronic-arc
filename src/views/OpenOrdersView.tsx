import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Info,
  Lock,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  useDownloadOpenOrdersFile,
  useDownloadWeekAsZip,
  useGenerateOpenOrders,
  useMasterReports,
  useOpenOrdersWeekFiles,
  useOpenOrdersWeeks,
  useParseExtract,
  useRawUploads,
  weekFolderFor,
  type ParsedExtract,
} from "@/hooks/useOpenOrdersReports";
import {
  useMyOpenOrdersAccess,
  useOpenOrdersCustomers,
} from "@/hooks/useOpenOrdersCustomers";
import {
  accountsWithNoLines,
  customerRollup,
  formatByCurrency,
  metricsFor,
} from "@/lib/openOrders";
import { OPEN_ORDERS_PATH } from "@/api/openOrdersFiles";
import { SP_OPEN_ORDERS_CUSTOMERS_LIST_ID, USE_MOCK } from "@/api/config";
import { LoadingTasks } from "@/components/LoadingTasks";
import { DateField } from "@/components/DateField";
import { toDateInputValue, fromDateInputValue } from "@/lib/spDates";
import { cn } from "@/lib/cn";

// =============================================================================
// Open Orders Report Tool — the files first, the tool second.
//
// Reading top to bottom: the latest master dashboard → this week's customer
// workbooks, already expanded → a button that opens the generating tool → the
// raw extracts behind it.
//
// **The upload form is deliberately NOT the first thing on the screen** (Ray,
// 2026-08-24). One person runs this once a week; everybody else arrives to take
// a file off the shelf, and leading with an upload form made the page look like
// a job to do rather than somewhere to fetch a report.
//
// The cadence is still stated in words, on the button that opens the tool
// (Ray, 2026-08-24: "the upload section of this app should be clear that this
// is done once a week"). ARC has no server and no scheduler, so nothing here
// happens unless somebody does it, and the screen had better not imply
// otherwise.
// =============================================================================

const CADENCE_NOTE =
  "This is a once-a-week job. Export the open orders report out of SAP, upload it here, " +
  "and ARC rebuilds the master dashboard and every customer's workbook in one pass.";

export function OpenOrdersView() {
  const access = useMyOpenOrdersAccess();
  const { data: accounts = [], isLoading: accountsLoading } = useOpenOrdersCustomers();
  const { data: masters = [], isLoading: mastersLoading } = useMasterReports();
  const { data: weeks = [], isLoading: weeksLoading } = useOpenOrdersWeeks();
  const { data: rawUploads = [] } = useRawUploads();

  // The newest week is open on arrival, so the individual files are THERE
  // rather than one click away — reading them is what most people came for
  // (Ray, 2026-08-24). `undefined` means "nobody has chosen yet, use the
  // default"; `null` means a person deliberately collapsed it.
  const [weekOverride, setWeekOverride] = useState<string | null | undefined>(undefined);
  const openWeek = weekOverride === undefined ? (weeks[0]?.name ?? null) : weekOverride;
  const { data: weekFiles = [], isLoading: weekFilesLoading } = useOpenOrdersWeekFiles(openWeek);

  // The tool itself is folded away. One person runs it once a week; everybody
  // else is here to download, and putting the upload form first made the
  // screen look like a job to do rather than a shelf to take a file off.
  const [toolOpen, setToolOpen] = useState(false);

  const download = useDownloadOpenOrdersFile();
  const downloadZip = useDownloadWeekAsZip();

  if (accountsLoading || mastersLoading || weeksLoading) return <LoadingTasks />;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-fg sm:text-2xl">
          <FileSpreadsheet className="h-6 w-6 text-accent" />
          Open Orders Report Tool
        </h1>
        <p className="max-w-3xl text-sm text-fg-muted">
          The latest open orders dashboard, and each customer's own workbook to send
          on. Download what you need below.
        </p>
        <p className="text-xs text-fg-muted">
          Files live in SharePoint under{" "}
          <span className="font-mono text-[11px]">{OPEN_ORDERS_PATH}</span> — master
          dashboards at the top, one folder per week for the customer workbooks.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <SectionHeading
          icon={<FileSpreadsheet className="h-4 w-4" />}
          title="Master dashboard"
          note="The company-wide view. The newest one is the current week's."
        />
        {masters.length === 0 ? (
          <Empty>No master dashboard yet — build one with the tool below.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {masters.map((file, i) => (
              <li key={file.id} className="flex items-center gap-3 px-4 py-3">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-cooper-green" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-fg">{file.name}</span>
                    {i === 0 && (
                      <span className="shrink-0 rounded-full bg-cooper-green/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cooper-green">
                        Latest
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-fg-muted">
                    {formatSize(file.sizeBytes)} · {formatWhen(file.lastModified)}
                  </span>
                </div>
                <DownloadButton
                  onClick={() => download.mutate({ id: file.id, name: file.name })}
                  busy={download.isPending}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading
          icon={<FolderOpen className="h-4 w-4" />}
          title="Customer workbooks, by week"
          note="Download from here and send them on. One folder per week."
        />
        {weeks.length === 0 ? (
          <Empty>No weekly folders yet — the tool below creates one per week.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {weeks.map((week) => {
              const isOpen = openWeek === week.name;
              return (
                <li
                  key={week.id}
                  className="overflow-hidden rounded-lg border border-border bg-surface"
                >
                  <button
                    type="button"
                    onClick={() => setWeekOverride(isOpen ? null : week.name)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                  >
                    <FolderOpen
                      className={cn("h-4 w-4 shrink-0", isOpen ? "text-accent" : "text-fg-muted")}
                    />
                    <span className="flex-1 text-sm font-medium text-fg">{week.name}</span>
                    <span className="text-xs text-fg-muted">
                      {week.fileCount} file{week.fileCount === 1 ? "" : "s"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-border">
                      {weekFilesLoading ? (
                        <p className="px-4 py-3 text-sm text-fg-muted">Loading…</p>
                      ) : weekFiles.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-fg-muted">
                          This folder is empty.
                        </p>
                      ) : (
                        <>
                          {/* Bulk download sits ABOVE the list, not beside a
                              row — it covers every file below it, and putting
                              it next to one row would read as downloading
                              just that customer's file. Individual downloads
                              stay on each row for the common case: sending
                              one customer their own workbook. */}
                          <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2/50 px-4 py-2">
                            <span className="text-xs text-fg-muted">
                              {weekFiles.length} file{weekFiles.length === 1 ? "" : "s"} in this
                              folder
                            </span>
                            <button
                              type="button"
                              disabled={downloadZip.isPending}
                              onClick={() =>
                                downloadZip.mutate({ weekName: week.name, files: weekFiles })
                              }
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:opacity-60"
                            >
                              <Archive className="h-3.5 w-3.5" />
                              {downloadZip.isPending && downloadZip.progress
                                ? `Zipping ${downloadZip.progress.done}/${downloadZip.progress.total}…`
                                : "Download all"}
                            </button>
                          </div>
                          <ul className="divide-y divide-border">
                            {weekFiles.map((file) => (
                              <li key={file.id} className="flex items-center gap-3 px-4 py-2.5">
                                <FileSpreadsheet className="h-4 w-4 shrink-0 text-superior-blue" />
                                <div className="min-w-0 flex-1">
                                  <span className="block truncate text-sm text-fg">
                                    {file.name}
                                  </span>
                                  <span className="text-xs text-fg-muted">
                                    {formatSize(file.sizeBytes)}
                                  </span>
                                </div>
                                <DownloadButton
                                  onClick={() => download.mutate({ id: file.id, name: file.name })}
                                  busy={download.isPending}
                                />
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* The tool, folded away below the files it produces. */}
      {toolOpen ? (
        <GenerateCard
          accounts={accounts}
          canGenerate={access.isReportManager}
          access={access}
          onClose={() => setToolOpen(false)}
          onFinished={() => {
            setToolOpen(false);
            // Drop back to the default week, which after a run is the week that
            // was just generated — so the files land in view rather than
            // leaving whichever older folder was being browsed expanded.
            setWeekOverride(undefined);
          }}
        />
      ) : (
        <section className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border bg-surface/60 p-4">
          <button
            type="button"
            onClick={() => setToolOpen(true)}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90"
          >
            <Upload className="h-4 w-4" />
            Build this week's reports
          </button>
          <p className="text-xs text-fg-muted">
            {CADENCE_NOTE}
            {!access.isReportManager && !access.isResolving && (
              <>
                {" "}
                Running it needs the report-manager role — downloading doesn't.
              </>
            )}
          </p>
        </section>
      )}

      {rawUploads.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeading
            icon={<Upload className="h-4 w-4" />}
            title="Raw extracts"
            note="The SAP exports the reports were built from, kept as the evidence behind each run."
          />
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {rawUploads.slice(0, 6).map((file) => (
              <li key={file.id} className="flex items-center gap-3 px-4 py-2.5">
                <Upload className="h-4 w-4 shrink-0 text-fg-muted" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{file.name}</span>
                  <span className="text-xs text-fg-muted">{formatWhen(file.lastModified)}</span>
                </div>
                <DownloadButton
                  onClick={() => download.mutate({ id: file.id, name: file.name })}
                  busy={download.isPending}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Upload + generate
// -----------------------------------------------------------------------------

function GenerateCard({
  accounts,
  canGenerate,
  access,
  onClose,
  onFinished,
}: {
  accounts: ReturnType<typeof useOpenOrdersCustomers>["data"] & object;
  canGenerate: boolean;
  access: ReturnType<typeof useMyOpenOrdersAccess>;
  /** The X — leaves everything else alone. */
  onClose: () => void;
  /** A run finished: close up and show what it produced. */
  onFinished: () => void;
}) {
  const { parse, parsing } = useParseExtract();
  const generate = useGenerateOpenOrders();
  const [extract, setExtract] = useState<ParsedExtract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runDate, setRunDate] = useState<Date | null>(() => new Date());
  const [keepRaw, setKeepRaw] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const activeAccounts = useMemo(() => accounts.filter((a) => a.active), [accounts]);
  // "Empty list" and "no list at all" need different words — the second is a
  // setup step, not something to fix on this screen.
  const customersConfigured = USE_MOCK || !!SP_OPEN_ORDERS_CUSTOMERS_LIST_ID;

  const preview = useMemo(() => {
    if (!extract || !runDate) return null;
    const metrics = metricsFor(extract.lines, runDate);
    const rollup = customerRollup(extract.lines, runDate);
    const onList = rollup.filter((r) =>
      activeAccounts.some(
        (a) =>
          a.accountNumber.replace(/^0+/, "").toUpperCase() ===
          r.soldTo.replace(/^0+/, "").toUpperCase(),
      ),
    );
    return {
      metrics,
      customersInExtract: rollup.length,
      willProduce: onList.length,
      missing: accountsWithNoLines(accounts, extract.lines),
    };
  }, [extract, runDate, accounts, activeAccounts]);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setExtract(null);
    setConfirming(false);
    try {
      setExtract(await parse(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that file.");
    }
  }

  if (!canGenerate) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
        <div className="flex-1 text-sm">
          <span className="font-medium text-fg">
            {access.isResolving
              ? "Checking your access…"
              : "Running the weekly report is limited to report managers"}
          </span>
          {!access.isResolving && (
            <span className="text-fg-muted">
              {" "}
              — you can still download everything above. Ask an admin to add you at Admin
              → Open Orders Roles.
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeading
          icon={<CalendarClock className="h-4 w-4" />}
          title="Run this week's reports"
          note="Once a week. Uploading again for the same week replaces that week's files."
        />
        <div className="flex shrink-0 items-center gap-2">
          <Link
            to="/sales/open-orders/customers"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface hover:text-fg"
          >
            <Users className="h-3.5 w-3.5" />
            Customer list ({activeAccounts.length})
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-fg-muted">
            Run date
          </label>
          <DateField
            value={toDateInputValue(runDate)}
            onChange={(v) => setRunDate(fromDateInputValue(v))}
            aria-label="Run date"
          />
          <span className="text-xs text-fg-muted">
            Aging is measured against this date. Files land in{" "}
            <span className="font-mono text-[11px]">
              {runDate ? weekFolderFor(runDate) : "—"}
            </span>
            .
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-fg-muted">
            Raw SAP extract
          </label>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => void onPick(e.target.files?.[0])}
            className="block w-full cursor-pointer rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg file:mr-3 file:rounded file:border-0 file:bg-surface-2 file:px-3 file:py-1 file:text-sm file:font-medium file:text-fg hover:file:bg-surface"
          />
        </div>
      </div>

      {parsing && <p className="text-sm text-fg-muted">Reading the extract…</p>}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-cooper-red/30 bg-cooper-red/5 px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-cooper-red" />
          <span className="text-fg">{error}</span>
        </div>
      )}

      {extract && preview && (
        <>
          <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-surface-2 p-3 sm:grid-cols-4">
            <Stat label="Lines" value={preview.metrics.lines.toLocaleString()} />
            <Stat label="Customers in file" value={String(preview.customersInExtract)} />
            <Stat
              label="Workbooks to build"
              value={String(preview.willProduce + 1)}
              hint="master + one per customer on the list"
            />
            <Stat
              label="Past due"
              value={formatByCurrency(preview.metrics.byCurrency, "pastDueValue")}
              tone="danger"
            />
          </div>

          <p className="text-xs text-fg-muted">
            Read <span className="font-medium text-fg">{extract.sheetName}</span> from{" "}
            {extract.filename}, header on row {extract.headerRow}.
          </p>

          {extract.warnings.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {extract.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ajax-yellow" />
                  <span className="text-fg-muted">{w.message}</span>
                </li>
              ))}
            </ul>
          )}

          {preview.missing.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 px-3 py-2.5 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ajax-yellow" />
              <span className="text-fg-muted">
                <span className="font-medium text-fg">
                  {preview.missing.length} customer
                  {preview.missing.length === 1 ? "" : "s"} on the list had nothing open
                </span>{" "}
                — {preview.missing.map((a) => a.customerName || a.accountNumber).join(", ")}. No
                workbook is produced for them; the master's Coverage tab says so.
              </span>
            </div>
          )}

          {confirming ? (
            <div className="flex flex-col gap-3 rounded-md border border-cooper-red/30 bg-cooper-red/5 p-3">
              <p className="text-sm text-fg">
                This writes{" "}
                <span className="font-semibold">{preview.willProduce + 1} files</span> to
                SharePoint and <span className="font-semibold">replaces</span> anything already
                in{" "}
                <span className="font-mono text-xs">
                  {runDate ? weekFolderFor(runDate) : ""}
                </span>
                . Everyone who opens this folder sees the new set.
              </p>
              <label className="flex items-center gap-2 text-sm text-fg-muted">
                <input
                  type="checkbox"
                  checked={keepRaw}
                  onChange={(e) => setKeepRaw(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Keep a copy of the raw extract in RAW UPLOADS
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={generate.isPending || !runDate}
                  onClick={() => {
                    if (!runDate) return;
                    generate.mutate(
                      { extract, accounts, runDate, keepRaw },
                      {
                        // Close the tool and clear the picked file once it has
                        // run (Ray, 2026-08-24). Leaving the form open on a
                        // finished extract invites a second identical run, and
                        // the lists below — which the mutation has just
                        // invalidated — are what you actually want to look at.
                        onSuccess: () => {
                          setExtract(null);
                          setConfirming(false);
                          onFinished();
                        },
                      },
                    );
                  }}
                  className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-60"
                >
                  <Upload className="h-4 w-4" />
                  {generate.isPending
                    ? generate.progress
                      ? `${generate.progress.step}…`
                      : "Working…"
                    : "Yes — build and upload"}
                </button>
                <button
                  type="button"
                  disabled={generate.isPending}
                  onClick={() => setConfirming(false)}
                  className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
              {generate.progress && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{
                      width: `${Math.round(
                        (generate.progress.done / Math.max(1, generate.progress.total)) * 100,
                      )}%`,
                    }}
                  />
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              disabled={!runDate || activeAccounts.length === 0}
              onClick={() => setConfirming(true)}
              className="inline-flex w-fit items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-60"
              title={
                activeAccounts.length === 0
                  ? "Add customers to the report list first"
                  : undefined
              }
            >
              <Upload className="h-4 w-4" />
              Build {preview.willProduce + 1} workbooks
            </button>
          )}

          {activeAccounts.length === 0 && (
            <p className="text-xs text-fg-muted">
              {customersConfigured ? (
                <>
                  The customer list is empty, so only a master dashboard could be
                  produced.{" "}
                  <Link
                    to="/sales/open-orders/customers"
                    className="text-accent hover:underline"
                  >
                    Add the customers who get a weekly workbook
                  </Link>
                  .
                </>
              ) : (
                <>
                  The customer list hasn't been created in SharePoint yet, so only a
                  master dashboard could be produced — no per-customer workbooks.{" "}
                  <Link
                    to="/sales/open-orders/customers"
                    className="text-accent hover:underline"
                  >
                    See the setup steps
                  </Link>
                  .
                </>
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// Small shared bits
// -----------------------------------------------------------------------------

function SectionHeading({
  icon,
  title,
  note,
}: {
  icon: React.ReactNode;
  title: string;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-fg">
        <span className="text-accent">{icon}</span>
        {title}
      </h2>
      {note && <p className="text-xs text-fg-muted">{note}</p>}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "danger";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      <span
        className={cn(
          "font-display text-lg font-bold tabular-nums",
          tone === "danger" ? "text-cooper-red" : "text-fg",
        )}
      >
        {value}
      </span>
      {hint && <span className="text-[10px] text-fg-muted">{hint}</span>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border bg-surface/60 px-4 py-6 text-center text-sm text-fg-muted">
      {children}
    </p>
  );
}

function DownloadButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface hover:text-fg disabled:opacity-60"
    >
      <Download className="h-3.5 w-3.5" />
      Download
    </button>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

