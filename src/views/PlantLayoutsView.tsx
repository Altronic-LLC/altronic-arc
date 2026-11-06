import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Map as MapIcon, Plus } from "lucide-react";
import { useCreatePlantLayout, usePlantLayouts } from "@/hooks/usePlantLayouts";
import { useMyPlantMapAccess } from "@/hooks/usePlantMapRoles";
import type { PlantLayout } from "@/types/plant";
import { editLayoutGate } from "@/lib/plantMapRoles";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { dayLabel, type SortColumn } from "@/lib/tableSort";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SortableHeader } from "@/components/SortableTableHeader";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { NewPlantLayoutModal } from "@/components/NewPlantLayoutModal";
import { PlantLayoutStatusChip, PlantMapAccessGate, PlantMapNav } from "@/components/plantMapAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// Plant Map — every plant layout, each version its own row. Click one to see
// it drawn to scale. New layout (editors) uploads a building's walls drawing
// and starts an empty draft — or, for a building that has one, reuses its drawing.
//
// A tab per BUILDING across the top (in the URL, `?building=`), plus All.
// Buildings come from the layouts themselves: starting a layout in a new
// building is what adds its tab.
// =============================================================================

const COLUMNS: SortColumn<PlantLayout>[] = [
  { key: "title", label: "Layout", value: (l) => l.title },
  { key: "building", label: "Building", value: (l) => l.building },
  { key: "area", label: "Area", value: (l) => l.area },
  { key: "version", label: "Version", kind: "number", value: (l) => `v${l.version}`, sortValue: (l) => l.version },
  { key: "status", label: "Status", value: (l) => l.status },
  {
    key: "items",
    label: "Items",
    kind: "number",
    value: (l) => String(l.doc.items.length),
    sortValue: (l) => l.doc.items.length,
    noFilter: true,
  },
  { key: "modifiedBy", label: "Updated by", value: (l) => l.modifiedBy },
  {
    key: "modifiedAt",
    label: "Updated",
    kind: "date",
    value: (l) => dayLabel(l.modifiedAt),
    sortValue: (l) => l.modifiedAt,
  },
];

export function PlantLayoutsView() {
  return (
    <PlantMapAccessGate>
      <PlantLayouts />
    </PlantMapAccessGate>
  );
}

function PlantLayouts() {
  const navigate = useNavigate();
  const { data: layouts = [], isLoading, error, refetch } = usePlantLayouts();
  const access = useMyPlantMapAccess();
  const create = useCreatePlantLayout();
  const [showNew, setShowNew] = useState(false);
  const [params, setParams] = useSearchParams();
  const buildings = useMemo(
    () => [...new Set(layouts.map((l) => l.building).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [layouts],
  );
  // A building in the URL that has no layouts (yet, or any more) still filters — to nothing.
  const building = params.get("building") ?? "";
  const shownLayouts = useMemo(
    () => (building ? layouts.filter((l) => l.building === building) : layouts),
    [layouts, building],
  );
  function pickBuilding(next: string) {
    const p = new URLSearchParams(params);
    if (next) p.set("building", next);
    else p.delete("building");
    setParams(p, { replace: true });
  }
  const canEdit = editLayoutGate(access).allowed;
  const listUnavailable = !!error && isPermissionDenied(error);

  const table = useSortableTable<PlantLayout>({
    rows: shownLayouts,
    columns: COLUMNS,
    stableKey: (l) => l.id,
    initialKey: "title",
  });
  const published = useMemo(() => shownLayouts.filter((l) => l.status === "Published").length, [shownLayouts]);

  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <MapIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Plant Map</h1>
            <p className="text-sm text-fg-muted">
              The plant's layouts, drawn to scale over each building's walls — every machine, bench and rack where it stands.
            </p>
          </div>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 self-start rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            New layout
          </button>
        )}
      </header>

      <PlantMapNav />

      {buildings.length > 0 && (
        <div role="tablist" aria-label="Buildings" className="flex flex-wrap items-center gap-1 rounded-lg bg-surface-2 p-1">
          {["", ...buildings].map((b) => {
            const count = b ? layouts.filter((l) => l.building === b).length : layouts.length;
            return (
              <button
                key={b || "all"}
                type="button"
                role="tab"
                aria-selected={building === b}
                onClick={() => pickBuilding(b)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  building === b ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg",
                )}
              >
                {b || "All buildings"}
                <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-bold tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">
          {isLoading
            ? "Loading…"
            : `${shownLayouts.length} layout version${shownLayouts.length === 1 ? "" : "s"} · ${published} published`}
        </div>
        {isLoading ? (
          <LoadingTasks noun="plant layouts" />
        ) : listUnavailable ? (
          <div className="p-4">
            <ListAccessNotice list="Plant Layouts" site="Altronic_PMO" onRetry={() => void refetch()} />
          </div>
        ) : error ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">Couldn't load the plant layouts.</p>
            <p className="mt-1">{error instanceof Error ? error.message : "Unknown error"}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              Try again
            </button>
          </div>
        ) : layouts.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">No plant layouts yet.</p>
            {canEdit && <p className="mt-1">Start one with New layout and the building's walls drawing.</p>}
          </div>
        ) : shownLayouts.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            No layouts in {building}.{" "}
            <button type="button" onClick={() => pickBuilding("")} className="text-accent hover:underline">
              Show all buildings
            </button>
          </div>
        ) : (
          <>
            {/* Two renderings of the SAME rows, split at `sm`. jsdom renders both. */}
            <div className="divide-y divide-border sm:hidden">
              {table.rows.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => navigate(`/operations/plant-map/${l.id}`)}
                  className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">{l.title || `Layout #${l.id}`}</span>
                    <span className="text-xs text-fg-muted">v{l.version}</span>
                    <span className="ml-auto">
                      <PlantLayoutStatusChip status={l.status} />
                    </span>
                  </span>
                  <span className="truncate text-xs text-fg-muted">
                    {[l.building !== l.title ? l.building : "", l.area, `${l.doc.items.length} items`, dayLabel(l.modifiedAt)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    {COLUMNS.map((c) => (
                      <SortableHeader key={c.key} label={c.label} {...table.headerProps(c.key)} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((l) => (
                    <tr
                      key={l.id}
                      onClick={() => navigate(`/operations/plant-map/${l.id}`)}
                      className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
                    >
                      <td className="whitespace-nowrap px-4 py-2 font-medium text-fg">
                        <Link
                          to={`/operations/plant-map/${l.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-accent hover:underline"
                        >
                          {l.title || `Layout #${l.id}`}
                        </Link>
                      </td>
                      <td className="max-w-[14rem] truncate px-4 py-2 text-fg-muted">{l.building || "—"}</td>
                      <td className="max-w-[16rem] truncate px-4 py-2 text-fg-muted">{l.area || "—"}</td>
                      <td className="px-4 py-2 tabular-nums text-fg-muted">v{l.version}</td>
                      <td className="px-4 py-2">
                        <PlantLayoutStatusChip status={l.status} />
                      </td>
                      <td className="px-4 py-2 tabular-nums text-fg-muted">
                        {l.docCorrupt ? <span className="text-cooper-red">Unreadable</span> : l.doc.items.length}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{l.modifiedBy || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">{dayLabel(l.modifiedAt) || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showNew && (
        <NewPlantLayoutModal
          buildings={buildings}
          layouts={layouts}
          defaultBuilding={building}
          busy={create.isPending}
          onClose={() => setShowNew(false)}
          onCreate={async (input) => {
            const created = await create.mutateAsync(input);
            setShowNew(false);
            // Straight into the editor — an empty layout is for building.
            navigate(`/operations/plant-map/${created.id}/edit`);
          }}
        />
      )}
    </div>
  );
}
