import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  copyLayoutToDraft,
  createPlantLayout,
  deletePlantLayout,
  getPlantLayout,
  listPlantLayouts,
  publishPlantLayout,
  savePlantLayoutDraft,
} from "@/api/plantLayouts";
import { createLayoutComponent, listLayoutComponents, replaceLayoutComponent } from "@/api/layoutComponents";
import {
  findPublishedFiles,
  readPublishedFile,
  readWallsFile,
  writePublishedFile,
  type PublishedFile,
} from "@/api/plantLayoutFiles";
import { listEquipment } from "@/api/operationsEquipment";
import { EQUIPMENT_KEY } from "./useEquipment";
import type { Equipment } from "@/types/task";
import type {
  LayoutComponent,
  NewLayoutComponentInput,
  NewPlantLayoutInput,
  PlantLayout,
  PlantLayoutDoc,
  ReplaceLayoutComponentInput,
} from "@/types/plant";
import { readWallsSvg, type WallsCheck } from "@/lib/plantSvg";
import { buildCompositeSvg, buildTagsCsv, publishedFileNames, type PublishAsset } from "@/lib/plantPublishFiles";
import { deleteLayoutGate, editLayoutGate, manageSymbolsGate, publishLayoutGate } from "@/lib/plantMapRoles";
import { checkLayout, shapeOfComponent } from "@/lib/plantGeometry";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { requirePlantMapGate, useResolvePlantMapAccess } from "./usePlantMapRoles";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Plant layouts, the symbol library and the walls drawings, as queries — plus
// starting a layout, gated inside its mutationFn.
//
// The walls drawing is read and SANITISED once per file id and cached for the
// session (it doesn't change under a layout: a new drawing is a new file).
// =============================================================================

export const PLANT_LAYOUTS_KEY = ["plant-layouts", "list"] as const;
export const LAYOUT_COMPONENTS_KEY = ["layout-components", "list"] as const;
export const plantLayoutKey = (id: number) => ["plant-layouts", "one", id] as const;
export const wallsKey = (fileId: string) => ["plant-walls", fileId] as const;

export function usePlantLayouts() {
  return useQuery<PlantLayout[]>({ queryKey: PLANT_LAYOUTS_KEY, queryFn: listPlantLayouts, staleTime: 60_000 });
}

/** One layout, fresh — the list's copy is shown first if it's cached. */
export function usePlantLayout(id: number | null) {
  const qc = useQueryClient();
  return useQuery<PlantLayout | null>({
    queryKey: plantLayoutKey(id ?? 0),
    queryFn: () => getPlantLayout(id as number),
    enabled: id !== null,
    staleTime: 30_000,
    placeholderData: () => qc.getQueryData<PlantLayout[]>(PLANT_LAYOUTS_KEY)?.find((l) => l.id === id),
  });
}

export function useLayoutComponents() {
  return useQuery<LayoutComponent[]>({
    queryKey: LAYOUT_COMPONENTS_KEY,
    queryFn: listLayoutComponents,
    staleTime: 10 * 60_000,
  });
}

type QC = ReturnType<typeof useQueryClient>;

/** The symbol library, read fresh — what Publish checks against and draws with. */
function freshComponents(qc: QC): Promise<LayoutComponent[]> {
  return qc.fetchQuery({ queryKey: LAYOUT_COMPONENTS_KEY, queryFn: listLayoutComponents });
}

/** A layout's walls drawing, read once per file id for the session (a new drawing is a new file). */
function wallsFor(qc: QC, layout: PlantLayout): Promise<WallsCheck | null> {
  if (!layout.wallsFileId) return Promise.resolve(null);
  return qc.fetchQuery({
    queryKey: wallsKey(layout.wallsFileId),
    queryFn: async () => readWallsSvg(await readWallsFile(layout.wallsFileId)),
    staleTime: Infinity,
  });
}

export const publishedFilesKey = (layoutId: number, version: number) => ["plant-published-files", layoutId, version] as const;

/**
 * Build and write a published layout's files for Power BI
 * (lib/plantPublishFiles.ts): the composite SVG and the tags CSV for its
 * version, and — when it IS the published version — the "current" copies a
 * report points at. Throws if the files can't be built or written; the asset
 * names are best-effort (a refused Equipment List leaves AssetTag blank and
 * says so in `warnings`).
 */
async function writeLayoutFiles(qc: QC, layout: PlantLayout): Promise<{ written: string[]; warnings: string[] }> {
  if (layout.docCorrupt) throw new Error("The saved layout couldn't be read, so its files can't be made.");
  const warnings: string[] = [];
  const [components, walls] = await Promise.all([freshComponents(qc), wallsFor(qc, layout)]);
  if (walls && !walls.ok) warnings.push(`The walls drawing couldn't be used (${walls.problem}), so the plan in the file is blank.`);
  const assets = new Map<number, PublishAsset>();
  if (layout.doc.items.some((i) => i.equipmentId !== null)) {
    try {
      const equipment = await qc.fetchQuery<Equipment[]>({ queryKey: EQUIPMENT_KEY, queryFn: listEquipment, staleTime: 5 * 60_000 });
      for (const e of equipment) assets.set(e.lookupId, { name: e.name, assetTag: e.assetTag });
    } catch {
      warnings.push("The Equipment List couldn't be read, so the asset tags and names in the tags file are blank.");
    }
  }
  const drawing = walls?.ok ? walls.drawing : null;
  const byId = new Map(components.map((c) => [c.id, c]));
  const svg = buildCompositeSvg({
    layout,
    wallsSvg: drawing?.svg ?? null,
    extent: drawing?.extent ?? layout.doc.extent,
    components: byId,
    assets,
    publishedAt: new Date(),
  });
  const csv = buildTagsCsv({ layout, components: byId, assets });
  const names = publishedFileNames(layout);
  const writes: [string, string, string][] = [
    [names.svg, svg, "image/svg+xml"],
    [names.csv, csv, "text/csv"],
  ];
  if (layout.status === "Published") {
    writes.push([names.currentSvg, svg, "image/svg+xml"], [names.currentCsv, csv, "text/csv"]);
  }
  // One at a time: four small files, and a refusal on the first says it all.
  for (const [name, content, type] of writes) await writePublishedFile(name, content, type);
  void qc.invalidateQueries({ queryKey: publishedFilesKey(layout.id, layout.version) });
  return { written: writes.map(([n]) => n), warnings };
}

/** The Power BI files a layout version has — versioned always, the current copies when it's Published. */
export function usePublishedFiles(layout: PlantLayout | null | undefined) {
  return useQuery<Record<string, PublishedFile>>({
    queryKey: publishedFilesKey(layout?.id ?? 0, layout?.version ?? 0),
    queryFn: () => {
      const names = publishedFileNames(layout as PlantLayout);
      return findPublishedFiles(
        layout?.status === "Published" ? [names.svg, names.csv, names.currentSvg, names.currentCsv] : [names.svg, names.csv],
      );
    },
    enabled: !!layout && layout.status !== "Draft",
    staleTime: 60_000,
  });
}

/** Download one published file — through its pre-authenticated link, saved from a blob URL. */
export async function downloadPublishedFile(name: string): Promise<void> {
  const text = await readPublishedFile(name);
  const type = name.endsWith(".csv") ? "text/csv" : "image/svg+xml";
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Not revoked at once: some browsers start the save asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * (Re)make a published layout's files — a Plant Map admin, asked inside the
 * mutationFn. The way back from a publish whose files failed, and how a layout
 * published before this existed gets them. Never touches the layout row.
 */
export function useWritePublishedFiles() {
  const qc = useQueryClient();
  const resolve = useResolvePlantMapAccess();
  return useMutation({
    mutationFn: async (id: number) => {
      requirePlantMapGate(publishLayoutGate(await resolve()));
      const layout = await getPlantLayout(id);
      if (!layout) throw new Error("That layout has been deleted.");
      if (layout.status !== "Published") throw new Error("Only the published version gets files for Power BI.");
      return writeLayoutFiles(qc, layout);
    },
    onSuccess: ({ warnings }) => {
      pushToast({ message: "The files for Power BI were saved." });
      for (const w of warnings) pushToast({ message: w, variant: "error" });
    },
    onError: (err) =>
      pushToast({
        message: describeListWriteFailure(err, { action: "save the layout's files", site: "Altronic_PMO", permission: "editing" }),
        variant: "error",
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["plant-published-files"] }),
  });
}

/**
 * Publish a draft — a Plant Map admin, asked inside the mutationFn, and ONLY
 * if the placement check passes, asked again here on a fresh read of the
 * layout, the walls drawing and the symbol library (a page open for an hour
 * mustn't publish what it showed then). The API flips the old version to
 * Superseded. Then the files for Power BI are written — AFTER the layout is
 * published, so a failure there is a warning with a retry button, never an
 * unpublished layout.
 */
export function usePublishPlantLayout() {
  const qc = useQueryClient();
  const resolve = useResolvePlantMapAccess();
  return useMutation({
    mutationFn: async (id: number) => {
      requirePlantMapGate(publishLayoutGate(await resolve()));
      const layout = await getPlantLayout(id);
      if (!layout) throw new Error("That layout has been deleted.");
      const [components, walls] = await Promise.all([freshComponents(qc), wallsFor(qc, layout)]);
      if (walls && !walls.ok) {
        throw new Error(`The walls drawing can't be read (${walls.problem}), so the layout can't be checked or published.`);
      }
      const byId = new Map(components.map((c) => [c.id, c]));
      const problems = checkLayout(layout.doc, (cid) => shapeOfComponent(byId.get(cid)), walls?.ok ? walls.drawing : null);
      if (problems.length > 0) {
        throw new Error(
          `Fix the ${problems.length} placement problem${problems.length === 1 ? "" : "s"} first — a layout with problems can't be published.`,
        );
      }
      const result = await publishPlantLayout(id);
      try {
        const files = await writeLayoutFiles(qc, result.layout);
        return { ...result, warnings: [...result.warnings, ...files.warnings] };
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        return {
          ...result,
          warnings: [
            ...result.warnings,
            `Published, but the files for Power BI couldn't be saved (${why}). Press Save files for Power BI on the layout to try again.`,
          ],
        };
      }
    },
    onSuccess: ({ layout, superseded, warnings }) => {
      storeLayout(qc, layout);
      for (const old of superseded) storeLayout(qc, old);
      const was = superseded.map((l) => `v${l.version}`).join(", ");
      pushToast({ message: `Published v${layout.version}.${was ? ` ${was} is now Superseded.` : ""}` });
      for (const w of warnings) pushToast({ message: w, variant: "error" });
    },
    onError: (err) =>
      pushToast({
        message: describeListWriteFailure(err, { action: "publish the layout", site: "Altronic_PMO", permission: "editing" }),
        variant: "error",
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: PLANT_LAYOUTS_KEY }),
  });
}

/** Add a symbol to the library — a Plant Map admin, asked inside the mutationFn. */
export function useCreateLayoutComponent() {
  const qc = useQueryClient();
  const resolve = useResolvePlantMapAccess();
  return useMutation({
    mutationFn: async (input: NewLayoutComponentInput) => {
      requirePlantMapGate(manageSymbolsGate(await resolve()));
      return createLayoutComponent(input);
    },
    onSuccess: (created) => {
      qc.setQueryData<LayoutComponent[]>(LAYOUT_COMPONENTS_KEY, (old) => (old ? [...old, created] : [created]));
      pushToast({ message: `${created.title} added to the symbol library.` });
    },
    // No error toast: the form stays open and says what went wrong.
    onSettled: () => qc.invalidateQueries({ queryKey: LAYOUT_COMPONENTS_KEY }),
  });
}

/**
 * Replace a symbol with its next version — a Plant Map admin, asked inside the
 * mutationFn. A new row is added; layouts keep the version they use until
 * somebody updates them in a draft.
 */
export function useReplaceLayoutComponent() {
  const qc = useQueryClient();
  const resolve = useResolvePlantMapAccess();
  return useMutation({
    mutationFn: async ({ previous, input }: { previous: LayoutComponent; input: ReplaceLayoutComponentInput }) => {
      requirePlantMapGate(manageSymbolsGate(await resolve()));
      return replaceLayoutComponent(previous, input);
    },
    onSuccess: (created) => {
      qc.setQueryData<LayoutComponent[]>(LAYOUT_COMPONENTS_KEY, (old) => (old ? [...old, created] : [created]));
      pushToast({
        message: `${created.title} is now v${created.version}. Layouts keep the version they use until it's updated in a draft.`,
      });
    },
    // No error toast: the form stays open and says what went wrong.
    onSettled: () => qc.invalidateQueries({ queryKey: LAYOUT_COMPONENTS_KEY }),
  });
}

/** Components by id, for drawing a layout. */
export function useLayoutComponentMap(): { byId: Map<number, LayoutComponent>; isLoading: boolean; error: unknown } {
  const q = useLayoutComponents();
  const byId = useMemo(() => new Map((q.data ?? []).map((c) => [c.id, c])), [q.data]);
  return { byId, isLoading: q.isLoading, error: q.error };
}

/** A layout's walls drawing, read, sanitised and checked. */
export function useWallsDrawing(fileId: string | null | undefined) {
  return useQuery<WallsCheck>({
    queryKey: wallsKey(fileId ?? ""),
    queryFn: async () => readWallsSvg(await readWallsFile(fileId as string)),
    enabled: !!fileId,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });
}

export function useCreatePlantLayout() {
  const qc = useQueryClient();
  const resolve = useResolvePlantMapAccess();
  return useMutation({
    mutationFn: async (input: NewPlantLayoutInput) => {
      requirePlantMapGate(editLayoutGate(await resolve()));
      return createPlantLayout(input);
    },
    onSuccess: (created) => {
      qc.setQueryData<PlantLayout[]>(PLANT_LAYOUTS_KEY, (old) => (old ? [...old, created] : [created]));
      qc.setQueryData(plantLayoutKey(created.id), created);
    },
    // No toast: the New layout form stays open and says what went wrong.
    onSettled: () => qc.invalidateQueries({ queryKey: PLANT_LAYOUTS_KEY }),
  });
}

function storeLayout(qc: ReturnType<typeof useQueryClient>, layout: PlantLayout) {
  qc.setQueryData<PlantLayout[]>(PLANT_LAYOUTS_KEY, (old) =>
    old ? (old.some((l) => l.id === layout.id) ? old.map((l) => (l.id === layout.id ? layout : l)) : [...old, layout]) : old,
  );
  qc.setQueryData(plantLayoutKey(layout.id), layout);
}

/** Save a draft's items — editor-gated; the API refuses anything but a Draft. */
export function useSavePlantLayoutDraft() {
  const qc = useQueryClient();
  const resolve = useResolvePlantMapAccess();
  return useMutation({
    mutationFn: async ({ id, doc }: { id: number; doc: PlantLayoutDoc }) => {
      requirePlantMapGate(editLayoutGate(await resolve()));
      return savePlantLayoutDraft(id, doc);
    },
    onSuccess: (saved) => storeLayout(qc, saved),
    onError: (err) =>
      pushToast({
        message: describeListWriteFailure(err, { action: "save the layout", site: "Altronic_PMO", permission: "editing" }),
        variant: "error",
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: PLANT_LAYOUTS_KEY }),
  });
}

/**
 * Delete a Draft or Superseded layout — a Plant Map admin, asked inside the
 * mutationFn. The API deletes the row, then the walls drawing only if no other
 * layout still uses it (read fresh); a file it couldn't delete is a warning.
 */
export function useDeletePlantLayout() {
  const qc = useQueryClient();
  const resolve = useResolvePlantMapAccess();
  return useMutation({
    mutationFn: async (id: number) => {
      requirePlantMapGate(deleteLayoutGate(await resolve()));
      return deletePlantLayout(id);
    },
    onSuccess: ({ layout, wallsDeleted, wallsKeptFor, warnings }) => {
      qc.setQueryData<PlantLayout[]>(PLANT_LAYOUTS_KEY, (old) => old?.filter((l) => l.id !== layout.id));
      qc.setQueryData(plantLayoutKey(layout.id), null);
      if (wallsDeleted) qc.removeQueries({ queryKey: wallsKey(layout.wallsFileId) });
      const name = `${layout.title || `Layout #${layout.id}`} v${layout.version}`;
      const walls = wallsDeleted
        ? " Its walls drawing was deleted too."
        : wallsKeptFor.length > 0
          ? " Its walls drawing was kept — other layouts use it."
          : "";
      pushToast({ message: `Deleted ${name}.${walls}` });
      for (const w of warnings) pushToast({ message: w, variant: "error" });
    },
    onError: (err) =>
      pushToast({
        message: describeListWriteFailure(err, { action: "delete the layout", site: "Altronic_PMO", permission: "deleting" }),
        variant: "error",
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: PLANT_LAYOUTS_KEY }),
  });
}

/** A published layout → its draft (a new one, or the one that already exists). */
export function useCopyLayoutToDraft() {
  const qc = useQueryClient();
  const resolve = useResolvePlantMapAccess();
  return useMutation({
    mutationFn: async (id: number) => {
      requirePlantMapGate(editLayoutGate(await resolve()));
      return copyLayoutToDraft(id);
    },
    onSuccess: ({ layout }) => storeLayout(qc, layout),
    onError: (err) =>
      pushToast({
        message: describeListWriteFailure(err, { action: "start a new draft", site: "Altronic_PMO", permission: "editing" }),
        variant: "error",
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: PLANT_LAYOUTS_KEY }),
  });
}
