import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Map as MapIcon, Pencil, Send, Trash2 } from "lucide-react";
import {
  useCopyLayoutToDraft,
  useDeletePlantLayout,
  useLayoutComponentMap,
  usePlantLayout,
  usePlantLayouts,
  usePublishPlantLayout,
  useWallsDrawing,
} from "@/hooks/usePlantLayouts";
import { useMyPlantMapAccess } from "@/hooks/usePlantMapRoles";
import { deleteLayoutGate, editLayoutGate, publishLayoutGate } from "@/lib/plantMapRoles";
import { outdatedItems } from "@/lib/plantSymbolVersions";
import { layoutsSharingWalls } from "@/lib/plantLayoutDoc";
import { pushToast } from "@/components/Toast";
import type { PlantLayer, PlantLayout, PlantLayoutItem } from "@/types/plant";
import { layerLabel, layoutLayers } from "@/lib/plantLayers";
import { usePlantLayerVisibility } from "@/hooks/usePlantLayerVisibility";
import { PlantLayersPanel } from "@/components/PlantLayersPanel";
import {
  checkLayout,
  shapeOfComponent,
  describeLayoutProblem,
  feetLabel,
  itemsWithProblems,
  type LayoutProblem,
} from "@/lib/plantGeometry";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { dayLabel, type SortColumn } from "@/lib/tableSort";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SortableHeader } from "@/components/SortableTableHeader";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { PlantCanvas } from "@/components/PlantCanvas";
import { PlantCardTitle, PlantLayoutStatusChip, PlantMapAccessGate } from "@/components/plantMapAtoms";
import { cn } from "@/lib/cn";
import { RichTextWarningDialog } from "@/components/RichTextWarningDialog";

// =============================================================================
// One plant layout, drawn to scale — read-only (the editor is Phase 2).
//
// Beside the drawing: whether anything is placed where it can't go (overlaps,
// walls, columns, keep-outs, outside the building), checked against the walls
// drawing's own obstacles. A draft may have problems; Publish will refuse one
// that does. Below it: every placed item, sortable and filterable.
// =============================================================================

export function PlantLayoutView() {
  return (
    <PlantMapAccessGate>
      <PlantLayoutPage />
    </PlantMapAccessGate>
  );
}

function PlantLayoutPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const { data: layout, isLoading, error, refetch } = usePlantLayout(valid ? id : null);

  if (!valid) return <NotFound />;
  if (isLoading && !layout) return <LoadingTasks noun="the layout" />;
  if (error && !layout) {
    return (
      <Shell>
        {isPermissionDenied(error) ? (
          <ListAccessNotice list="Plant Layouts" site="Altronic_PMO" onRetry={() => void refetch()} />
        ) : (
          <p className="rounded-xl border border-border bg-surface p-6 text-sm text-fg-muted">
            Couldn't load the layout: {error instanceof Error ? error.message : "unknown error"}
          </p>
        )}
      </Shell>
    );
  }
  if (!layout) return <NotFound />;
  return <LayoutDetail layout={layout} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Plant Map" listTo="/operations/plant-map" />
      {children}
    </div>
  );
}

function NotFound() {
  return (
    <Shell>
      <p className="rounded-xl border border-border bg-surface p-6 text-sm text-fg-muted">That layout doesn't exist.</p>
    </Shell>
  );
}

function LayoutDetail({ layout }: { layout: PlantLayout }) {
  const walls = useWallsDrawing(layout.wallsFileId);
  const { byId, error: componentsError } = useLayoutComponentMap();
  const [selected, setSelected] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);

  const drawing = walls.data?.ok ? walls.data.drawing : null;
  // The drawing's size wins: it IS the building. The stored size is the fallback.
  const extent = drawing?.extent ?? layout.doc.extent;
  const items = layout.doc.items;
  const layers = useMemo(() => layoutLayers(layout.doc), [layout.doc]);
  const visibility = usePlantLayerVisibility(layers);
  const { isVisible, reveal } = visibility;
  const shownItems = useMemo(() => items.filter(isVisible), [items, isVisible]);
  // Picking an item from a list shows whatever layer hides it; hiding the
  // selected item's layer lets go of it.
  const pick = (uid: string | null) => {
    const item = uid ? items.find((i) => i.uid === uid) : undefined;
    if (item) reveal(item);
    setSelected(uid);
  };
  const selectedItem = items.find((i) => i.uid === selected) ?? null;
  useEffect(() => {
    if (selectedItem && !isVisible(selectedItem)) setSelected(null);
  }, [selectedItem, isVisible]);
  const labelOf = useMemo(() => {
    const labels = new Map(items.map((i) => [i.uid, i.label || "Unnamed item"]));
    return (uid: string) => labels.get(uid) ?? uid;
  }, [items]);

  const problems = useMemo<LayoutProblem[] | null>(() => {
    if (!drawing) return null;
    // The walls drawing's own keep-outs, plus the aisles and no-go areas drawn on the layout —
    // the same check Publish asks again before writing.
    return checkLayout(layout.doc, (cid) => shapeOfComponent(byId.get(cid)), drawing);
  }, [drawing, byId, layout.doc]);
  const problemUids = useMemo(() => (problems ? itemsWithProblems(problems) : new Set<string>()), [problems]);
  // Items on an older version of their symbol. Said only to editors — they're
  // the ones who can update them (in a draft; a published layout never changes).
  const canEdit = editLayoutGate(useMyPlantMapAccess()).allowed;
  const outdated = useMemo(() => outdatedItems(items, [...byId.values()]).length, [items, byId]);

  return (
    <Shell>
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <MapIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 font-display text-xl font-semibold text-fg sm:text-2xl">
              {layout.title || `Layout #${layout.id}`}
              <span className="text-base font-normal text-fg-muted">v{layout.version}</span>
              <PlantLayoutStatusChip status={layout.status} />
            </h1>
            <p className="text-sm text-fg-muted">
              {[
                layout.area,
                extent.w > 0 ? `${feetLabel(extent.w)} × ${feetLabel(extent.h)}` : "",
                `${items.length} item${items.length === 1 ? "" : "s"}`,
                layout.modifiedAt ? `updated ${dayLabel(layout.modifiedAt)}${layout.modifiedBy ? ` by ${layout.modifiedBy}` : ""}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 self-start">
          <label className="inline-flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
              className="h-3.5 w-3.5 accent-cooper-red"
            />
            Show labels
          </label>
          <PublishButton layout={layout} problems={problems} />
          <EditButton layout={layout} />
          <DeleteButton layout={layout} />
        </div>
      </header>

      {layout.docCorrupt && (
        <p role="alert" className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-sm text-fg">
          This layout's saved data couldn't be read, so no items are shown. ARC won't write over it — fix its LayoutJson in
          SharePoint, or ask whoever manages the Plant Map.
        </p>
      )}
      {walls.data && !walls.data.ok && (
        <p role="alert" className="rounded-lg border border-ajax-yellow/50 bg-ajax-yellow/15 p-3 text-sm text-fg">
          The walls drawing couldn't be used: {walls.data.problem} The items are drawn on a blank plan.
        </p>
      )}
      {walls.error && (
        <p role="alert" className="rounded-lg border border-ajax-yellow/50 bg-ajax-yellow/15 p-3 text-sm text-fg">
          Couldn't load the walls drawing: {walls.error instanceof Error ? walls.error.message : "unknown error"}. The items
          are drawn on a blank plan.
        </p>
      )}
      {canEdit && outdated > 0 && layout.status !== "Superseded" && !layout.docCorrupt && (
        <p role="status" className="rounded-lg border border-superior-blue/40 bg-superior-blue/10 p-3 text-sm text-fg">
          {outdated === 1 ? "1 item uses" : `${outdated} items use`} an older version of its symbol.{" "}
          {layout.status === "Draft"
            ? "Open the editor and press Update symbols."
            : "This published version keeps it as it is — Edit makes a new draft, where Update symbols moves it to the latest."}
        </p>
      )}
      {componentsError ? (
        <p role="alert" className="rounded-lg border border-ajax-yellow/50 bg-ajax-yellow/15 p-3 text-sm text-fg">
          Couldn't load the symbol library, so items are drawn as outlines.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 rounded-xl border border-border bg-surface p-3">
          {walls.isLoading ? (
            <LoadingTasks noun="the walls drawing" />
          ) : (
            <PlantCanvas
              title={`${layout.title} plant layout`}
              extent={extent}
              wallsSvg={drawing?.svg ?? null}
              items={shownItems}
              areas={layout.doc.areas ?? []}
              components={byId}
              problemUids={problemUids}
              selectedUid={selected}
              onSelect={pick}
              showLabels={showLabels}
              height="65vh"
            />
          )}
        </section>
        <aside className="flex flex-col gap-4">
          <ProblemsCard problems={problems} labelOf={labelOf} status={layout.status} onPick={pick} />
          <SelectedCard item={selectedItem} layers={layers} componentTitle={(cid) => byId.get(cid)?.title} />
          <PlantLayersPanel
            layers={layers}
            items={items}
            hidden={visibility.hidden}
            onLayer={visibility.setLayer}
            onGroup={visibility.setGroup}
          />
        </aside>
      </div>

      <ItemsTable
        items={items}
        layers={layers}
        componentTitle={(cid) => byId.get(cid)?.title ?? `Component #${cid}`}
        problemUids={problemUids}
        selected={selected}
        onPick={pick}
      />
    </Shell>
  );
}

/**
 * Publish — a Plant Map admin, on a draft. Greyed with the reason (never
 * `disabled`, so the reason is reachable) while the check is still running or
 * finds problems; asks first, since a published layout can't be changed.
 */
function PublishButton({ layout, problems }: { layout: PlantLayout; problems: LayoutProblem[] | null }) {
  const gate = publishLayoutGate(useMyPlantMapAccess());
  const publish = usePublishPlantLayout();
  const { data: all = [] } = usePlantLayouts();
  const [asking, setAsking] = useState(false);
  if (!gate.allowed || layout.status !== "Draft" || layout.docCorrupt) return null;
  const blocked =
    problems === null
      ? "Checking the layout…"
      : problems.length > 0
        ? `Fix the ${problems.length} placement problem${problems.length === 1 ? "" : "s"} first.`
        : null;
  const current = all.find((l) => l.status === "Published" && !!layout.layoutKey && l.layoutKey === layout.layoutKey);
  return (
    <>
      <button
        type="button"
        aria-disabled={!!blocked || publish.isPending}
        title={blocked ?? "Publish this draft"}
        onClick={() => !blocked && !publish.isPending && setAsking(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-cooper-green px-3 py-1.5 text-sm font-medium text-cooper-green hover:bg-cooper-green/10",
          (blocked || publish.isPending) && "cursor-not-allowed opacity-50 hover:bg-transparent",
        )}
      >
        <Send className="h-4 w-4" />
        {publish.isPending ? "Publishing…" : "Publish"}
      </button>
      {asking && (
        <RichTextWarningDialog
          title={`Publish ${layout.title} v${layout.version}?`}
          detail="It becomes the layout everyone on the Plant Map sees. A published layout can't be changed — later changes go in a new draft."
          notifyNote={
            current
              ? `v${current.version}, published now, will be marked Superseded.`
              : "It's the first published version of this layout."
          }
          trailing="Nobody is emailed."
          confirmLabel="Publish"
          cancelLabel="Not yet"
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            publish.mutate(layout.id);
          }}
        />
      )}
    </>
  );
}

/**
 * Edit layout — a draft opens in the editor; a published layout gets a NEW
 * draft first (or the one that already exists), because a published row is
 * never changed. Hidden from anyone who can't edit; Superseded can't be edited.
 */
function EditButton({ layout }: { layout: PlantLayout }) {
  const navigate = useNavigate();
  const gate = editLayoutGate(useMyPlantMapAccess());
  const copy = useCopyLayoutToDraft();
  const { data: all = [] } = usePlantLayouts();
  if (!gate.allowed || layout.status === "Superseded" || layout.docCorrupt) return null;
  const draft =
    layout.status === "Draft"
      ? layout
      : all.find((l) => l.status === "Draft" && !!layout.layoutKey && l.layoutKey === layout.layoutKey);
  const label = layout.status === "Draft" ? "Edit layout" : draft ? `Edit the draft (v${draft.version})` : "Edit as a new draft";
  return (
    <button
      type="button"
      disabled={copy.isPending}
      onClick={async () => {
        if (draft) return navigate(`/operations/plant-map/${draft.id}/edit`);
        const result = await copy.mutateAsync(layout.id).catch(() => null);
        if (!result) return;
        if (result.existing) pushToast({ message: `Opened the draft that already exists (v${result.layout.version}).` });
        navigate(`/operations/plant-map/${result.layout.id}/edit`);
      }}
      className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs hover:bg-accent/90 disabled:opacity-50"
    >
      <Pencil className="h-4 w-4" />
      {copy.isPending ? "Starting a draft…" : label}
    </button>
  );
}

/**
 * Delete — a Plant Map admin, on a Draft or Superseded version (never the
 * Published one). Hidden from everyone else. The dialog says what happens to
 * the walls drawing: it goes too, or it's kept because other layouts use it.
 * The API checks that again, fresh, before deleting the file.
 */
function DeleteButton({ layout }: { layout: PlantLayout }) {
  const navigate = useNavigate();
  const gate = deleteLayoutGate(useMyPlantMapAccess());
  const remove = useDeletePlantLayout();
  const { data: all } = usePlantLayouts();
  const [asking, setAsking] = useState(false);
  if (!gate.allowed || layout.status === "Published") return null;
  const name = `${layout.title || `Layout #${layout.id}`} v${layout.version}`;
  const sharing = all ? layoutsSharingWalls(all, layout.wallsFileId, layout.id) : null;
  const wallsNote = !layout.wallsFileId
    ? "It has no walls drawing."
    : sharing === null
      ? "Its walls drawing is deleted too, unless another layout still uses it."
      : sharing.length === 0
        ? "Its walls drawing is deleted too — no other layout uses it."
        : `Its walls drawing is kept, because ${sharing
            .map((l) => `${l.title || `Layout #${l.id}`} v${l.version} (${l.status})`)
            .join(", ")} still ${sharing.length === 1 ? "uses" : "use"} it.`;
  return (
    <>
      <button
        type="button"
        disabled={remove.isPending}
        onClick={() => setAsking(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-cooper-red px-3 py-1.5 text-sm font-medium text-cooper-red hover:bg-cooper-red/10 disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
        {remove.isPending ? "Deleting…" : "Delete"}
      </button>
      {asking && (
        <RichTextWarningDialog
          title={`Delete ${name}?`}
          detail={`This ${layout.status.toLowerCase()} version goes to the SharePoint recycle bin on Altronic_PMO, where it can be restored for 93 days.`}
          notifyNote={wallsNote}
          trailing="Nobody is emailed."
          confirmLabel="Delete"
          cancelLabel="Keep it"
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            remove.mutate(layout.id, { onSuccess: () => navigate("/operations/plant-map") });
          }}
        />
      )}
    </>
  );
}

function ProblemsCard({
  problems,
  labelOf,
  status,
  onPick,
}: {
  problems: LayoutProblem[] | null;
  labelOf: (uid: string) => string;
  status: PlantLayout["status"];
  onPick: (uid: string) => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-label="Placement check">
      <PlantCardTitle>Placement check</PlantCardTitle>
      {problems === null ? (
        <p className="mt-2 text-sm text-fg-muted">Needs the walls drawing to check.</p>
      ) : problems.length === 0 ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-cooper-green">
          <CheckCircle2 className="h-4 w-4" />
          Nothing overlaps, and everything is inside the building.
        </p>
      ) : (
        <>
          <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-cooper-red">
            <AlertTriangle className="h-4 w-4" />
            {problems.length} problem{problems.length === 1 ? "" : "s"}
          </p>
          {status === "Draft" && (
            <p className="mt-1 text-xs text-fg-muted">A draft can be saved like this; it can't be published until they're fixed.</p>
          )}
          <ul className="mt-2 space-y-1 text-sm">
            {problems.map((p, i) => (
              <li key={i}>
                <button type="button" onClick={() => onPick(p.uid)} className="text-left text-fg hover:text-accent hover:underline">
                  {describeLayoutProblem(p, labelOf)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function SelectedCard({
  item,
  layers,
  componentTitle,
}: {
  item: PlantLayoutItem | null;
  layers: readonly PlantLayer[];
  componentTitle: (componentId: number) => string | undefined;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-label="Selected item">
      <PlantCardTitle>Selected</PlantCardTitle>
      {!item ? (
        <p className="mt-2 text-sm text-fg-muted">Click an item on the plan, or in the list below.</p>
      ) : (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-fg-muted">Label</dt>
          <dd className="text-fg">{item.label || "—"}</dd>
          <dt className="text-fg-muted">Symbol</dt>
          <dd className="text-fg">{componentTitle(item.componentId) ?? `Component #${item.componentId}`}</dd>
          <dt className="text-fg-muted">Size</dt>
          <dd className="text-fg">
            {feetLabel(item.w)} × {feetLabel(item.d)}
          </dd>
          <dt className="text-fg-muted">Rotation</dt>
          <dd className="text-fg">{item.rot}°</dd>
          {item.layer && (
            <>
              <dt className="text-fg-muted">Layer</dt>
              <dd className="text-fg">{layerLabel(item, layers)}</dd>
            </>
          )}
          <dt className="text-fg-muted">Centre</dt>
          <dd className="text-fg">
            {feetLabel(item.x)} from the west wall, {feetLabel(item.y)} from the north
          </dd>
        </dl>
      )}
    </section>
  );
}

function ItemsTable({
  items,
  layers,
  componentTitle,
  problemUids,
  selected,
  onPick,
}: {
  items: readonly PlantLayoutItem[];
  layers: readonly PlantLayer[];
  componentTitle: (componentId: number) => string;
  problemUids: ReadonlySet<string>;
  selected: string | null;
  onPick: (uid: string) => void;
}) {
  const columns = useMemo<SortColumn<PlantLayoutItem & { n: number }>[]>(
    () => [
      { key: "label", label: "Label", value: (i) => i.label },
      { key: "symbol", label: "Symbol", value: (i) => componentTitle(i.componentId) },
      ...(layers.length > 0
        ? [{ key: "layer", label: "Layer", value: (i: PlantLayoutItem) => layerLabel(i, layers) || "Base plan" }]
        : []),
      { key: "size", label: "Size", value: (i) => `${feetLabel(i.w)} × ${feetLabel(i.d)}`, noFilter: true },
      { key: "rot", label: "Rotation", kind: "number", value: (i) => `${i.rot}°`, sortValue: (i) => i.rot },
      { key: "check", label: "Check", value: (i) => (problemUids.has(i.uid) ? "Problem" : "OK") },
    ],
    [componentTitle, problemUids, layers],
  );
  const rows = useMemo(() => items.map((it, n) => ({ ...it, n })), [items]);
  const table = useSortableTable({ rows, columns, stableKey: (i) => -i.n, initialKey: "label" });

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface" aria-label="Items on this layout">
      <div className="border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">
        {items.length} item{items.length === 1 ? "" : "s"} on this layout
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-fg-muted">Nothing has been placed yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                {columns.map((c) => (
                  <SortableHeader key={c.key} label={c.label} {...table.headerProps(c.key)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((it) => (
                <tr
                  key={it.uid}
                  onClick={() => onPick(it.uid)}
                  aria-selected={selected === it.uid}
                  className={cn(
                    "cursor-pointer border-t border-border transition-colors hover:bg-surface-2",
                    selected === it.uid && "bg-superior-blue/10",
                  )}
                >
                  <td className="px-4 py-2 font-medium text-fg">{it.label || "—"}</td>
                  <td className="px-4 py-2 text-fg-muted">{componentTitle(it.componentId)}</td>
                  {layers.length > 0 && <td className="px-4 py-2 text-fg-muted">{layerLabel(it, layers) || "Base plan"}</td>}
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">
                    {feetLabel(it.w)} × {feetLabel(it.d)}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-fg-muted">{it.rot}°</td>
                  <td className="px-4 py-2">
                    {problemUids.has(it.uid) ? (
                      <span className="inline-flex items-center gap-1 text-cooper-red">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Problem
                      </span>
                    ) : (
                      <span className="text-fg-muted">OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
