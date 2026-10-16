import { useState } from "react";
import type { SapCustomer } from "@/types/pricing";
import { SAP_DATA_CONNECTED } from "@/api/pricingLookup";
import { useSapCustomerSearch } from "@/hooks/usePricingLookup";

// =============================================================================
// Pick a customer from SAP — sold-to, name and customer group (the group is
// what decides their discount). While SAP data isn't connected it says so and
// the three are typed instead, so nothing that needs a customer is blocked.
// Shared by the request form, the worksheet form and the customer quote.
// =============================================================================

export function SapCustomerPicker({
  value,
  onChange,
}: {
  value: SapCustomer | null;
  onChange: (next: SapCustomer | null) => void;
}) {
  const [query, setQuery] = useState("");
  const search = useSapCustomerSearch(value ? "" : query);
  const typing = !SAP_DATA_CONNECTED || search.notConnected;

  if (typing) {
    const v = value ?? { soldTo: "", name: "", customerGroup: "" };
    const set = (patch: Partial<SapCustomer>) => {
      const next = { ...v, ...patch };
      onChange(next.name.trim() || next.soldTo.trim() ? next : null);
    };
    return (
      <div className="flex flex-col gap-2">
        <p className="rounded-md border border-ajax-yellow/40 bg-ajax-yellow/10 px-2 py-1.5 text-[11px] text-fg">
          SAP customer lookup isn't connected yet — type the customer in.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input aria-label="Sold-to number" placeholder="Sold-to #" value={v.soldTo} onChange={(e) => set({ soldTo: e.target.value })} className="input" />
          <input aria-label="Customer name" placeholder="Customer name" value={v.name} onChange={(e) => set({ name: e.target.value })} className="input sm:col-span-2" />
        </div>
        <input
          aria-label="Customer group"
          placeholder="Customer group (decides their discount)"
          value={v.customerGroup}
          onChange={(e) => set({ customerGroup: e.target.value })}
          className="input"
        />
      </div>
    );
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2/50 px-3 py-2 text-sm">
        <span className="min-w-0">
          <span className="font-medium text-fg">{value.name}</span>
          <span className="ml-2 font-mono text-xs text-fg-muted">{value.soldTo}</span>
          <span className="ml-2 text-xs text-fg-muted">group {value.customerGroup || "—"}</span>
        </span>
        <button type="button" onClick={() => onChange(null)} className="text-xs text-accent hover:underline">
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        aria-label="Search SAP customers"
        placeholder="Search SAP customers by name or sold-to #…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="input"
      />
      {query.trim().length >= 2 && (
        <ul className="max-h-48 overflow-y-auto rounded-md border border-border" role="listbox" aria-label="SAP customers">
          {search.isLoading && <li className="px-3 py-2 text-xs text-fg-muted">Searching…</li>}
          {search.data?.length === 0 && <li className="px-3 py-2 text-xs text-fg-muted">No SAP customer matches.</li>}
          {search.data?.map((c) => (
            <li key={c.soldTo}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => onChange(c)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
              >
                <span className="text-fg">{c.name}</span>
                <span className="font-mono text-xs text-fg-muted">{c.soldTo}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
