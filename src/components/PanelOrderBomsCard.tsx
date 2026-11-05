import { useState } from "react";
import { Link } from "react-router-dom";
import { Package, Plus } from "lucide-react";
import { usePanelBoms, useSetPanelBomOrder } from "@/hooks/usePanelBom";
import { usePanelTeamAccess } from "@/hooks/usePanelRoles";
import { PANEL_BOMS_CONFIGURED } from "@/api/panelBoms";
import { bomsForOrder } from "@/lib/panelBom";
import { isAccessDeniedError } from "@/lib/listAccess";
import { SingleSelect } from "./SearchableSelect";

// =============================================================================
// A Panel Order's BOMs (BusinessIT#59). The link is stored ONCE, on the BOM
// (its Panel Order column); this card lists the BOMs that point here. It
// starts a new BOM already pointed at the order, or links one saved without
// an order (Tim, 2026-11-05: a BOM can be saved first and linked later).
// Panel team only, like the builder itself.
// =============================================================================

export function PanelOrderBomsCard({ orderId }: { orderId: number }) {
  const access = usePanelTeamAccess();
  const { data: boms = [], isPending, error } = usePanelBoms();
  const link = useSetPanelBomOrder();
  const [picking, setPicking] = useState(false);
  if (!PANEL_BOMS_CONFIGURED || !access.canOpenBom) return null;

  const mine = bomsForOrder(boms, orderId);
  const unlinked = boms.filter((b) => !b.panelOrder);

  return (
    <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          <Package className="h-4 w-4" /> BOMs
        </h2>
        {access.canBuildBom && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {unlinked.length > 0 && !picking && (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
              >
                Link a saved BOM
              </button>
            )}
            <Link
              to={`/panels/bom-builder?order=${orderId}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              <Plus className="h-4 w-4" /> New BOM
            </Link>
          </div>
        )}
      </div>
      {picking && (
        <div className="mb-3 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SingleSelect
              ariaLabel="Saved BOM to link"
              allLabel="Pick a BOM saved without an order"
              searchPlaceholder="Search BOMs…"
              options={unlinked.map((b) => ({ value: String(b.id), label: b.panelSystemNumber || `BOM ${b.id}` }))}
              selected={null}
              onChange={(v) => {
                if (!v) return;
                link.mutate({ id: Number(v), panelOrderId: orderId });
                setPicking(false);
              }}
            />
          </div>
          <button type="button" onClick={() => setPicking(false)} className="text-sm text-fg-muted hover:underline">
            Cancel
          </button>
        </div>
      )}
      {isPending ? (
        <p className="text-sm text-fg-muted">Loading BOMs…</p>
      ) : error ? (
        <p className="text-sm text-cooper-red">
          {isAccessDeniedError(error) ? "You don't have access to the Panel BOMs list — ask an admin." : "Couldn't load the BOMs."}
        </p>
      ) : mine.length === 0 ? (
        <p className="text-sm text-fg-muted">No BOM is linked to this order yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {mine.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <Link to={`/panels/bom-builder/${b.id}`} className="min-w-0 flex-1 truncate font-medium text-fg hover:underline">
                {b.panelSystemNumber || `BOM ${b.id}`}
              </Link>
              <span className="text-xs text-fg-muted">
                {b.savedLines.length + b.savedManual.length} lines
                {b.modifiedAt && ` · saved ${b.modifiedAt.toLocaleDateString()}`}
                {b.modifiedBy && ` by ${b.modifiedBy.displayName}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
