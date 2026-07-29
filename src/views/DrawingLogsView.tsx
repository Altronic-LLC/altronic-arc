import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileStack, History, Lock, Plus } from "lucide-react";
import { DRAWING_LOGS, availableDrawingLogs } from "@/api/drawingLogs";
import { tableFields, type LogField } from "@/lib/drawingLogFields";
import { useDrawingLog } from "@/hooks/useDrawingLogs";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SearchInput } from "@/components/SearchInput";
import { DrawingLogDetailModal } from "@/components/DrawingLogDetailModal";
import { DrawingLogCreateModal } from "@/components/DrawingLogCreateModal";
import { drawingLogLabel, drawingLogMatches } from "@/lib/drawingLogMapper";
import { formatSpDate } from "@/lib/spDates";
import { DRAWING_LOG_KINDS, type DrawingLogEntry, type DrawingLogKind } from "@/types/task";
import { cn } from "@/lib/cn";

// =============================================================================
// Drawing File Logs — Engineering's four drawing registers behind one screen.
//
// Tabs rather than one merged table, because the registers genuinely differ:
// CAD has a drawing number AND a separate CAD number, CCC/CEC have part numbers
// and descriptions, Sketches has a sketch number and no change log. Merged, every
// row would sit under columns that don't apply to it.
//
// The columns themselves come from the per-register field descriptors
// (src/lib/drawingLogFields.ts), so this view has no per-register branching at
// all — a fifth register would be a descriptor, not an edit here.
//
// Rows open a detail panel: that's where the change log lives, since 48 CH_*
// columns can't sensibly go in a table.
// =============================================================================

/** How many rows to put in the DOM before "Show all" — CAD and Sketches are 1,000+. */
const INITIAL_ROWS = 200;

function kindFromParam(raw: string | null): DrawingLogKind {
  const available = availableDrawingLogs();
  if (raw && (DRAWING_LOG_KINDS as readonly string[]).includes(raw)) {
    const kind = raw as DrawingLogKind;
    if (available.some((spec) => spec.kind === kind)) return kind;
  }
  return available[0]?.kind ?? "ccc";
}

/** One cell's text, formatted for its declared type. */
function cellText(entry: DrawingLogEntry, field: LogField): string {
  const value = entry.values[field.key];
  if (field.type === "date") return formatSpDate(value instanceof Date ? value : null);
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function DrawingLogsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, isResolving: adminResolving } = useAdminAccess();

  const logs = availableDrawingLogs();
  const kind = kindFromParam(searchParams.get("log"));
  const spec = DRAWING_LOGS[kind];
  const columns = tableFields(kind);

  const { data: entries = [], isLoading, error } = useDrawingLog(kind);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const setParam = (key: string, value: string) => {
    const sp = new URLSearchParams(searchParams);
    if (value) sp.set(key, value);
    else sp.delete(key);
    setSearchParams(sp, { replace: true });
  };
  const query = searchParams.get("q") ?? "";

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter((e) => drawingLogMatches(e, tokens));
  }, [entries, query]);

  const capped = !showAll && filtered.length > INITIAL_ROWS;
  const visible = capped ? filtered.slice(0, INITIAL_ROWS) : filtered;

  // Look the selection up by id each render, so recording a change updates the
  // open panel instead of leaving it showing a stale copy.
  const selected = selectedId === null ? null : entries.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <FileStack className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            Drawing File Logs
          </h1>
          <p className="text-xs text-fg-muted">{spec.blurb}</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New drawing</span>
            <span className="sm:hidden">New</span>
          </button>
        )}
      </header>

      {/* One tab per configured register. A log with no list id doesn't appear. */}
      <div className="flex flex-wrap gap-2" role="tablist">
        {logs.map((log) => (
          <button
            key={log.kind}
            role="tab"
            aria-selected={log.kind === kind}
            onClick={() => {
              setParam("log", log.kind);
              // Different register, different dataset — reset the row cap.
              setShowAll(false);
              setSelectedId(null);
            }}
            className={cn(
              "rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-all",
              log.kind === kind
                ? "border-accent bg-accent text-white shadow-sm"
                : "border-border bg-surface text-fg-muted hover:border-fg-muted hover:text-fg",
            )}
          >
            {log.label}
          </button>
        ))}
      </div>

      <div className="max-w-xl">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Search
          </span>
          <SearchInput
            value={query}
            onChange={(q) => setParam("q", q)}
            placeholder={spec.searchPlaceholder}
            className="select"
          />
        </label>
      </div>

      {error != null && (
        <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs">
          <div className="mb-1 font-semibold text-cooper-red">
            Couldn't load {spec.label} from SharePoint
          </div>
          <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11px] text-fg">
            {(error as Error)?.message ?? "Unknown error"}
          </pre>
        </div>
      )}

      {isLoading ? (
        <LoadingTasks noun={spec.label} />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
          {entries.length === 0
            ? `Nothing in ${spec.label} yet.`
            : "No drawings match that search."}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-fg-muted">
            <span>
              {capped ? (
                <>
                  Showing the first {INITIAL_ROWS.toLocaleString()} of{" "}
                  {filtered.length.toLocaleString()} matching drawings
                </>
              ) : (
                <>
                  Showing {filtered.length.toLocaleString()} of {entries.length.toLocaleString()} in{" "}
                  {spec.label}
                </>
              )}
            </span>
            {capped && (
              <button
                onClick={() => setShowAll(true)}
                className="font-semibold text-accent underline-offset-2 hover:underline"
              >
                Show all {filtered.length.toLocaleString()}
              </button>
            )}
          </div>

          <div className="scroll-elegant overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left">
                  {columns.map((f) => (
                    <Th key={f.key} className={f.numeric ? "text-right" : undefined}>
                      {f.label}
                    </Th>
                  ))}
                  {spec.hasChangeLog && <Th className="text-center">Changes</Th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr
                    key={e.id}
                    // The whole row opens the detail — that's the described
                    // interaction, and the change log has nowhere else to live.
                    onClick={() => setSelectedId(e.id)}
                    tabIndex={0}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        setSelectedId(e.id);
                      }
                    }}
                    aria-label={`Open ${drawingLogLabel(e)}`}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2/60 focus:bg-surface-2 focus:outline-none"
                  >
                    {columns.map((f, i) => (
                      <Td
                        key={f.key}
                        className={cn(
                          i === 0 && "font-medium text-fg",
                          f.numeric && "text-right tabular-nums",
                          f.type === "date" && "whitespace-nowrap tabular-nums text-fg-muted",
                          f.wide ? "max-w-[24rem]" : "whitespace-nowrap",
                        )}
                      >
                        {f.wide ? (
                          <span className="block truncate" title={cellText(e, f)}>
                            {cellText(e, f)}
                          </span>
                        ) : (
                          cellText(e, f)
                        )}
                      </Td>
                    ))}
                    {spec.hasChangeLog && (
                      <Td className="text-center">
                        {e.changes.length > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                            <History className="h-3 w-3" />
                            {e.changes.length}
                          </span>
                        ) : (
                          <span className="text-fg-muted">—</span>
                        )}
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-fg-muted">
            Click a row for the full record
            {spec.hasChangeLog ? " and its change log." : "."}
          </p>

          {!isAdmin && !adminResolving && (
            <p className="flex items-start gap-1.5 text-[11px] text-fg-muted">
              <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                Drawing records are controlled documents, so adding, editing and recording changes
                is limited to admins. Reading and searching are open to everyone.
              </span>
            </p>
          )}
        </>
      )}

      {selected && (
        <DrawingLogDetailModal
          entry={selected}
          isAdmin={isAdmin}
          onClose={() => setSelectedId(null)}
        />
      )}
      {creating && <DrawingLogCreateModal kind={kind} onClose={() => setCreating(false)} />}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 align-top text-fg", className)}>{children}</td>;
}
