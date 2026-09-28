import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronDown, Cpu, Globe, SlidersHorizontal, X } from "lucide-react";
import { useAltronicComponents, useAltronicParts } from "@/hooks/useAltronicParts";
import { PartKindChip, PartsDataGate, SignOffChip, type PartsQueryState } from "@/components/partsAtoms";
import { SearchInput } from "@/components/SearchInput";
import { NewPartButton } from "@/components/PartFormModal";
import { SortableHeader } from "@/components/SortableTableHeader";
import { useSortableTable } from "@/hooks/useSortableTable";
import { dayLabel, type SortColumn } from "@/lib/tableSort";
import { tokenizeQuery } from "@/lib/itemSearch";
import {
  applyFieldQueries,
  applyRangeQueries,
  partPath,
  toGlobalRows,
  unreadableCount,
  type GlobalPartRow,
  type RangeQuery,
  type SearchField,
} from "@/lib/partSearch";
import { formatEngineeringValue, parseBound } from "@/lib/engineeringValue";
import { COMPONENT_PREFIX_CATEGORY, isComponentPrefix, partPrefix } from "@/lib/altronicPartMapper";
import type { AltronicComponent, AltronicPart } from "@/types/task";
import { cn } from "@/lib/cn";

// =============================================================================
// Altronic Parts List — one three-digit list (`/engineering/parts/list/601`),
// or Global Search across both lists (`/engineering/parts/search`).
//
// The old app's layout, kept: a search panel down the left with one box per
// field, the results beside it. The rules of that panel are the old app's too
// (substring, case-insensitive, `&` for several terms in one field — see
// lib/partSearch.ts), because people already know them. Added on top:
//
//  - a "Search everything" box, word-by-word across every field;
//  - the house column sorting and per-column filters;
//  - every search lives in the URL (`q`, `f.<field>`, and `from.<field>` /
//    `to.<field>` for a range), so a search is a link somebody can send.
//
// RANGE SEARCH is the old app's black "R" button, on the component ratings,
// tolerance and temperatures (component lists and Global Search, where the
// old app had it). It turns a field's box into From and To, reads both as
// engineering values (lib/engineeringValue.ts — 4K7 is 4,700, where the old
// app read 4M1 as 4), says how it read them, and says how many parts it can't
// search because the field holds no number ("SEE DATA SHEET").
//
// Only the rows put in the DOM are capped (INITIAL_ROWS). Searching, sorting
// and every count run over the whole list — Global Search is ~18,000 rows.
//
// A list screen carries the New part button for whoever may add there (see
// NewPartButton); editing and approving happen on the part's own page.
// =============================================================================

const INITIAL_ROWS = 150;

const PART_FIELD_PREFIX = "f.";
const RANGE_FROM_PREFIX = "from.";
const RANGE_TO_PREFIX = "to.";

export function PartsListView() {
  const { prefix } = useParams<{ prefix?: string }>();
  if (!prefix) return <GlobalSearchScreen />;
  if (isComponentPrefix(prefix)) return <ComponentListScreen prefix={prefix} />;
  return <PartListScreen prefix={prefix} />;
}

// -----------------------------------------------------------------------------
// Part List (every non-HOC list)
// -----------------------------------------------------------------------------

const PART_COLUMNS: SortColumn<AltronicPart>[] = [
  { key: "partNumber", label: "Part #", value: (p) => p.partNumber, noFilter: true },
  { key: "description", label: "Description", value: (p) => p.description, noFilter: true },
  {
    key: "dateAssigned",
    label: "Date Assigned",
    kind: "date",
    value: (p) => dayLabel(p.dateAssigned),
    sortValue: (p) => p.dateAssigned,
  },
  { key: "drawingSize", label: "Drawing Size", value: (p) => p.drawingSize },
  { key: "manufacturer", label: "Manufacturer", value: (p) => p.manufacturer },
  { key: "mfgPartNumber", label: "Mfg Part #", value: (p) => p.mfgPartNumber, noFilter: true },
  { key: "assignedBy", label: "Assigned By", value: (p) => p.assignedBy },
  { key: "prototypeOrProduction", label: "Proto / Prod", value: (p) => p.prototypeOrProduction ?? "" },
  { key: "purchased", label: "Purchased", value: (p) => p.purchased ?? "" },
  { key: "signOffStatus", label: "Sign-off", value: (p) => p.signOffStatus ?? "" },
];

/** The old app's Part List search panel, in its order, plus SAP #. */
const PART_SEARCH_FIELDS: SearchField<AltronicPart>[] = [
  { key: "partNumber", label: "Altronic Part #", value: (p) => p.partNumber },
  { key: "description", label: "Description", value: (p) => p.description },
  { key: "manufacturer", label: "Manufacturer", value: (p) => p.manufacturer },
  { key: "mfgPartNumber", label: "Mfg Part #", value: (p) => p.mfgPartNumber },
  { key: "notes", label: "Notes", value: (p) => p.notes },
  { key: "drawingSize", label: "Drawing Size", value: (p) => p.drawingSize },
  { key: "purchased", label: "Purchased", value: (p) => p.purchased ?? "" },
  { key: "dateAssigned", label: "Date Assigned", value: (p) => dayLabel(p.dateAssigned) },
  { key: "prototypeOrProduction", label: "Prototype or Production", value: (p) => p.prototypeOrProduction ?? "" },
  { key: "assignedBy", label: "Assigned By", value: (p) => p.assignedBy },
  { key: "sapNumber", label: "SAP #", value: (p) => p.sapNumber },
];

function PartListScreen({ prefix }: { prefix: string }) {
  const query = useAltronicParts();
  const rows = useMemo(
    () => (query.data ?? []).filter((p) => partPrefix(p.partNumber) === prefix),
    [query.data, prefix],
  );
  return (
    <PartsTable<AltronicPart>
      title={`${prefix} List`}
      subtitle="Altronic Part List"
      queries={[query]}
      listNames="Altronic Part List"
      rows={rows}
      columns={PART_COLUMNS}
      searchFields={PART_SEARCH_FIELDS}
      stableKey={partId}
      rowPath={(p) => partPath("part", p.id)}
      renderCell={(key, p) => {
        if (key === "dateAssigned") return dayLabel(p.dateAssigned) || "—";
        if (key === "signOffStatus") return <SignOffChip status={p.signOffStatus} />;
        return undefined;
      }}
      emptyText={`No parts in list ${prefix}.`}
      sourceEmpty={query.data?.length === 0}
      action={<NewPartButton prefix={prefix} />}
    />
  );
}

const partId = (p: AltronicPart) => p.id;

// -----------------------------------------------------------------------------
// Component List (601/611/701/711/712/722)
// -----------------------------------------------------------------------------

// Rating A/B/C mean different things per component type (see
// lib/componentRatings.ts), and one list mixes types, so the table keeps the
// generic names. The part's own page shows what each one means for it.
const COMPONENT_COLUMNS: SortColumn<AltronicComponent>[] = [
  { key: "partNumber", label: "Part #", value: (c) => c.partNumber, noFilter: true },
  { key: "description", label: "Description", value: (c) => c.description, noFilter: true },
  { key: "mfgName", label: "Mfg Name", value: (c) => c.mfgName },
  { key: "mfgNumber", label: "Mfg Number", value: (c) => c.mfgNumber, noFilter: true },
  { key: "ratingA", label: "Rating A", value: (c) => c.ratingA },
  { key: "ratingB", label: "Rating B", value: (c) => c.ratingB },
  { key: "ratingC", label: "Rating C", value: (c) => c.ratingC },
  { key: "tolerance", label: "Tolerance", value: (c) => c.tolerance },
  { key: "footprint", label: "Footprint", value: (c) => c.footprint },
  { key: "signOffStatus", label: "Sign-off", value: (c) => c.signOffStatus ?? "" },
];

const COMPONENT_SEARCH_FIELDS: SearchField<AltronicComponent>[] = [
  { key: "partNumber", label: "Altronic Part #", value: (c) => c.partNumber },
  { key: "description", label: "Description", value: (c) => c.description },
  { key: "mfgName", label: "Mfg Name", value: (c) => c.mfgName },
  { key: "mfgNumber", label: "Mfg Number", value: (c) => c.mfgNumber },
  { key: "ratingA", label: "Rating A", value: (c) => c.ratingA, range: true },
  { key: "ratingB", label: "Rating B", value: (c) => c.ratingB, range: true },
  { key: "ratingC", label: "Rating C", value: (c) => c.ratingC, range: true },
  { key: "tolerance", label: "Tolerance", value: (c) => c.tolerance, range: true },
  { key: "tempMin", label: "Temp Min", value: (c) => c.tempMin, range: true },
  { key: "tempMax", label: "Temp Max", value: (c) => c.tempMax, range: true },
  { key: "footprint", label: "Footprint", value: (c) => c.footprint },
  { key: "notes", label: "Notes", value: (c) => c.notes },
];

function ComponentListScreen({ prefix }: { prefix: string }) {
  const query = useAltronicComponents();
  const rows = useMemo(
    () => (query.data ?? []).filter((c) => partPrefix(c.partNumber) === prefix),
    [query.data, prefix],
  );
  return (
    <PartsTable<AltronicComponent>
      title={`${prefix} List`}
      subtitle={`Altronic Component List · ${COMPONENT_PREFIX_CATEGORY[prefix]}`}
      queries={[query]}
      listNames="Altronic Component List"
      rows={rows}
      columns={COMPONENT_COLUMNS}
      searchFields={COMPONENT_SEARCH_FIELDS}
      stableKey={componentId}
      rowPath={(c) => partPath("component", c.id)}
      renderCell={(key, c) => (key === "signOffStatus" ? <SignOffChip status={c.signOffStatus} /> : undefined)}
      emptyText={`No components in list ${prefix}.`}
      sourceEmpty={query.data?.length === 0}
      action={<NewPartButton prefix={prefix} />}
    />
  );
}

const componentId = (c: AltronicComponent) => c.id;

// -----------------------------------------------------------------------------
// Global Search — both lists at once
// -----------------------------------------------------------------------------

const GLOBAL_COLUMNS: SortColumn<GlobalPartRow>[] = [
  { key: "partNumber", label: "Part #", value: (r) => r.partNumber, noFilter: true },
  { key: "list", label: "List", value: (r) => r.list },
  { key: "description", label: "Description", value: (r) => r.description, noFilter: true },
  // Thousands of distinct manufacturers across 18,000 rows — the search panel
  // covers this, and a filter menu of them would be a scroll, not a filter.
  { key: "manufacturer", label: "Manufacturer", value: (r) => r.manufacturer, noFilter: true },
  { key: "mfgNumber", label: "Mfg #", value: (r) => r.mfgNumber, noFilter: true },
  { key: "kindLabel", label: "Type", value: (r) => r.kindLabel },
  { key: "signOffStatus", label: "Sign-off", value: (r) => r.signOffStatus ?? "" },
];

const GLOBAL_SEARCH_FIELDS: SearchField<GlobalPartRow>[] = [
  { key: "partNumber", label: "Altronic Part #", value: (r) => r.partNumber },
  { key: "description", label: "Description", value: (r) => r.description },
  { key: "manufacturer", label: "Manufacturer / Mfg Name", value: (r) => r.manufacturer },
  { key: "mfgNumber", label: "Mfg Part # / Mfg Number", value: (r) => r.mfgNumber },
  { key: "notes", label: "Notes", value: (r) => r.notes },
  // So an approver's "waiting on you" link can be a plain search:
  // ?f.signOffStatus=Pending finds both pending steps.
  { key: "signOffStatus", label: "Sign-off", value: (r) => r.signOffStatus ?? "" },
  // Components only — blank on every Part List part — and range-searchable,
  // as the old app's Global Search was.
  { key: "ratingA", label: "Rating A", value: (r) => r.ratingA, range: true },
  { key: "ratingB", label: "Rating B", value: (r) => r.ratingB, range: true },
  { key: "ratingC", label: "Rating C", value: (r) => r.ratingC, range: true },
  { key: "tolerance", label: "Tolerance", value: (r) => r.tolerance, range: true },
  { key: "tempMin", label: "Temp Min", value: (r) => r.tempMin, range: true },
  { key: "tempMax", label: "Temp Max", value: (r) => r.tempMax, range: true },
];

function GlobalSearchScreen() {
  const parts = useAltronicParts();
  const components = useAltronicComponents();
  const rows = useMemo(
    () => toGlobalRows(parts.data ?? [], components.data ?? []),
    [parts.data, components.data],
  );
  return (
    <PartsTable<GlobalPartRow>
      title="Global Search"
      subtitle="Every part on both lists — narrow it with the search panel"
      icon={<Globe className="h-5 w-5" />}
      queries={[parts, components]}
      listNames="Altronic Part List and Altronic Component List"
      rows={rows}
      columns={GLOBAL_COLUMNS}
      searchFields={GLOBAL_SEARCH_FIELDS}
      stableKey={globalKey}
      rowPath={(r) => partPath(r.kind, r.id)}
      renderCell={(key, r) => {
        if (key === "kindLabel") return <PartKindChip label={r.kindLabel} />;
        if (key === "signOffStatus") return <SignOffChip status={r.signOffStatus} />;
        if (key === "list" && r.list) {
          return (
            <Link to={`/engineering/parts/list/${r.list}`} className="font-mono text-accent hover:underline">
              {r.list}
            </Link>
          );
        }
        return undefined;
      }}
      emptyText="No parts on either list."
      sourceEmpty={rows.length === 0}
    />
  );
}

const globalKey = (r: GlobalPartRow) => r.key;

// -----------------------------------------------------------------------------
// The shared screen
// -----------------------------------------------------------------------------

interface PartsTableProps<T> {
  title: string;
  subtitle: string;
  icon?: ReactNode;
  queries: PartsQueryState[];
  listNames: string;
  rows: T[];
  columns: SortColumn<T>[];
  searchFields: SearchField<T>[];
  stableKey: (row: T) => number;
  rowPath: (row: T) => string;
  /** A custom cell, or `undefined` for the column's plain text value. */
  renderCell: (key: string, row: T) => ReactNode | undefined;
  /** Shown when this list/prefix has no parts, but the source list does. */
  emptyText: string;
  /** The source list(s) came back with NO rows at all — see the render. */
  sourceEmpty: boolean;
  /** Beside the heading — the New part button on a list screen. */
  action?: ReactNode;
}

function PartsTable<T>({
  title,
  subtitle,
  icon,
  queries,
  listNames,
  rows,
  columns,
  searchFields,
  stableKey,
  rowPath,
  renderCell,
  emptyText,
  sourceEmpty,
  action,
}: PartsTableProps<T>) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [showAll, setShowAll] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [fitRef, fitHeight] = useFitToWindow();

  const q = params.get("q") ?? "";
  const paramKey = params.toString();
  const fieldQueries = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of searchFields) out[f.key] = params.get(`${PART_FIELD_PREFIX}${f.key}`) ?? "";
    return out;
    // `params` is a new object on every render; its string form is the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey, searchFields]);

  const rangeQueries = useMemo(() => {
    const out: Record<string, RangeQuery> = {};
    for (const f of searchFields) {
      if (!f.range) continue;
      const from = params.get(`${RANGE_FROM_PREFIX}${f.key}`) ?? "";
      const to = params.get(`${RANGE_TO_PREFIX}${f.key}`) ?? "";
      if (from || to) out[f.key] = { from, to };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey, searchFields]);

  // Which fields show From/To. A range in the URL always does — a shared
  // link must show the search that is narrowing the list.
  const [rangeOpen, setRangeOpen] = useState<Set<string>>(() => new Set());
  const inRange = (key: string) => rangeOpen.has(key) || key in rangeQueries;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setShowAll(false);
  }

  /** The "R" button: one box ⇄ From/To. Switching drops the other mode's search. */
  function toggleRange(key: string) {
    const next = new URLSearchParams(params);
    const opening = !inRange(key);
    if (opening) next.delete(`${PART_FIELD_PREFIX}${key}`);
    else {
      next.delete(`${RANGE_FROM_PREFIX}${key}`);
      next.delete(`${RANGE_TO_PREFIX}${key}`);
    }
    setRangeOpen((prev) => {
      const s = new Set(prev);
      if (opening) s.add(key);
      else s.delete(key);
      return s;
    });
    setParams(next, { replace: true });
    setShowAll(false);
  }

  function clearSearch() {
    const next = new URLSearchParams(params);
    next.delete("q");
    for (const f of searchFields) {
      next.delete(`${PART_FIELD_PREFIX}${f.key}`);
      next.delete(`${RANGE_FROM_PREFIX}${f.key}`);
      next.delete(`${RANGE_TO_PREFIX}${f.key}`);
    }
    setRangeOpen(new Set());
    setParams(next, { replace: true });
    setShowAll(false);
  }

  // The lowercased text "Search everything" looks through, built once per
  // list load rather than once per keystroke — 18,000 rows in Global Search.
  const haystacks = useMemo(() => {
    const map = new Map<T, string>();
    for (const row of rows) map.set(row, searchFields.map((f) => f.value(row)).join(" ").toLowerCase());
    return map;
  }, [rows, searchFields]);

  const filtered = useMemo(() => {
    const byField = applyRangeQueries(applyFieldQueries(rows, searchFields, fieldQueries), searchFields, rangeQueries);
    const tokens = tokenizeQuery(q);
    if (tokens.length === 0) return byField;
    return byField.filter((row) => {
      const hay = haystacks.get(row) ?? "";
      return tokens.every((t) => hay.includes(t));
    });
  }, [rows, searchFields, fieldQueries, rangeQueries, q, haystacks]);

  const table = useSortableTable<T>({
    rows: filtered,
    columns,
    stableKey,
    initialKey: "partNumber",
    onChange: () => setShowAll(false),
  });

  const shown = showAll ? table.rows : table.rows.slice(0, INITIAL_ROWS);

  const activeCount =
    (q.trim() ? 1 : 0) +
    Object.values(fieldQueries).filter((v) => v.trim()).length +
    Object.keys(rangeQueries).length;
  // An active search forces the panel open on a phone, so the reason the
  // list is narrowed can never be hidden — including one from a shared link.
  const panelOpen = panelExpanded || activeCount > 0;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <nav className="flex items-center gap-2 text-sm">
        <Link to="/engineering/parts" className="text-fg-muted hover:text-fg">
          Parts List
        </Link>
        <span className="text-fg-muted">/</span>
        <span className="font-medium text-fg">{title}</span>
      </nav>

      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
          {icon ?? <Cpu className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">{title}</h1>
          <p className="text-sm text-fg-muted">{subtitle}</p>
        </div>
        {action}
      </header>

      <button
        type="button"
        onClick={() => setPanelExpanded((v) => !v)}
        aria-expanded={panelOpen}
        aria-controls="parts-search-panel"
        className="inline-flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-fg lg:hidden"
      >
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-fg-muted" />
          Search
          {activeCount > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold tabular-nums text-white">
              {activeCount}
            </span>
          )}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-fg-muted transition-transform", panelOpen && "rotate-180")} />
      </button>

      <div ref={fitRef} className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <aside
          id="parts-search-panel"
          role="search"
          aria-label={`${title} search`}
          style={fitHeight ? { maxHeight: fitHeight } : undefined}
          className={cn(
            "scroll-elegant flex-col gap-3 rounded-xl border border-border bg-surface p-3 lg:flex lg:w-64 lg:shrink-0 lg:overflow-y-auto",
            panelOpen ? "flex" : "hidden",
          )}
        >
          <PanelField label="Search everything">
            <SearchInput value={q} onChange={(v) => setParam("q", v)} placeholder="Any words, any field" />
          </PanelField>
          <p className="text-[11px] text-fg-muted">
            Or search one field. Use <span className="font-mono">&amp;</span> for several things in one
            box: <span className="font-mono">resistor&amp;1k</span>.
          </p>
          {searchFields.map((f) =>
            f.range ? (
              <RangeField
                key={f.key}
                field={f}
                ranged={inRange(f.key)}
                onToggle={() => toggleRange(f.key)}
                text={fieldQueries[f.key]}
                onText={(v) => setParam(`${PART_FIELD_PREFIX}${f.key}`, v)}
                range={rangeQueries[f.key] ?? { from: "", to: "" }}
                onFrom={(v) => setParam(`${RANGE_FROM_PREFIX}${f.key}`, v)}
                onTo={(v) => setParam(`${RANGE_TO_PREFIX}${f.key}`, v)}
                rows={rows}
              />
            ) : (
              <PanelField key={f.key} label={f.label}>
                <SearchInput
                  value={fieldQueries[f.key]}
                  onChange={(v) => setParam(`${PART_FIELD_PREFIX}${f.key}`, v)}
                  placeholder={f.label}
                />
              </PanelField>
            ),
          )}
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearSearch}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              <X className="h-3.5 w-3.5" />
              Clear search
            </button>
          )}
        </aside>

        <div className="min-w-0 flex-1">
          <PartsDataGate queries={queries} listNames={listNames}>
            {sourceEmpty ? (
              // The read SUCCEEDED with no rows at all. SharePoint answers an
              // item-level permission problem exactly this way (200, zero rows,
              // security-trimmed), and these lists hold thousands of parts, so
              // say so rather than claim the list is empty.
              <div className="rounded-xl border border-dashed border-border px-4 py-16 text-center text-sm text-fg-muted">
                <p className="font-medium text-fg">No parts to show.</p>
                <p className="mx-auto mt-1 max-w-md">
                  SharePoint returned {listNames} with no rows. It normally holds thousands, so your
                  account may be able to open the list without being able to see its items — ask an
                  admin to check your permissions on the{" "}
                  <span className="font-mono text-xs">Altronic_Engineering</span> site.
                </p>
              </div>
            ) : rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-fg-muted">
                {emptyText}
              </p>
            ) : (
              <div
                style={fitHeight ? { maxHeight: fitHeight } : undefined}
                className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface"
              >
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">
                  <span>
                    {table.rows.length === rows.length
                      ? `${rows.length.toLocaleString()} part${rows.length === 1 ? "" : "s"}`
                      : `${table.rows.length.toLocaleString()} of ${rows.length.toLocaleString()} parts`}
                  </span>
                  {shown.length < table.rows.length && (
                    <button
                      type="button"
                      onClick={() => setShowAll(true)}
                      className="text-xs font-medium text-accent underline-offset-2 hover:underline"
                    >
                      Showing {shown.length.toLocaleString()} — show all
                    </button>
                  )}
                </div>
                {table.rows.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-fg-muted">
                    No parts match this search.
                  </p>
                ) : (
                  // Scrolls BOTH ways in its own box on a desktop, so the
                  // horizontal scrollbar is always in view rather than at the
                  // bottom of a 150-row page.
                  <div className="scroll-elegant min-h-0 flex-1 overflow-auto">
                    <table className="w-full min-w-[900px] border-collapse text-sm">
                      {/* Sticky, so the headings stay put while the rows scroll. */}
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b border-border bg-surface-2 text-left">
                          {columns.map((column) => (
                            <SortableHeader
                              key={column.key}
                              label={column.label}
                              {...table.headerProps(column.key)}
                            />
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((row) => {
                          const to = rowPath(row);
                          return (
                            <tr
                              key={stableKey(row)}
                              onClick={(e) => {
                                // The part number is a real link (ctrl-click, new
                                // tab); a click on it must not ALSO navigate here.
                                if ((e.target as HTMLElement).closest("a")) return;
                                navigate(to);
                              }}
                              className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2/60"
                            >
                              {columns.map((column) => (
                                <td
                                  key={column.key}
                                  className={cn(
                                    "px-3 py-2 align-top text-fg",
                                    column.key === "description" ? "min-w-[16rem]" : "whitespace-nowrap",
                                  )}
                                >
                                  {column.key === "partNumber" ? (
                                    <Link to={to} className="font-mono font-medium text-fg hover:text-accent hover:underline">
                                      {column.value(row) || "—"}
                                    </Link>
                                  ) : (
                                    (renderCell(column.key, row) ?? (column.value(row) || "—"))
                                  )}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </PartsDataGate>
        </div>
      </div>
    </div>
  );
}

/** Below this width the panel stacks above the table and the PAGE scrolls. */
const DESKTOP_QUERY = "(min-width: 1024px)";
/** Never squeeze the table below this on a short window — let the page scroll instead. */
const MIN_FIT_HEIGHT = 320;
/** Breathing room between the table's bottom edge and the footer. */
const FOOTER_GAP = 16;

/**
 * On a desktop, the height that fits an element between where it starts on
 * the page and the FIXED footer — so the search panel and the table each
 * scroll inside themselves, and the table's horizontal scrollbar sits just
 * above the footer instead of at the bottom of a long page (Tim, 2026-09-28).
 *
 * Measured, not a hard-coded calc(): the header, the update banner and the
 * footer all vary in height, and a guessed offset is wrong the day one of
 * them changes. Null on a phone (and wherever matchMedia is missing), which
 * leaves the ordinary page scroll alone.
 */
function useFitToWindow(): [RefObject<HTMLDivElement>, number | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    function measure() {
      const el = ref.current;
      if (!el || !mq.matches) return setHeight(null);
      const footer = document.querySelector("footer");
      const footerHeight = footer ? footer.getBoundingClientRect().height : 0;
      // Document position, so a measure taken while scrolled still agrees.
      const top = el.getBoundingClientRect().top + window.scrollY;
      const fit = Math.floor(window.innerHeight - top - footerHeight - FOOTER_GAP);
      setHeight((prev) => {
        const next = Math.max(MIN_FIT_HEIGHT, fit);
        return prev === next ? prev : next;
      });
    }
    measure();
    window.addEventListener("resize", measure);
    mq.addEventListener?.("change", measure);
    // The header and footer can change height (the update banner appearing,
    // the footer wrapping) without a window resize.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    const header = document.querySelector("header");
    const footer = document.querySelector("footer");
    if (header) observer?.observe(header);
    if (footer) observer?.observe(footer);
    return () => {
      window.removeEventListener("resize", measure);
      mq.removeEventListener?.("change", measure);
      observer?.disconnect();
    };
  }, []);

  return [ref, height];
}

/**
 * A field that can search a range — the old app's black "R" button beside it.
 *
 * A <div>, not the <label> PanelField uses: the R button is interactive, and
 * a button inside a label steals the label's click (the SearchableSelect
 * nesting lesson). The boxes carry their own aria-labels instead.
 */
function RangeField<T>({
  field,
  ranged,
  onToggle,
  text,
  onText,
  range,
  onFrom,
  onTo,
  rows,
}: {
  field: SearchField<T>;
  ranged: boolean;
  onToggle: () => void;
  text: string;
  onText: (v: string) => void;
  range: RangeQuery;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  rows: T[];
}) {
  const from = parseBound(range.from, "from");
  const to = parseBound(range.to, "to");
  const active = from.value !== null || to.value !== null;
  // Only worked out while a range is showing — a scan of the whole list.
  const unreadable = useMemo(() => (ranged ? unreadableCount(rows, field) : 0), [ranged, rows, field]);

  const readAs = (b: ReturnType<typeof parseBound>) =>
    b.value === null ? null : formatEngineeringValue(b.value, b.unit);
  const fromText = readAs(from);
  const toText = readAs(to);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{field.label}</span>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={ranged}
          aria-label={`Search ${field.label} as a range`}
          title={ranged ? "Back to a text search" : "Search a range — From and To"}
          className={cn(
            "h-5 w-5 rounded text-[11px] font-bold leading-none",
            ranged ? "bg-fg text-bg" : "border border-border text-fg-muted hover:border-fg-muted hover:text-fg",
          )}
        >
          R
        </button>
      </div>
      {ranged ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <SearchInput value={range.from} onChange={onFrom} placeholder="From" ariaLabel={`${field.label} from`} />
            <SearchInput value={range.to} onChange={onTo} placeholder="To" ariaLabel={`${field.label} to`} />
          </div>
          <p className="mt-1 text-[11px] text-fg-muted">
            {from.unreadable || to.unreadable ? (
              <span className="text-cooper-red">
                Couldn't read “{from.unreadable ? range.from : range.to}” as a value — try 4K7, 10uF or 250mW.
              </span>
            ) : active ? (
              <>
                Reads as{" "}
                {fromText && toText
                  ? `${fromText} to ${toText}`
                  : fromText
                    ? `${fromText} or more`
                    : `up to ${toText}`}
                .
              </>
            ) : (
              "4K7, 10uF, 250mW, -40 — engineering values work."
            )}
            {unreadable > 0 && (
              <>
                {" "}
                {unreadable.toLocaleString()} {unreadable === 1 ? "part has" : "parts have"} no number here (“SEE DATA
                SHEET” and the like) and can't be found by range.
              </>
            )}
          </p>
        </>
      ) : (
        <SearchInput value={text} onChange={onText} placeholder={field.label} ariaLabel={field.label} />
      )}
    </div>
  );
}

function PanelField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
