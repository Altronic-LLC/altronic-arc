import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Package, Plus } from "lucide-react";
import { usePanelBoms } from "@/hooks/usePanelBom";
import { usePanelOrders } from "@/hooks/usePanelOrders";
import { usePanelTeamAccess } from "@/hooks/usePanelRoles";
import { useSortableTable } from "@/hooks/useSortableTable";
import { PANEL_BOMS_CONFIGURED } from "@/api/panelBoms";
import { SortableHeader } from "@/components/SortableTableHeader";
import { LoadingTasks } from "@/components/LoadingTasks";
import { PanelTeamGate } from "@/components/PanelTeamGate";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { DetailTopBar } from "@/components/DetailTopBar";
import { SearchInput } from "@/components/SearchInput";
import { isAccessDeniedError } from "@/lib/listAccess";
import { matchesTokens } from "@/lib/itemSearch";
import { dayLabel, type SortColumn } from "@/lib/tableSort";
import type { PanelBom } from "@/types/panelBom";

// =============================================================================
// Panel SAP BOM Builder → Saved BOMs (/panels/boms). Every BOM the panel team
// has saved, newest first; a row opens it in the builder. Sortable and
// filterable like every table in ARC.
// =============================================================================

interface Row {
  bom: PanelBom;
  orderTitle: string;
}

const COLUMNS: SortColumn<Row>[] = [
  { key: "system", label: "Panel System #", value: (r) => r.bom.panelSystemNumber, noFilter: true },
  { key: "order", label: "Panel Order", value: (r) => r.orderTitle || "No order" },
  {
    key: "lines",
    label: "Lines",
    kind: "number",
    value: (r) => String(r.bom.savedLines.length + r.bom.savedManual.length),
    sortValue: (r) => r.bom.savedLines.length + r.bom.savedManual.length,
    noFilter: true,
  },
  { key: "notes", label: "Notes", value: (r) => r.bom.notes, noFilter: true },
  { key: "by", label: "Last saved by", value: (r) => r.bom.modifiedBy?.displayName ?? "" },
  {
    key: "saved",
    label: "Last saved",
    kind: "date",
    value: (r) => dayLabel(r.bom.modifiedAt),
    sortValue: (r) => r.bom.modifiedAt,
  },
];

/** Panel team only — anybody on Panel User Roles, or an ARC admin. */
export function PanelBomsView() {
  return (
    <PanelTeamGate noun="saved BOMs" bom>
      <SavedBoms />
    </PanelTeamGate>
  );
}

function SavedBoms() {
  const navigate = useNavigate();
  const access = usePanelTeamAccess();
  const { data: boms = [], isPending, error, refetch } = usePanelBoms();
  const { data: orders = [] } = usePanelOrders();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const titles = new Map(orders.map((o) => [o.id, o.title]));
    return boms
      .map((bom) => ({
        bom,
        orderTitle: bom.panelOrder ? titles.get(bom.panelOrder.lookupId) || bom.panelOrder.title || `Order #${bom.panelOrder.lookupId}` : "",
      }))
      .filter((r) => matchesTokens(`${r.bom.panelSystemNumber} ${r.orderTitle} ${r.bom.notes} ${r.bom.modifiedBy?.displayName ?? ""}`, query));
  }, [boms, orders, query]);

  const table = useSortableTable({
    rows,
    columns: COLUMNS,
    stableKey: (r) => r.bom.id,
    initialKey: "saved",
    initialDirection: "desc",
  });

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="BOM Builder" listTo="/panels/bom-builder" />
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Package className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg">Saved BOMs</h1>
            <p className="text-sm text-fg-muted">
              BOMs built in the <Link to="/panels/bom-builder" className="underline">Panel SAP BOM Builder</Link>. Open one to
              change it, copy it into SAP again, or link it to a Panel Order.
            </p>
          </div>
        </div>
        <Link
          to="/panels/bom-builder"
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" /> New BOM
        </Link>
      </div>

      {!PANEL_BOMS_CONFIGURED ? (
        <p className="rounded-md border border-ajax-yellow/50 bg-ajax-yellow/10 px-3 py-2 text-sm text-fg">
          Saving BOMs isn't set up yet (the Panel BOMs list). Run scripts/create-panel-bom-lists.ps1 and set
          VITE_SP_PANEL_BOMS_LIST_ID. The builder still works without it.
        </p>
      ) : isPending ? (
        <LoadingTasks noun="saved BOMs" />
      ) : error ? (
        isAccessDeniedError(error) ? (
          <ListAccessNotice list="Panel BOMs" site="ALTRONICPANELTEAM" onRetry={() => void refetch()} />
        ) : (
          <p className="text-sm text-cooper-red">
            Couldn't load the saved BOMs: {error instanceof Error ? error.message : String(error)}{" "}
            <button type="button" className="underline" onClick={() => void refetch()}>
              Try again
            </button>
          </p>
        )
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
            <h2 className="text-sm font-medium text-fg">
              {table.rows.length} BOM{table.rows.length === 1 ? "" : "s"}
            </h2>
            <div className="ml-auto w-full sm:w-72">
              <SearchInput value={query} onChange={setQuery} placeholder="Search BOMs…" />
            </div>
          </div>
          {table.rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-fg-muted">
              {boms.length === 0
                ? access.canBuildBom
                  ? "No BOMs saved yet — build one and press Save BOM."
                  : "No BOMs saved yet."
                : "Nothing matches."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-fg-muted">
                    {COLUMNS.map((c) => (
                      <SortableHeader key={c.key} label={c.label} {...table.headerProps(c.key)} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r) => (
                    <tr
                      key={r.bom.id}
                      onClick={() => navigate(`/panels/bom-builder/${r.bom.id}`)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2"
                    >
                      <td className="px-3 py-2 font-medium text-fg">
                        <Link to={`/panels/bom-builder/${r.bom.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                          {r.bom.panelSystemNumber || `BOM ${r.bom.id}`}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {r.bom.panelOrder ? (
                          <Link
                            to={`/panels/order/${r.bom.panelOrder.lookupId}`}
                            className="hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.orderTitle}
                          </Link>
                        ) : (
                          <span className="text-fg-muted">No order</span>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{r.bom.savedLines.length + r.bom.savedManual.length}</td>
                      <td className="max-w-[20rem] truncate px-3 py-2 text-fg-muted" title={r.bom.notes}>
                        {r.bom.notes}
                      </td>
                      <td className="px-3 py-2 text-fg-muted">{r.bom.modifiedBy?.displayName ?? ""}</td>
                      <td className="px-3 py-2 tabular-nums text-fg-muted">{dayLabel(r.bom.modifiedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
