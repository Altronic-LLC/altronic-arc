import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { findDatasheet, uploadDatasheet, type Datasheet } from "@/api/datasheets";
import { updateAltronicComponent } from "@/api/altronicComponents";
import { addPartGate, editPartGate } from "@/lib/partsRoles";
import { isComponentPrefix, partPrefix } from "@/lib/altronicPartMapper";
import type { AltronicComponent } from "@/types/task";
import { useResolvePartsAccess } from "./usePartsRoles";
import { ALTRONIC_COMPONENTS_KEY } from "./useAltronicParts";

// =============================================================================
// A part's datasheet, looked up by part number (see api/datasheets.ts).
// Held for a while: datasheets change rarely, and stepping back to a part you
// just looked at shouldn't ask SharePoint again.
// =============================================================================

export function datasheetKey(partNumber: string) {
  return ["datasheet", partNumber.trim().toLowerCase()] as const;
}

export function useDatasheet(partNumber: string | null) {
  return useQuery({
    queryKey: datasheetKey(partNumber ?? ""),
    queryFn: () => findDatasheet(partNumber ?? ""),
    enabled: !!partNumber?.trim(),
    staleTime: 10 * 60_000,
  });
}

export interface UploadDatasheetVars {
  partNumber: string;
  file: File;
  /**
   * `new` — straight after the New Part form created it, so the ADD gate
   * applies (an editor may add a component they can't later edit).
   * `edit` — from the part's own page, so the EDIT gate applies.
   */
  via: "new" | "edit";
  /** The Component List item to mark Has Data Sheet = Yes, for a component. */
  componentId?: number;
}

export interface UploadDatasheetResult {
  sheet: Datasheet;
  /** Set when the file landed but Has Data Sheet couldn't be set. */
  flagError: string | null;
}

/**
 * Upload a datasheet, then — for a component — set its Has Data Sheet flag.
 *
 * The flag is written AFTER the file, never before or in the create: a flag
 * saying Yes over a failed upload is exactly the 18-part "link to nothing"
 * problem the lookup was built to get past. It is best-effort: the page finds
 * the file either way, so a refused flag write is reported, not thrown.
 *
 * Not emailed. The SAP admins hear about edits to the part's FIELDS; a
 * datasheet is a file beside it.
 */
export function useUploadDatasheet() {
  const qc = useQueryClient();
  const resolveAccess = useResolvePartsAccess();
  return useMutation({
    mutationFn: async ({ partNumber, file, via, componentId }: UploadDatasheetVars): Promise<UploadDatasheetResult> => {
      const prefix = partPrefix(partNumber) ?? "";
      const component = isComponentPrefix(prefix);
      const access = await resolveAccess();
      const gate = via === "new" ? addPartGate(access, prefix, component) : editPartGate(access, component);
      if (!gate.allowed) throw new Error(gate.hint);

      const sheet = await uploadDatasheet(partNumber, file);
      qc.setQueryData(datasheetKey(partNumber), sheet);

      let flagError: string | null = null;
      if (component && componentId !== undefined) {
        try {
          const updated = await updateAltronicComponent(componentId, { hasDataSheet: true });
          qc.setQueryData<AltronicComponent[]>(ALTRONIC_COMPONENTS_KEY, (old) =>
            old?.map((c) => (c.id === updated.id ? updated : c)),
          );
        } catch (err) {
          flagError = err instanceof Error ? err.message : "Has Data Sheet couldn't be set.";
        }
      }
      return { sheet, flagError };
    },
  });
}
