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
import { createLayoutComponent, listLayoutComponents } from "@/api/layoutComponents";
import { readWallsFile } from "@/api/plantLayoutFiles";
import type { LayoutComponent, NewLayoutComponentInput, NewPlantLayoutInput, PlantLayout, PlantLayoutDoc } from "@/types/plant";
import { readWallsSvg, type WallsCheck } from "@/lib/plantSvg";
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

/**
 * Publish a draft — a Plant Map admin, asked inside the mutationFn, and ONLY
 * if the placement check passes, asked again here on a fresh read of the
 * layout, the walls drawing and the symbol library (a page open for an hour
 * mustn't publish what it showed then). The API flips the old version to
 * Superseded.
 */
export function usePublishPlantLayout() {
  const qc = useQueryClient();
  const resolve = useResolvePlantMapAccess();
  return useMutation({
    mutationFn: async (id: number) => {
      requirePlantMapGate(publishLayoutGate(await resolve()));
      const layout = await getPlantLayout(id);
      if (!layout) throw new Error("That layout has been deleted.");
      const components = await qc.fetchQuery({ queryKey: LAYOUT_COMPONENTS_KEY, queryFn: listLayoutComponents });
      const walls = layout.wallsFileId
        ? await qc.fetchQuery({
            queryKey: wallsKey(layout.wallsFileId),
            queryFn: async () => readWallsSvg(await readWallsFile(layout.wallsFileId)),
            staleTime: Infinity,
          })
        : null;
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
      return publishPlantLayout(id);
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
