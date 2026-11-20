import { useEffect, useRef, useState } from "react";
import type { SapCustomer } from "@/types/pricing";
import { needsSapSignIn, SAP_CUSTOMER_LOOKUP_CONNECTED, warmSapCostLookup } from "@/api/pricingLookup";
import { signInToFabric } from "@/api/fabric";
import { useSapCustomerSearch } from "@/hooks/usePricingLookup";

// =============================================================================
// The customer — ALWAYS three fields (Ray, 2026-10-17): Sold-to #, Customer
// name and Customer group, mapped to SAP's CUSTOMER, CUSTOMER_NAME and
// CUSTOMER_GROUP (`vw_sales_customer`). Typing in Sold-to # searches by number
// and typing in Customer name searches by name, as they type; picking a match
// fills all three. The group is SAP's — read-only while SAP can be asked. When
// it can't (not connected, or refused for this account) the three are simply
// typed, and the reason is shown. Shared by the request form, the worksheet
// form and the customer quote.
// =============================================================================

/** How long typing pauses before the search goes — short, so it feels live. */
const SEARCH_DEBOUNCE_MS = 250;

const EMPTY: SapCustomer = { soldTo: "", name: "", customerGroup: "" };

export function SapCustomerPicker({
  value,
  onChange,
}: {
  value: SapCustomer | null;
  onChange: (next: SapCustomer | null) => void;
}) {
  const v = value ?? EMPTY;
  const [by, setBy] = useState<"number" | "name" | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);
  // Wake Fabric while the person is still reading the form.
  useEffect(() => {
    void warmSapCostLookup();
  }, []);

  const search = useSapCustomerSearch(by ? debounced : "", by ?? "name");
  const signInNeeded = search.isError && needsSapSignIn(search.error);
  const failed = search.isError && !search.notConnected && !signInNeeded;
  const canSearch = SAP_CUSTOMER_LOOKUP_CONNECTED && !search.notConnected && !failed;
  const [signingIn, setSigningIn] = useState(false);

  function set(patch: Partial<SapCustomer>) {
    const next = { ...v, ...patch };
    onChange(next.name.trim() || next.soldTo.trim() ? next : null);
  }

  function typeInto(field: "soldTo" | "name", text: string) {
    // A typed change is no longer the SAP customer that was picked: its group
    // goes with it (while SAP can be asked), so a stale group can't price it.
    set(canSearch ? { [field]: text, customerGroup: "", customerGroupLabel: undefined } : { [field]: text });
    setBy(field === "soldTo" ? "number" : "name");
    setQuery(text);
  }

  function pick(c: SapCustomer) {
    onChange({ ...c });
    setBy(null);
    setQuery("");
  }

  async function signIn() {
    setSigningIn(true);
    try {
      await signInToFabric();
      await search.refetch();
    } finally {
      setSigningIn(false);
    }
  }

  const open = canSearch && by !== null && debounced.trim().length >= 2;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <SearchBox
          label="Sold-to number"
          placeholder="Sold-to #"
          value={v.soldTo}
          onType={(t) => typeInto("soldTo", t)}
          onBlur={() => setBy((b) => (b === "number" ? null : b))}
          showing={open && by === "number"}
          search={search}
          onPick={pick}
          mono
        />
        <div className="sm:col-span-2">
          <SearchBox
            label="Customer name"
            placeholder="Customer name"
            value={v.name}
            onType={(t) => typeInto("name", t)}
            onBlur={() => setBy((b) => (b === "name" ? null : b))}
            showing={open && by === "name"}
            search={search}
            onPick={pick}
          />
        </div>
      </div>
      <input
        aria-label="Customer group"
        placeholder={canSearch ? "Customer group — from SAP" : "Customer group (decides their discount)"}
        value={canSearch ? v.customerGroupLabel || v.customerGroup : v.customerGroup}
        onChange={(e) => set({ customerGroup: e.target.value, customerGroupLabel: undefined })}
        readOnly={canSearch}
        className="input read-only:bg-surface-2/50 read-only:text-fg-muted"
      />
      {canSearch && value && !v.customerGroup && v.soldTo.trim() && v.name.trim() && (
        <p className="text-[11px] text-fg-muted">No customer group in SAP — the standard discount applies.</p>
      )}
      {signInNeeded && (
        <p className="text-[11px] text-fg-muted">
          Sign in to SAP to search customers —{" "}
          <button type="button" onClick={() => void signIn()} disabled={signingIn} className="font-semibold text-accent hover:underline">
            {signingIn ? "signing in…" : "Sign in to SAP"}
          </button>
        </p>
      )}
      {failed && (
        <p role="alert" className="rounded-md border border-ajax-yellow/40 bg-ajax-yellow/10 px-2 py-1.5 text-[11px] text-fg">
          Couldn't search SAP customers — type the customer in. <span className="text-fg-muted">({errorText(search.error)})</span>
        </p>
      )}
      {!SAP_CUSTOMER_LOOKUP_CONNECTED && (
        <p className="text-[11px] text-fg-muted">SAP customer lookup isn't connected yet — type the customer in.</p>
      )}
    </div>
  );
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function SearchBox({
  label,
  placeholder,
  value,
  onType,
  onBlur,
  showing,
  search,
  onPick,
  mono,
}: {
  label: string;
  placeholder: string;
  value: string;
  onType: (text: string) => void;
  onBlur: () => void;
  showing: boolean;
  search: { data?: SapCustomer[]; isFetching: boolean; isLoading: boolean };
  onPick: (c: SapCustomer) => void;
  mono?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={box}
      className="relative"
      // Leaving the field (not moving into its own list) closes the list.
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node | null)) onBlur();
      }}
    >
      <input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onType(e.target.value)}
        autoComplete="off"
        className={mono ? "input font-mono" : "input"}
      />
      {showing && (
        <ul
          role="listbox"
          aria-label={`${label} matches`}
          className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-surface shadow-lg sm:min-w-88"
        >
          {search.isLoading && !search.data && <li className="px-3 py-2 text-xs text-fg-muted">Searching…</li>}
          {search.data?.length === 0 && !search.isFetching && <li className="px-3 py-2 text-xs text-fg-muted">No SAP customer matches.</li>}
          {search.data?.map((c) => (
            <li key={c.soldTo}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(c)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2"
              >
                <span className="min-w-0 truncate text-fg">{c.name}</span>
                <span className="shrink-0 font-mono text-xs text-fg-muted">
                  {c.soldTo}
                  {c.customerGroup && <span className="ml-2 font-sans">{c.customerGroup}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
