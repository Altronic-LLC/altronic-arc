import { useMemo, useState } from "react";
import { Plus, Shapes } from "lucide-react";
import { useCreateLayoutComponent, useLayoutComponents } from "@/hooks/usePlantLayouts";
import { useMyPlantMapAccess } from "@/hooks/usePlantMapRoles";
import { manageSymbolsGate } from "@/lib/plantMapRoles";
import { sanitiseSvg, svgDataUrl } from "@/lib/plantSvg";
import { feetLabel } from "@/lib/plantGeometry";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import type { LayoutComponent } from "@/types/plant";
import { LAYOUT_COMPONENT_CATEGORIES } from "@/types/plant";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { SearchInput } from "@/components/SearchInput";
import { NewPlantSymbolModal } from "@/components/NewPlantSymbolModal";
import { PlantMapAccessGate, PlantMapNav } from "@/components/plantMapAtoms";

// =============================================================================
// Plant Map → Symbols (/operations/plant-map/symbols): the library a layout is
// built from, by category. Anyone who can open the Plant Map can look; a Plant
// Map admin adds symbols (NewPlantSymbolModal — SVG, DXF or a traced picture).
// Retired symbols are hidden unless asked for; nothing is edited or deleted
// here yet.
// =============================================================================

export function PlantSymbolsView() {
  return (
    <PlantMapAccessGate>
      <PlantSymbols />
    </PlantMapAccessGate>
  );
}

function PlantSymbols() {
  const { data: components = [], isLoading, error, refetch } = useLayoutComponents();
  const gate = manageSymbolsGate(useMyPlantMapAccess());
  const create = useCreateLayoutComponent();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [showRetired, setShowRetired] = useState(false);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return components.filter(
      (c) =>
        (showRetired || c.active) &&
        words.every((wd) => `${c.title} ${c.category} ${c.key}`.toLowerCase().includes(wd)),
    );
  }, [components, query, showRetired]);
  const groups = useMemo(() => {
    const order = [...LAYOUT_COMPONENT_CATEGORIES] as string[];
    // The usual categories in their usual order; one added in SharePoint after them.
    const rank = (cat: string) => (order.includes(cat) ? order.indexOf(cat) : order.length);
    const by = new Map<string, LayoutComponent[]>();
    for (const c of shown) by.set(c.category, [...(by.get(c.category) ?? []), c]);
    return [...by.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([cat, list]) => [cat, [...list].sort((a, b) => a.title.localeCompare(b.title))] as const);
  }, [shown]);
  const retired = components.filter((c) => !c.active).length;

  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <Shapes className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Symbols</h1>
            <p className="text-sm text-fg-muted">The machines, benches and racks a layout is built from, each at its real size.</p>
          </div>
        </div>
        {gate.allowed && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 self-start rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            Add symbol
          </button>
        )}
      </header>

      <PlantMapNav />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-sm">
          <SearchInput value={query} onChange={setQuery} placeholder="Search symbols" />
        </div>
        {retired > 0 && (
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
            Show {retired} retired
          </label>
        )}
      </div>

      {isLoading ? (
        <LoadingTasks noun="the symbol library" />
      ) : error && isPermissionDenied(error) ? (
        <ListAccessNotice list="Layout Components" site="Altronic_PMO" onRetry={() => void refetch()} />
      ) : error ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-fg-muted">
          <p className="font-medium text-fg">Couldn't load the symbol library.</p>
          <p className="mt-1">{error instanceof Error ? error.message : "Unknown error"}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
          >
            Try again
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-fg-muted">
          {components.length === 0 ? "The symbol library is empty." : "No symbols match."}
        </div>
      ) : (
        groups.map(([category, list]) => (
          <section key={category} aria-label={category} className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              {category} · {list.length}
            </h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {list.map((c) => (
                <SymbolCard key={c.id} component={c} />
              ))}
            </ul>
          </section>
        ))
      )}

      {adding && (
        <NewPlantSymbolModal
          takenKeys={components.map((c) => c.key)}
          busy={create.isPending}
          onClose={() => setAdding(false)}
          onCreate={async (input) => {
            await create.mutateAsync(input);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function SymbolCard({ component: c }: { component: LayoutComponent }) {
  const src = useMemo(() => {
    const clean = sanitiseSvg(c.svgMarkup);
    return clean ? svgDataUrl(clean) : null;
  }, [c.svgMarkup]);
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3" data-symbol={c.key}>
      <div className="flex h-28 items-center justify-center rounded-md bg-white p-2">
        {src ? (
          <img src={src} alt={c.title} className="max-h-full max-w-full" />
        ) : (
          <span className="text-xs text-gray-500">No drawing</span>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-fg" title={c.title}>
          {c.title}
        </p>
        <p className="text-xs text-fg-muted">
          {feetLabel(c.footprintW)} × {feetLabel(c.footprintD)}
        </p>
        <p className="mt-1 flex flex-wrap gap-1 text-[10px] font-medium">
          {!c.collides && <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-fg-muted">Floor marking</span>}
          {c.allowResize && <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-fg-muted">Resizable</span>}
          {!c.active && <span className="rounded-sm bg-cooper-red/10 px-1.5 py-0.5 text-cooper-red">Retired</span>}
        </p>
      </div>
    </li>
  );
}
