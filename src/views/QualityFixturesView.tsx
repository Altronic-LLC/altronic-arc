import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Lock, Paperclip, Plus, Wrench } from "lucide-react";
import { useQualityFixtures } from "@/hooks/useQualityFixtures";
import { useMyQualityFixtureAccess } from "@/hooks/useQualityFixtureRoles";
import { useSortableTable } from "@/hooks/useSortableTable";
import { useIsPhone } from "@/hooks/useIsPhone";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { SearchInput } from "@/components/SearchInput";
import { SortableHeader } from "@/components/SortableTableHeader";
import { PhoneSortBar } from "@/components/PhoneSortBar";
import { QualityFixtureFormModal } from "@/components/QualityFixtureFormModal";
import { FixtureStatusChip, QualityFixtureNav } from "@/components/qualityFixtureAtoms";
import { editFixturesGate } from "@/lib/qualityFixtureRoles";
import {
  inFixtureScope,
  parseFixtureScope,
  qualityFixtureMatches,
  type FixtureScope,
} from "@/lib/qualityFixtures";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { tokenizeQuery } from "@/lib/itemSearch";
import type { SortColumn } from "@/lib/tableSort";
import type { QualityFixture } from "@/types/qualityFixture";
import { cn } from "@/lib/cn";

// =============================================================================
// Quality Fixture Log — the Quality Control custom equipment log
// ("calibration not required"). Everyone signed in reads and searches it;
// Fixture Log editors add, edit and retire fixtures. A fixture opens on its
// own page, where its attachments are.
//
// Opens on ACTIVE fixtures; retired ones are a pill away (?show=retired|all).
// =============================================================================

const INITIAL_ROWS = 150;

const COLUMNS: SortColumn<QualityFixture>[] = [
  { key: "number", label: "Fixture #", value: (f) => f.number, noFilter: true },
  { key: "description", label: "Description", value: (f) => f.description, noFilter: true },
  { key: "location", label: "Location", value: (f) => f.location },
  { key: "partNumbers", label: "Products / part numbers", value: (f) => f.partNumbers, noFilter: true },
  { key: "comment", label: "Comment", value: (f) => f.comment, noFilter: true },
  { key: "status", label: "Status", value: (f) => (f.active ? "Active" : "Retired") },
];

const SCOPES: { value: FixtureScope; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "retired", label: "Retired" },
  { value: "all", label: "All" },
];

export function QualityFixturesView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: fixtures = [], isLoading, error, refetch } = useQualityFixtures();
  const gate = editFixturesGate(useMyQualityFixtureAccess());
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const isPhone = useIsPhone();

  const query = searchParams.get("q") ?? "";
  const scope = parseFixtureScope(searchParams.get("show"));

  function setParam(key: string, value: string | null) {
    const sp = new URLSearchParams(searchParams);
    if (value) sp.set(key, value);
    else sp.delete(key);
    setSearchParams(sp, { replace: true });
  }

  const searched = useMemo(() => {
    const tokens = tokenizeQuery(query);
    return fixtures.filter((f) => qualityFixtureMatches(f, tokens));
  }, [fixtures, query]);
  const counts = useMemo(
    () => ({
      active: searched.filter((f) => f.active).length,
      retired: searched.filter((f) => !f.active).length,
      all: searched.length,
    }),
    [searched],
  );
  const scoped = useMemo(() => searched.filter((f) => inFixtureScope(f, scope)), [searched, scope]);

  const table = useSortableTable<QualityFixture>({
    rows: scoped,
    columns: COLUMNS,
    stableKey: (f) => f.id,
    initialKey: "number",
  });

  useEffect(() => setShowAll(false), [query, scope]);
  const shown = showAll ? table.rows : table.rows.slice(0, INITIAL_ROWS);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <Wrench className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Quality Fixture Log</h1>
            <p className="text-xs text-fg-muted">
              Quality Control's custom equipment — the QF fixtures, testers and gauges that need no calibration.
            </p>
          </div>
        </div>
        {gate.allowed && (
          <div className="flex shrink-0">
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-all hover:bg-accent/90"
            >
              <Plus className="h-4 w-4" />
              Add fixture
            </button>
          </div>
        )}
      </header>

      <QualityFixtureNav />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex max-w-xl flex-1 flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Search</span>
          <SearchInput
            value={query}
            onChange={(q) => setParam("q", q || null)}
            placeholder="Fixture #, description, location, part number…"
            className="select"
          />
        </label>
        <div role="group" aria-label="Show" className="flex gap-1">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={scope === s.value}
              onClick={() => setParam("show", s.value === "active" ? null : s.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                scope === s.value
                  ? "border-accent bg-accent/10 text-fg"
                  : "border-border text-fg-muted hover:text-fg",
              )}
            >
              {s.label} <span className="tabular-nums text-fg-muted">{counts[s.value]}</span>
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <LoadingTasks noun="fixtures" />
      ) : error && isPermissionDenied(error) ? (
        <ListAccessNotice list="Quality Fixture Log" site="Altronic_PMO" onRetry={() => void refetch()} />
      ) : error ? (
        <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't load the Quality Fixture Log: {(error as Error).message}{" "}
          <button type="button" onClick={() => void refetch()} className="font-semibold underline">
            Try again
          </button>
        </div>
      ) : fixtures.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
          No fixtures on the log yet.
        </div>
      ) : table.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
          No fixtures match.
          {table.hasFilters && (
            <button type="button" onClick={table.clearFilters} className="ml-1 text-accent hover:underline">
              Clear column filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="text-xs text-fg-muted">
            Showing {shown.length} of {table.rows.length} {table.rows.length === 1 ? "fixture" : "fixtures"}
          </div>
          {isPhone ? (
            <div className="flex flex-col gap-2">
              <PhoneSortBar columns={COLUMNS} table={table} />
              {shown.map((f) => (
                <Link
                  key={f.id}
                  to={`/quality/fixtures/${f.id}`}
                  className="rounded-lg border border-border bg-surface p-3 hover:bg-surface-2/60"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-fg">{f.number}</span>
                    {!f.active && <FixtureStatusChip active={false} />}
                    {f.hasAttachments && <Paperclip className="ml-auto h-3.5 w-3.5 text-fg-muted" aria-label="Has attachments" />}
                  </div>
                  <div className="mt-0.5 text-sm text-fg">{f.description || "—"}</div>
                  {f.location && <div className="mt-1 text-xs text-fg-muted">{f.location}</div>}
                </Link>
              ))}
            </div>
          ) : (
            <div className="scroll-elegant overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-left">
                    {COLUMNS.map((c) => (
                      <SortableHeader key={c.key} label={c.label} {...table.headerProps(c.key)} />
                    ))}
                    <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                      Files
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((f) => (
                    <tr
                      key={f.id}
                      onClick={() => navigate(`/quality/fixtures/${f.id}`)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2/60"
                    >
                      <td className="whitespace-nowrap px-3 py-2 align-top font-medium">
                        <Link
                          to={`/quality/fixtures/${f.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-fg hover:text-accent hover:underline"
                        >
                          {f.number}
                        </Link>
                      </td>
                      <td className="px-3 py-2 align-top text-fg">{f.description || "—"}</td>
                      <td className="px-3 py-2 align-top text-fg-muted">{f.location || "—"}</td>
                      <td className="max-w-[16rem] px-3 py-2 align-top text-fg-muted">
                        <FirstLine text={f.partNumbers} />
                      </td>
                      <td className="max-w-[16rem] truncate px-3 py-2 align-top text-fg-muted" title={f.comment}>
                        {f.comment || "—"}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <FixtureStatusChip active={f.active} />
                      </td>
                      <td className="px-3 py-2 text-center align-top text-fg-muted">
                        {f.hasAttachments ? <Paperclip className="mx-auto h-3.5 w-3.5" aria-label="Has attachments" /> : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!showAll && table.rows.length > INITIAL_ROWS && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="self-start text-sm font-medium text-accent hover:underline"
            >
              Show all {table.rows.length}
            </button>
          )}
          {!gate.allowed && !gate.resolving && (
            <p className="flex items-start gap-1.5 text-[11px] text-fg-muted">
              <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>{gate.hint}</span>
            </p>
          )}
        </>
      )}

      {adding && (
        <QualityFixtureFormModal
          fixtures={fixtures}
          onClose={() => setAdding(false)}
          onCreated={(created) => navigate(`/quality/fixtures/${created.id}`)}
        />
      )}
    </div>
  );
}

/** A multi-line field in a cell: the first line, "+N more" for the rest. */
function FirstLine({ text }: { text: string }) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return <span>—</span>;
  return (
    <span className="block" title={text}>
      <span className="block truncate">{lines[0]}</span>
      {lines.length > 1 && <span className="text-[11px]">+{lines.length - 1} more</span>}
    </span>
  );
}
