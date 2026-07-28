import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ChevronDown,
  CircuitBoard,
  Lock,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  Users,
} from "lucide-react";
import {
  useDeleteTeradyneLogEntry,
  useTeradyneEmployees,
  useTeradyneLog,
  useTeradyneProducts,
  useTeradyneRemarks,
} from "@/hooks/useTeradyne";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { LoadingTasks } from "@/components/LoadingTasks";
import { MultiSelect } from "@/components/SearchableSelect";
import { SearchInput } from "@/components/SearchInput";
import { TeradyneLogFormModal } from "@/components/TeradyneLogFormModal";
import { formatTeradyneDate } from "@/lib/teradyneMapper";
import type { TeradyneLogEntry } from "@/types/task";
import { cn } from "@/lib/cn";

// =============================================================================
// Teradyne Log — the Operations PCB test log. A log-style table (this list is
// read and appended far more often than it's discussed, so there's no detail
// page and no comments), plus a "Manage lists" menu for the three reference
// lists it looks up against.
//
// Every filter axis lives in the URL (q, product, remark, employee) so a
// filtered view is shareable, matching EirsView / PanelOrdersView.
// =============================================================================

/**
 * How many rows to put in the DOM before requiring a "Show all" click.
 *
 * The log is a real archive — ~1,470 rows as of 2026-07-28 and growing — and at
 * ten cells a row, rendering all of it is ~15k DOM nodes, which is enough to
 * make typing in the search box stutter on a shop-floor PC. Entries are sorted
 * newest-first and the filters run over the WHOLE log before this cap applies,
 * so the rows you're looking for are either in the first screenful or one
 * filter away; "Show all" is there for the rare times you genuinely want the
 * lot (printing, scrolling a year back).
 */
const INITIAL_ROWS = 200;

export function TeradyneLogView() {
  const { data: log = [], isLoading, error } = useTeradyneLog();
  const { data: products = [] } = useTeradyneProducts();
  const { data: employees = [] } = useTeradyneEmployees();
  const { data: remarks = [] } = useTeradyneRemarks();
  const deleteEntry = useDeleteTeradyneLogEntry();
  // Anyone signed in can ADD to the log — operators are the ones logging
  // failures. Changing or removing an existing entry is admin-only: this is a
  // record of what happened, so corrections go through someone accountable.
  // UI-level gating, as everywhere in ARC; SharePoint list permissions are the
  // real boundary.
  const { isAdmin, isResolving: adminResolving } = useAdminAccess();

  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<TeradyneLogEntry | null>(null);
  const [showAll, setShowAll] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const setParam = (key: string, value: string) => {
    const sp = new URLSearchParams(searchParams);
    if (value) sp.set(key, value);
    else sp.delete(key);
    setSearchParams(sp, { replace: true });
  };
  const query = searchParams.get("q") ?? "";
  const productIds = parseIntList(searchParams.get("product"));
  const remarkIds = parseIntList(searchParams.get("remark"));
  const employeeIds = parseIntList(searchParams.get("employee"));

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return log.filter((e) => {
      if (productIds.length && (!e.product || !productIds.includes(e.product.lookupId)))
        return false;
      if (remarkIds.length && (!e.remark || !remarkIds.includes(e.remark.lookupId))) return false;
      if (employeeIds.length) {
        const onEntry = [e.employee1?.lookupId, e.employee2?.lookupId].filter(
          (x): x is number => x != null,
        );
        if (!onEntry.some((id) => employeeIds.includes(id))) return false;
      }
      if (tokens.length) {
        const haystack = [
          e.title,
          e.defectiveParts,
          e.product?.title,
          e.remark?.title,
          e.employee1?.title,
          e.employee2?.title,
          e.sapNumber,
          e.altronicPartNumber,
          e.operatorNotes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        // Every token must appear — adding words narrows, like the other views.
        if (!tokens.every((t) => haystack.includes(t))) return false;
      }
      return true;
    });
  }, [log, query, productIds, remarkIds, employeeIds]);

  // Totals cover every MATCHING entry, not just the rows rendered below —
  // a capped table would otherwise under-report the boards for a filter.
  const totals = useMemo(() => {
    let boards = 0;
    let tested = 0;
    for (const e of filtered) {
      boards += e.numberOfBoards ?? 0;
      tested += e.boardsTested ?? 0;
    }
    return { boards, tested };
  }, [filtered]);

  const capped = !showAll && filtered.length > INITIAL_ROWS;
  const visible = useMemo(
    () => (capped ? filtered.slice(0, INITIAL_ROWS) : filtered),
    [filtered, capped],
  );

  async function handleDelete(entry: TeradyneLogEntry) {
    // The button isn't rendered for non-admins; this is the belt to that
    // braces, so no future call path can delete without the check.
    if (!isAdmin) return;
    const ok = window.confirm(
      `Delete this log entry?\n\n${entry.title}\n${formatTeradyneDate(entry.enterDate)}\n\nThis removes it from SharePoint and can't be undone.`,
    );
    if (!ok) return;
    await deleteEntry.mutateAsync(entry.id);
  }

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <CircuitBoard className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Teradyne Log</h1>
          <p className="text-xs text-fg-muted">
            Board test failures logged off the Teradyne / Spea stations — what failed, on which
            product, and who ran it.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ManageListsMenu />
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New entry</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Product">
          <MultiSelect
            allLabel="All products"
            searchPlaceholder="Search products…"
            options={products.map((p) => ({ value: String(p.lookupId), label: p.title }))}
            selected={productIds.map(String)}
            onChange={(next) => setParam("product", next.join(","))}
          />
        </Field>
        <Field label="Remark">
          <MultiSelect
            allLabel="All remarks"
            searchPlaceholder="Search remarks…"
            options={remarks.map((r) => ({ value: String(r.lookupId), label: r.title }))}
            selected={remarkIds.map(String)}
            onChange={(next) => setParam("remark", next.join(","))}
          />
        </Field>
        <Field label="Employee">
          <MultiSelect
            allLabel="Anyone"
            searchPlaceholder="Search employees…"
            options={employees.map((e) => ({ value: String(e.lookupId), label: e.title }))}
            selected={employeeIds.map(String)}
            onChange={(next) => setParam("employee", next.join(","))}
          />
        </Field>
        <Field label="Search">
          <SearchInput
            value={query}
            onChange={(q) => setParam("q", q)}
            placeholder="Search anything — add words to narrow"
            className="select"
          />
        </Field>
      </div>

      {error != null && (
        <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs">
          <div className="mb-1 font-semibold text-cooper-red">
            Couldn't load the Teradyne Log from SharePoint
          </div>
          <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11px] text-fg">
            {(error as Error)?.message ?? "Unknown error"}
          </pre>
        </div>
      )}

      {isLoading ? (
        <LoadingTasks noun="the Teradyne log" />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
          {log.length === 0
            ? "Nothing logged yet. Click 'New entry' to add the first one."
            : "No entries match the current filters."}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-fg-muted">
            <span>
              {capped ? (
                <>
                  Showing the newest {INITIAL_ROWS.toLocaleString()} of{" "}
                  {filtered.length.toLocaleString()} matching entries
                </>
              ) : (
                <>
                  Showing {filtered.length.toLocaleString()} of {log.length.toLocaleString()}{" "}
                  entries
                </>
              )}
            </span>
            <span>
              {totals.boards.toLocaleString()} defective{" "}
              {totals.boards === 1 ? "board" : "boards"} · {totals.tested.toLocaleString()} tested
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

          {/* Wide table scrolls inside its own container so the page never
              scrolls sideways on a phone. */}
          <div className="scroll-elegant overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1120px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left">
                  <Th>Date</Th>
                  <Th>Product</Th>
                  <Th>Defective Parts</Th>
                  <Th>Remark</Th>
                  <Th className="text-right">Boards</Th>
                  <Th className="text-right">Tested</Th>
                  <Th className="text-right">Fails/Bd</Th>
                  <Th>SAP No.</Th>
                  <Th>Altronic Part No.</Th>
                  <Th>Employees</Th>
                  {/* No Actions column at all for non-admins — a column of
                      permanently disabled buttons is just noise. The note under
                      the table explains the absence once. */}
                  {isAdmin && <Th className="text-right">Actions</Th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr
                    key={e.id}
                    className="group border-b border-border last:border-0 hover:bg-surface-2/60"
                  >
                    <Td className="whitespace-nowrap tabular-nums text-fg-muted">
                      {formatTeradyneDate(e.enterDate)}
                    </Td>
                    <Td className="font-medium text-fg">{e.product?.title ?? "—"}</Td>
                    <Td className="max-w-[18rem]">
                      <span className="block">{e.defectiveParts || "—"}</span>
                      {/* Operator notes inline, not behind the pencil: now that
                          editing is admin-only, the form is no longer a way for
                          everyone to read them. Truncated, full text on hover. */}
                      {e.operatorNotes && (
                        <span
                          className="mt-0.5 block truncate text-[11px] text-fg-muted"
                          title={e.operatorNotes}
                        >
                          {e.operatorNotes}
                        </span>
                      )}
                    </Td>
                    <Td className="text-fg-muted">{e.remark?.title ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{e.numberOfBoards ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{e.boardsTested ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{e.failuresPerBoard ?? "—"}</Td>
                    {/* Two columns, not one: these are different numbers, so
                        falling back from one to the other would show an
                        Altronic part number under the SAP heading. */}
                    <Td className="whitespace-nowrap font-mono text-[11px] text-fg-muted">
                      {e.sapNumber || "—"}
                    </Td>
                    <Td className="whitespace-nowrap font-mono text-[11px] text-fg-muted">
                      {e.altronicPartNumber || "—"}
                    </Td>
                    <Td className="text-fg-muted">
                      <EmployeeCell entry={e} />
                    </Td>
                    {isAdmin && (
                      <Td className="whitespace-nowrap text-right">
                        <button
                          onClick={() => setEditing(e)}
                          className="rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100"
                          aria-label={`Edit ${e.title}`}
                          title="Edit entry"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(e)}
                          className="rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-cooper-red focus:opacity-100 group-hover:opacity-100"
                          aria-label={`Delete ${e.title}`}
                          title="Delete entry"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {capped && (
            <div className="flex justify-center">
              <button
                onClick={() => setShowAll(true)}
                className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
              >
                Show all {filtered.length.toLocaleString()} entries
              </button>
            </div>
          )}

          {!isAdmin && !adminResolving && (
            <p className="flex items-start gap-1.5 text-[11px] text-fg-muted">
              <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                Anyone can add an entry, but changing or deleting one is limited to admins — the
                log is a record of what happened. Ask an admin if something needs correcting.
              </span>
            </p>
          )}
        </>
      )}

      {showNew && <TeradyneLogFormModal onClose={() => setShowNew(false)} />}
      {editing && (
        <TeradyneLogFormModal entry={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** The two employee slots, with clock numbers when they differ from the record. */
function EmployeeCell({ entry }: { entry: TeradyneLogEntry }) {
  const parts = [
    entry.employee1 ? { name: entry.employee1.title, clock: entry.employee1Clock } : null,
    entry.employee2 ? { name: entry.employee2.title, clock: entry.employee2Clock } : null,
  ].filter((x): x is { name: string; clock: number | null } => x != null);

  if (parts.length === 0) return <span>—</span>;
  return (
    <span className="flex flex-col gap-0.5">
      {parts.map((p) => (
        <span key={p.name} className="whitespace-nowrap">
          {p.name}
          {p.clock != null && (
            <span className="ml-1 font-mono text-[10px] text-fg-muted">#{p.clock}</span>
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * "Manage lists" dropdown — the way in to editing the three reference lists.
 * Deliberately here rather than under Admin: any signed-in user maintains
 * these, because the people who run the tester are the ones who know when a
 * new product or remark is needed.
 */
function ManageListsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = [
    { to: "/operations/teradyne/employees", label: "Employees", icon: <Users className="h-4 w-4" /> },
    {
      to: "/operations/teradyne/products",
      label: "Products",
      icon: <CircuitBoard className="h-4 w-4" />,
    },
    {
      to: "/operations/teradyne/remarks",
      label: "Remarks",
      icon: <Settings2 className="h-4 w-4" />,
    },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium transition-colors",
          open ? "border-accent text-fg" : "text-fg-muted hover:text-fg",
        )}
      >
        <Settings2 className="h-4 w-4" />
        <span className="hidden sm:inline">Manage lists</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-xl"
        >
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Reference lists
          </div>
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-fg transition-colors hover:bg-surface-2"
            >
              <span className="text-fg-muted">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
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

function parseIntList(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map((s) => parseInt(s, 10));
}
