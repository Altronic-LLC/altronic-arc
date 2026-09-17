import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileCheck } from "lucide-react";
import { QC_FORMS } from "@/lib/qcForms";
import { matchesTokens } from "@/lib/itemSearch";
import { SearchInput } from "@/components/SearchInput";

// =============================================================================
// QC Forms landing page — a search box over a grid of buttons, one per
// digitized paper QC/test form (`lib/qcForms.ts`). Picking one navigates to
// that form's own screen.
//
// This is the FIRST QC Forms screen; only QCFRM-012 (CPU-95) exists so far.
// The grid/search shape is built to hold many more without changing this
// file — a new form is one entry in the registry.
// =============================================================================

export function QcFormsView() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () =>
      QC_FORMS.filter(
        (form) =>
          matchesTokens(form.name, query) ||
          matchesTokens(form.formNumber, query) ||
          matchesTokens(form.description, query),
      ),
    [query],
  );

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
          <FileCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">QC Forms</h1>
          <p className="text-sm text-fg-muted">
            Digitized paper QC and test forms. Pick one to search or add a test sheet.
          </p>
        </div>
      </header>

      <SearchInput value={query} onChange={setQuery} placeholder="Search forms by name or number…" />

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-fg-muted">
          No forms match that search.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((form) => (
            <button
              key={form.id}
              type="button"
              onClick={() => navigate(form.to)}
              className="flex flex-col items-start gap-1.5 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-accent hover:bg-surface-2"
            >
              <span className="font-display text-xs font-semibold uppercase tracking-wider text-fg-muted">
                {form.formNumber}
              </span>
              <span className="text-sm font-medium text-fg">{form.name}</span>
              <span className="text-xs text-fg-muted">{form.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
