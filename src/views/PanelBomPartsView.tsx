import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Boxes, Plus } from "lucide-react";
import { usePanelBomKits, usePanelBomParts } from "@/hooks/usePanelBom";
import { usePanelTeamAccess } from "@/hooks/usePanelRoles";
import { useSortableTable } from "@/hooks/useSortableTable";
import { PANEL_BOM_PARTS_CONFIGURED } from "@/api/panelBomParts";
import { SortableHeader } from "@/components/SortableTableHeader";
import { LoadingTasks } from "@/components/LoadingTasks";
import { PanelTeamGate } from "@/components/PanelTeamGate";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { DetailTopBar } from "@/components/DetailTopBar";
import { useFitToWindow } from "@/hooks/useFitToWindow";
import { SearchInput } from "@/components/SearchInput";
import { PanelBomPartFormModal } from "@/components/PanelBomPartFormModal";
import { PanelBomKitFormModal } from "@/components/PanelBomKitFormModal";
import { isAccessDeniedError } from "@/lib/listAccess";
import { matchesTokens } from "@/lib/itemSearch";
import { clusterName } from "@/lib/panelBom";
import type { SortColumn } from "@/lib/tableSort";
import type { PanelBomKit, PanelBomPart } from "@/types/panelBom";
import { cn } from "@/lib/cn";

// =============================================================================
// Panel SAP BOM Builder → Parts & kits (/panels/bom-parts, ?tab=kits). ARC is
// the master for both lists (Tim, 2026-11-05) — this is where they're kept
// up to date, replacing the monthly workbook update and rebuild. Readable by
// the panel team; changed by a panel Super User or an ARC admin.
//
// No cost here: cost is SAP's, read through Fabric in the builder.
// =============================================================================

/** Big list — cap what's RENDERED, never what's filtered or counted. */
const INITIAL_ROWS = 150;

const yesNo = (b: boolean) => (b ? "Yes" : "No");

const PART_COLUMNS: SortColumn<PanelBomPart>[] = [
  { key: "sap", label: "SAP #", value: (p) => p.sapPartNumber, noFilter: true },
  { key: "alt", label: "MFG / Altronic #", value: (p) => p.altronicPartNumber, noFilter: true },
  { key: "desc", label: "Description", value: (p) => p.description, noFilter: true },
  {
    key: "cluster",
    label: "Cluster",
    kind: "number",
    value: (p) => `${p.cluster} · ${clusterName(p.cluster)}`,
    sortValue: (p) => p.cluster,
  },
  { key: "cat", label: "Category", value: (p) => p.category },
  { key: "std", label: "Std", value: (p) => yesNo(p.standard) },
  { key: "pref", label: "Pref", value: (p) => yesNo(p.preferred) },
  { key: "dnq", label: "DNQ", value: (p) => yesNo(p.doNotQuote) },
  {
    key: "qiu",
    label: "Qty if used",
    kind: "number",
    value: (p) => (p.qtyIfUsed === null ? "" : String(p.qtyIfUsed)),
    sortValue: (p) => p.qtyIfUsed,
    noFilter: true,
  },
  { key: "ds", label: "Datasheet", value: (p) => p.datasheet, noFilter: true },
  { key: "active", label: "Active", value: (p) => yesNo(p.active) },
];

const KIT_COLUMNS: SortColumn<PanelBomKit>[] = [
  { key: "name", label: "Kit", value: (k) => k.name, noFilter: true },
  { key: "desc", label: "Description", value: (k) => k.description, noFilter: true },
  { key: "cat", label: "Category", value: (k) => k.category },
  {
    key: "count",
    label: "Components",
    kind: "number",
    value: (k) => String(k.components.length),
    sortValue: (k) => k.components.length,
    noFilter: true,
  },
  { key: "manual", label: "Non-SAP parts", value: (k) => yesNo(k.components.some((c) => !c.sapPartNumber)) },
  { key: "std", label: "Std", value: (k) => yesNo(k.standard) },
  { key: "pref", label: "Pref", value: (k) => yesNo(k.preferred) },
  { key: "active", label: "Active", value: (k) => yesNo(k.active) },
];

/** Panel team only — anybody on Panel User Roles, or an ARC admin. */
export function PanelBomPartsView() {
  return (
    <PanelTeamGate noun="the BOM parts and kits" bom>
      <BomPartsAndKits />
    </PanelTeamGate>
  );
}

function BomPartsAndKits() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "kits" ? "kits" : "parts";
  const access = usePanelTeamAccess();
  const canManage = access.canManageBomParts && PANEL_BOM_PARTS_CONFIGURED;
  const partsQ = usePanelBomParts();
  const kitsQ = usePanelBomKits();
  const parts = useMemo(() => partsQ.data ?? [], [partsQ.data]);
  const kits = useMemo(() => kitsQ.data ?? [], [kitsQ.data]);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of tab === "kits" ? kits : parts) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [tab, parts, kits]);

  const [editingPart, setEditingPart] = useState<PanelBomPart | "new" | null>(null);
  const [editingKit, setEditingKit] = useState<PanelBomKit | "new" | null>(null);
  const q = tab === "kits" ? kitsQ : partsQ;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="BOM Builder" listTo="/panels/bom-builder" />
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Boxes className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg">BOM parts &amp; kits</h1>
            <p className="text-sm text-fg-muted">
              What the <Link to="/panels/bom-builder" className="underline">Panel SAP BOM Builder</Link> offers. Cost isn't
              kept here — the builder reads it from SAP.
            </p>
          </div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => (tab === "kits" ? setEditingKit("new") : setEditingPart("new"))}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" /> {tab === "kits" ? "Add kit" : "Add part"}
          </button>
        )}
      </div>

      <div role="tablist" className="flex gap-1 border-b border-border">
        {(["parts", "kits"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            type="button"
            onClick={() => setParams(t === "kits" ? { tab: "kits" } : {}, { replace: true })}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              tab === t ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t === "parts" ? `Parts (${parts.length})` : `Kits (${kits.length})`}
          </button>
        ))}
      </div>

      {!PANEL_BOM_PARTS_CONFIGURED && (
        <p className="rounded-md border border-ajax-yellow/50 bg-ajax-yellow/10 px-3 py-2 text-sm text-fg">
          The parts and kits lists aren't set up yet. Run scripts/create-panel-bom-lists.ps1 and
          scripts/load-panel-bom-lists.ps1, then set the list ids.
        </p>
      )}
      {PANEL_BOM_PARTS_CONFIGURED && !access.canManageBomParts && access.bomPartsHint && (
        <p className="text-sm text-fg-muted">{access.bomPartsHint}</p>
      )}

      {q.isPending ? (
        <LoadingTasks noun={tab === "kits" ? "the kits" : "the parts"} />
      ) : q.error ? (
        isAccessDeniedError(q.error) ? (
          <ListAccessNotice list={tab === "kits" ? "Panel BOM Kits" : "Panel BOM Parts"} site="ALTRONICPANELTEAM" onRetry={() => void q.refetch()} />
        ) : (
          <p className="text-sm text-cooper-red">
            Couldn't load the {tab}: {q.error instanceof Error ? q.error.message : String(q.error)}{" "}
            <button type="button" className="underline" onClick={() => void q.refetch()}>
              Try again
            </button>
          </p>
        )
      ) : tab === "kits" ? (
        <KitsTable kits={kits} onOpen={canManage ? setEditingKit : undefined} />
      ) : (
        <PartsTable parts={parts} onOpen={canManage ? setEditingPart : undefined} />
      )}

      {editingPart && (
        <PanelBomPartFormModal
          part={editingPart === "new" ? null : editingPart}
          categories={categories}
          onClose={() => setEditingPart(null)}
        />
      )}
      {editingKit && (
        <PanelBomKitFormModal
          kit={editingKit === "new" ? null : editingKit}
          parts={parts}
          categories={categories}
          onClose={() => setEditingKit(null)}
        />
      )}
    </div>
  );
}

function PartsTable({ parts, onOpen }: { parts: PanelBomPart[]; onOpen?: (p: PanelBomPart) => void }) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(
    () => parts.filter((p) => matchesTokens(`${p.sapPartNumber} ${p.altronicPartNumber} ${p.description} ${p.category}`, query)),
    [parts, query],
  );
  const table = useSortableTable({
    rows,
    columns: PART_COLUMNS,
    stableKey: (p) => p.id,
    initialKey: "cluster",
    onChange: () => setShowAll(false),
  });
  const shown = showAll ? table.rows : table.rows.slice(0, INITIAL_ROWS);
  return (
    <TableShell
      count={table.rows.length}
      noun="part"
      query={query}
      onQuery={(v) => {
        setQuery(v);
        setShowAll(false);
      }}
      hiddenCount={table.rows.length - shown.length}
      onShowAll={() => setShowAll(true)}
    >
      {/* Sticky, so the column names stay in view while the rows scroll in their own box. */}
      <thead className="sticky top-0 z-10">
        <tr className="border-b border-border bg-surface-2 text-left text-xs text-fg-muted">
          {PART_COLUMNS.map((c) => (
            <SortableHeader key={c.key} label={c.label} {...table.headerProps(c.key)} />
          ))}
        </tr>
      </thead>
      <tbody>
        {shown.map((p) => (
          <tr
            key={p.id}
            onClick={onOpen ? () => onOpen(p) : undefined}
            className={cn("border-b border-border last:border-0", onOpen && "cursor-pointer hover:bg-surface-2", !p.active && "text-fg-muted")}
          >
            <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
              {onOpen ? (
                <button type="button" className="hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(p); }}>
                  {p.sapPartNumber}
                </button>
              ) : (
                p.sapPartNumber
              )}
            </td>
            <td className="whitespace-nowrap px-3 py-1.5 text-fg-muted">{p.altronicPartNumber}</td>
            <td className="px-3 py-1.5">{p.description}</td>
            <td className="px-3 py-1.5">{p.cluster} · {clusterName(p.cluster)}</td>
            <td className="px-3 py-1.5">{p.category}</td>
            <td className="px-3 py-1.5">{p.standard ? "Yes" : ""}</td>
            <td className="px-3 py-1.5">{p.preferred ? "Yes" : ""}</td>
            <td className="px-3 py-1.5">{p.doNotQuote ? <span className="text-cooper-red">Yes</span> : ""}</td>
            <td className="px-3 py-1.5 tabular-nums">{p.qtyIfUsed ?? ""}</td>
            <td className="max-w-[12rem] truncate px-3 py-1.5 text-xs text-fg-muted" title={p.datasheet}>{p.datasheet}</td>
            <td className="px-3 py-1.5">{p.active ? "Yes" : "Retired"}</td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function KitsTable({ kits, onOpen }: { kits: PanelBomKit[]; onOpen?: (k: PanelBomKit) => void }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () =>
      kits.filter((k) =>
        matchesTokens(`${k.name} ${k.description} ${k.category} ${k.components.map((c) => `${c.sapPartNumber} ${c.mfgPartNumber}`).join(" ")}`, query),
      ),
    [kits, query],
  );
  const table = useSortableTable({ rows, columns: KIT_COLUMNS, stableKey: (k) => k.id, initialKey: "cat" });
  return (
    <TableShell count={table.rows.length} noun="kit" query={query} onQuery={setQuery} hiddenCount={0}>
      {/* Sticky, so the column names stay in view while the rows scroll in their own box. */}
      <thead className="sticky top-0 z-10">
        <tr className="border-b border-border bg-surface-2 text-left text-xs text-fg-muted">
          {KIT_COLUMNS.map((c) => (
            <SortableHeader key={c.key} label={c.label} {...table.headerProps(c.key)} />
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((k) => (
          <tr
            key={k.id}
            onClick={onOpen ? () => onOpen(k) : undefined}
            className={cn("border-b border-border last:border-0", onOpen && "cursor-pointer hover:bg-surface-2", !k.active && "text-fg-muted")}
          >
            <td className="whitespace-nowrap px-3 py-1.5 font-medium">
              {onOpen ? (
                <button type="button" className="hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(k); }}>
                  {k.name}
                </button>
              ) : (
                k.name
              )}
            </td>
            <td className="px-3 py-1.5">{k.description}</td>
            <td className="px-3 py-1.5">{k.category}</td>
            <td className="px-3 py-1.5 tabular-nums">
              {k.componentsCorrupt ? <span className="text-cooper-red">Unreadable</span> : k.components.length}
            </td>
            <td className="px-3 py-1.5">{k.components.some((c) => !c.sapPartNumber) ? <span className="text-cooper-red">Yes</span> : ""}</td>
            <td className="px-3 py-1.5">{k.standard ? "Yes" : ""}</td>
            <td className="px-3 py-1.5">{k.preferred ? "Yes" : ""}</td>
            <td className="px-3 py-1.5">{k.active ? "Yes" : "Retired"}</td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function TableShell({
  count,
  noun,
  query,
  onQuery,
  hiddenCount,
  onShowAll,
  children,
}: {
  count: number;
  noun: string;
  query: string;
  onQuery: (v: string) => void;
  hiddenCount: number;
  onShowAll?: () => void;
  children: React.ReactNode;
}) {
  // On a desktop the box fits the window, so the page header stays put and
  // the rows scroll inside it under a sticky column header. A phone keeps the
  // ordinary page scroll (fitHeight is null there).
  const [fitRef, fitHeight] = useFitToWindow();
  return (
    <div
      ref={fitRef}
      style={fitHeight ? { maxHeight: fitHeight } : undefined}
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
        <h2 className="text-sm font-medium text-fg">
          {count} {noun}
          {count === 1 ? "" : "s"}
        </h2>
        <div className="ml-auto w-full sm:w-72">
          <SearchInput value={query} onChange={onQuery} placeholder={`Search ${noun}s…`} />
        </div>
      </div>
      {count === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-fg-muted">Nothing to show.</p>
      ) : (
        <div className="scroll-elegant min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">{children}</table>
        </div>
      )}
      {hiddenCount > 0 && onShowAll && (
        <div className="border-t border-border px-4 py-2 text-center">
          <button type="button" onClick={onShowAll} className="text-sm text-accent hover:underline">
            Show all {count} {noun}s ({hiddenCount} more)
          </button>
        </div>
      )}
    </div>
  );
}
