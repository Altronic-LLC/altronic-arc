import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { NEW_PRODUCT_PRICING_CONFIGURED } from "@/api/config";
import type { NewProductWorksheet } from "@/types/pricing";
import { useNewProductWorksheets } from "@/hooks/useNewProductPricing";
import { formatMoney, formatPct } from "@/lib/quoteMoney";
import { formatDisplayDate, toIsoDate } from "@/lib/dateInput";
import { tokenizeQuery } from "@/lib/itemSearch";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import type { SortColumn } from "@/lib/tableSort";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SortableHeader } from "@/components/SortableTableHeader";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { SearchInput } from "@/components/SearchInput";
import { NewWorksheetFormModal } from "@/components/NewWorksheetFormModal";
import { PricingHeader, PricingManagerGate, PricingPage } from "@/components/pricingAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// New Product Pricing — every worksheet (/sales/pricing/new-products).
// Managers and admins only. Opens on Active worksheets; Cancelled is a pill
// away. Sortable, filterable headers like every list in ARC.
// =============================================================================

const ACTIVE = "Active";
const ALL = "All";

function modified(w: NewProductWorksheet): string {
  return w.modifiedAt ? toIsoDate(new Date(w.modifiedAt)) : "";
}

export const WORKSHEET_COLUMNS: SortColumn<NewProductWorksheet>[] = [
  { key: "number", label: "Worksheet #", value: (w) => w.worksheetNumber },
  { key: "rev", label: "Rev", kind: "number", value: (w) => `R${w.rev}`, sortValue: (w) => w.rev },
  { key: "product", label: "Product", value: (w) => w.productName, noFilter: true },
  { key: "customer", label: "Customer", value: (w) => w.customerName },
  {
    key: "unitCost",
    label: "Unit cost",
    kind: "number",
    value: (w) => (w.unitCost === null ? "" : formatMoney(w.unitCost)),
    sortValue: (w) => w.unitCost,
    noFilter: true,
  },
  {
    key: "listPrice",
    label: "List price",
    kind: "number",
    value: (w) => (w.listPrice === null ? "" : formatMoney(w.listPrice)),
    sortValue: (w) => w.listPrice,
    noFilter: true,
  },
  {
    key: "baseGM",
    label: "Base GM",
    kind: "number",
    value: (w) => (w.baseGM === null ? "" : formatPct(w.baseGM)),
    sortValue: (w) => w.baseGM,
    noFilter: true,
  },
  { key: "modified", label: "Updated", kind: "date", value: modified, sortValue: (w) => (w.modifiedAt ? new Date(w.modifiedAt) : null) },
];

export function NewProductPricingView() {
  return (
    <PricingManagerGate
      newProducts
      configured={NEW_PRODUCT_PRICING_CONFIGURED}
      listName="NP Sub-Assemblies"
      envVar="VITE_SP_NP_SUBASSEMBLIES_LIST_ID"
    >
      {() => <WorksheetList />}
    </PricingManagerGate>
  );
}

function WorksheetList() {
  const navigate = useNavigate();
  const { data: worksheets = [], isLoading, error, refetch } = useNewProductWorksheets();
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const q = params.get("q") ?? "";
  const status = params.get("status") || ACTIVE;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const searched = useMemo(() => {
    const tokens = tokenizeQuery(q);
    return worksheets.filter((w) => {
      const hay = `${w.worksheetNumber} ${w.productName} ${w.description} ${w.customerName}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [worksheets, q]);
  const filtered = status === ALL ? searched : searched.filter((w) => w.status === status);
  const counts: Record<string, number> = {
    Active: searched.filter((w) => w.status === "Active").length,
    Cancelled: searched.filter((w) => w.status === "Cancelled").length,
    All: searched.length,
  };

  const table = useSortableTable<NewProductWorksheet>({
    rows: filtered,
    columns: WORKSHEET_COLUMNS,
    stableKey: (w) => w.id,
    initialKey: "modified",
    initialDirection: "desc",
  });
  const open = (id: number) => navigate(`/sales/pricing/new-product/${id}`);

  return (
    <PricingPage wide>
      <PricingHeader
        title="New Product Pricing"
        subtitle="Price a product before it's in SAP — from its sub-assembly BOMs, with quantity breaks and revisions."
        actions={
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" /> New worksheet
          </button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-surface-2 p-1">
          {[ACTIVE, "Cancelled", ALL].map((pill) => (
            <button
              key={pill}
              onClick={() => setParam("status", pill === ACTIVE ? "" : pill)}
              aria-pressed={status === pill}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
                status === pill ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg",
              )}
            >
              {pill}
              <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-bold tabular-nums">{counts[pill]}</span>
            </button>
          ))}
        </div>
        <div className="min-w-[220px] flex-1">
          <SearchInput value={q} onChange={(v) => setParam("q", v)} placeholder="Worksheet #, product, customer…" />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {isLoading ? (
          <LoadingTasks noun="worksheets" />
        ) : error && isPermissionDenied(error) ? (
          <div className="p-4">
            <ListAccessNotice list="New Product Pricing" site="ALTRONICSALESTEAM" onRetry={() => void refetch()} />
          </div>
        ) : error ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">Couldn't load the worksheets.</p>
            <p className="mt-1">{error instanceof Error ? error.message : "Unknown error"}</p>
          </div>
        ) : worksheets.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">No worksheets yet — start one with New worksheet.</div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">No worksheets match.</div>
        ) : (
          <>
            <div className="divide-y divide-border sm:hidden">
              {table.rows.map((w) => (
                <button key={w.id} type="button" onClick={() => open(w.id)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-surface-2">
                  <span className="font-medium text-fg">
                    {w.worksheetNumber} <span className="text-xs text-fg-muted">R{w.rev}</span>
                  </span>
                  <span className="truncate text-sm text-fg">{w.productName}</span>
                  <span className="text-xs text-fg-muted">
                    {formatMoney(w.listPrice)} list · {formatPct(w.baseGM)} base GM
                  </span>
                </button>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    {WORKSHEET_COLUMNS.map((c) => (
                      <SortableHeader key={c.key} label={c.label} {...table.headerProps(c.key)} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((w) => (
                    <tr key={w.id} onClick={() => open(w.id)} className="cursor-pointer border-t border-border hover:bg-surface-2">
                      <td className="whitespace-nowrap px-4 py-2 font-medium">
                        <Link to={`/sales/pricing/new-product/${w.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-accent hover:underline">
                          {w.worksheetNumber}
                        </Link>
                        {w.status === "Cancelled" && <span className="ml-2 text-[10px] font-semibold text-fg-muted">CANCELLED</span>}
                      </td>
                      <td className="px-4 py-2 text-fg-muted">R{w.rev}</td>
                      <td className="max-w-88 truncate px-4 py-2 text-fg">{w.productName}</td>
                      <td className="max-w-56 truncate px-4 py-2 text-fg">{w.customerName || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums">{formatMoney(w.unitCost)}</td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums">{formatMoney(w.listPrice)}</td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums">{formatPct(w.baseGM)}</td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">{formatDisplayDate(modified(w)) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {showNew && <NewWorksheetFormModal onClose={() => setShowNew(false)} onSaved={open} />}
    </PricingPage>
  );
}
