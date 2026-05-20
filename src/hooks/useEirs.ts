import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addEirComment,
  createEir,
  editEirComment,
  listEirs,
  setEirAssignedEngineers,
  setEirReporter,
  setEirWatchers,
  updateEirFields,
  type CreateEirInput,
} from "@/api/eirs";
import type {
  Eir,
  EirRequestType,
  EirResolution,
  EirStatus,
  Person,
  ProjectReference,
} from "@/types/task";
import { pushToast } from "@/components/Toast";

const EIRS_KEY = ["eirs", "list"] as const;
const PROJECTS_KEY = ["projects"] as const;

export function useEirs() {
  return useQuery({
    queryKey: EIRS_KEY,
    queryFn: listEirs,
    staleTime: 120_000,
  });
}

export function useEir(id: number | null) {
  const list = useEirs();
  return {
    ...list,
    data: id !== null ? list.data?.find((e) => e.id === id) ?? null : null,
  };
}

// =============================================================================
// Optimistic mutations + toast/undo — same pattern as src/hooks/useTasks.ts
// =============================================================================

type EirCtx = { previous?: Eir[]; prevEir?: Eir };

async function snapshotAndPatch(
  qc: QueryClient,
  id: number,
  patch: (eirs: Eir[]) => Eir[],
): Promise<EirCtx> {
  await qc.cancelQueries({ queryKey: EIRS_KEY });
  const previous = qc.getQueryData<Eir[]>(EIRS_KEY);
  const prevEir = previous?.find((e) => e.id === id);
  qc.setQueryData<Eir[]>(EIRS_KEY, (old) => (old ? patch(old) : []));
  return { previous, prevEir };
}

function rollback(qc: QueryClient, ctx: EirCtx | undefined) {
  if (ctx?.previous) qc.setQueryData(EIRS_KEY, ctx.previous);
}

function invalidate(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: EIRS_KEY });
}

function patchEir(id: number, transform: (e: Eir) => Eir) {
  return (eirs: Eir[]) => eirs.map((e) => (e.id === id ? transform(e) : e));
}

function buildUndo(
  qc: QueryClient,
  snapshot: Eir[] | undefined,
  revert: () => Promise<unknown>,
): (() => void) | undefined {
  if (!snapshot) return undefined;
  return () => {
    qc.setQueryData<Eir[]>(EIRS_KEY, snapshot);
    revert().catch((err) => {
      console.error("EIR undo failed:", err);
      pushToast({ message: "Couldn't undo on SharePoint. Refreshing.", variant: "error" });
      qc.invalidateQueries({ queryKey: EIRS_KEY });
    });
  };
}

function resolveProject(qc: QueryClient, lookupId: number): ProjectReference | null {
  const projects = qc.getQueryData<ProjectReference[]>(PROJECTS_KEY);
  return projects?.find((p) => p.lookupId === lookupId) ?? null;
}

export function useCreateEir() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEirInput) => createEir(input),
    onSuccess: (created) => {
      qc.setQueryData<Eir[]>(EIRS_KEY, (old) => (old ? [created, ...old] : [created]));
      qc.invalidateQueries({ queryKey: EIRS_KEY });
      pushToast({ message: `Created ${created.eirNo || created.title}.` });
    },
    onError: () => pushToast({ message: "Couldn't create EIR — please retry.", variant: "error" }),
  });
}

export function useUpdateEirFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      updateEirFields(id, fields),
    onMutate: ({ id, fields }) =>
      snapshotAndPatch(qc, id, patchEir(id, (e) => applyFieldsLocally(e, fields, qc))),
    onSuccess: (_data, { id, fields }, ctx) => {
      const inverse = ctx?.prevEir ? buildInverseFields(ctx.prevEir, fields) : null;
      pushToast({
        message: messageForFieldsUpdate(fields),
        undo:
          inverse && Object.keys(inverse).length > 0
            ? buildUndo(qc, ctx?.previous, () => updateEirFields(id, inverse))
            : undefined,
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      pushToast({ message: "Couldn't save changes — reverted.", variant: "error" });
    },
    onSettled: () => invalidate(qc),
  });
}

export function useSetEirReporter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person | null }) =>
      setEirReporter(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(qc, id, patchEir(id, (e) => ({ ...e, reporter: person, modifiedAt: new Date() }))),
    onSuccess: (_d, { id }, ctx) => {
      const prev = ctx?.prevEir?.reporter ?? null;
      pushToast({
        message: "Reporter updated.",
        undo: buildUndo(qc, ctx?.previous, () => setEirReporter(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      pushToast({ message: "Couldn't update reporter — reverted.", variant: "error" });
    },
    onSettled: () => invalidate(qc),
  });
}

export function useSetEirAssignedEngineers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) =>
      setEirAssignedEngineers(id, people),
    onMutate: ({ id, people }) =>
      snapshotAndPatch(qc, id, patchEir(id, (e) => ({ ...e, assignedEngineers: people, modifiedAt: new Date() }))),
    onSuccess: (_d, { id }, ctx) => {
      const prev = ctx?.prevEir?.assignedEngineers ?? [];
      pushToast({
        message: "Assigned engineers updated.",
        undo: buildUndo(qc, ctx?.previous, () => setEirAssignedEngineers(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      pushToast({ message: "Couldn't update engineers — reverted.", variant: "error" });
    },
    onSettled: () => invalidate(qc),
  });
}

export function useSetEirWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) => setEirWatchers(id, people),
    onMutate: ({ id, people }) =>
      snapshotAndPatch(qc, id, patchEir(id, (e) => ({ ...e, watchers: people, modifiedAt: new Date() }))),
    onSuccess: (_d, { id }, ctx) => {
      const prev = ctx?.prevEir?.watchers ?? [];
      pushToast({
        message: "Watchers updated.",
        undo: buildUndo(qc, ctx?.previous, () => setEirWatchers(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      pushToast({ message: "Couldn't update watchers — reverted.", variant: "error" });
    },
    onSettled: () => invalidate(qc),
  });
}

export function useAddEirComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addEirComment(id, comment),
    onMutate: ({ id, comment }) =>
      snapshotAndPatch(
        qc,
        id,
        patchEir(id, (e) => ({
          ...e,
          comments: [
            {
              timestamp: new Date(),
              authorName: comment.authorName,
              authorEmail: comment.authorEmail,
              bodyHtml: comment.bodyHtml,
              attachments: [],
            },
            ...e.comments,
          ],
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: () => pushToast({ message: "Comment posted." }),
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      pushToast({ message: "Couldn't post comment — please retry.", variant: "error" });
    },
    onSettled: () => invalidate(qc),
  });
}

export function useEditEirComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      target,
      newBodyHtml,
    }: {
      id: number;
      target: { timestamp: Date; authorEmail: string };
      newBodyHtml: string;
    }) => editEirComment(id, target, newBodyHtml),
    onMutate: ({ id, target, newBodyHtml }) =>
      snapshotAndPatch(
        qc,
        id,
        patchEir(id, (e) => ({
          ...e,
          comments: e.comments.map((c) =>
            c.timestamp.getTime() === target.timestamp.getTime() &&
            (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase()
              ? { ...c, bodyHtml: newBodyHtml }
              : c,
          ),
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_d, { id, target }, ctx) => {
      const prevBody = ctx?.prevEir?.comments.find(
        (c) =>
          c.timestamp.getTime() === target.timestamp.getTime() &&
          (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase(),
      )?.bodyHtml;
      pushToast({
        message: "Comment updated.",
        undo:
          prevBody !== undefined
            ? buildUndo(qc, ctx?.previous, () => editEirComment(id, target, prevBody))
            : undefined,
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      pushToast({ message: "Couldn't save comment — reverted.", variant: "error" });
    },
    onSettled: () => invalidate(qc),
  });
}

// =============================================================================
// Helpers
// =============================================================================

function applyFieldsLocally(
  e: Eir,
  fields: Record<string, unknown>,
  qc: QueryClient,
): Eir {
  const next: Eir = { ...e, modifiedAt: new Date() };
  if ("Title" in fields) next.title = (fields.Title as string) ?? next.title;
  if ("Description" in fields) next.description = (fields.Description as string) ?? "";
  if ("Status" in fields) next.status = fields.Status as EirStatus;
  if ("Resolution" in fields) next.resolution = fields.Resolution as EirResolution;
  if ("RequestType" in fields) next.requestType = fields.RequestType as EirRequestType | null;
  if ("Priority" in fields) {
    const v = fields.Priority as string | null;
    next.requestedPriority = v as Eir["requestedPriority"];
  }
  if ("EngineeringResponse" in fields) next.engineeringResponse = (fields.EngineeringResponse as string) ?? "";
  if ("WhereUsed" in fields) next.whereUsed = (fields.WhereUsed as string) ?? "";
  if ("EAU" in fields) next.eau = (fields.EAU as string) ?? "";
  if ("CurrentStock" in fields) next.currentStock = (fields.CurrentStock as string) ?? "";
  if ("MFG" in fields) next.mfg = (fields.MFG as string) ?? "";
  if ("MFGP_x002f_N" in fields) next.mfgPartNumber = (fields.MFGP_x002f_N as string) ?? "";
  if ("Current_x0020_Price" in fields) next.currentPrice = (fields.Current_x0020_Price as string) ?? "";
  if ("Altronic_x0020_Part_x0020_Number" in fields)
    next.altronicPartNumber = (fields.Altronic_x0020_Part_x0020_Number as string) ?? "";
  if ("TaskReference" in fields) next.taskReference = (fields.TaskReference as string) ?? "";
  if ("BuyerCode" in fields) next.buyerCode = (fields.BuyerCode as string) ?? "";
  if ("Requested_x0020_Completion_x0020" in fields) {
    const v = fields.Requested_x0020_Completion_x0020;
    next.requestedCompletionDate = v ? new Date(v as string) : null;
  }
  if ("LTBDate" in fields) {
    const v = fields.LTBDate;
    next.ltbDate = v ? new Date(v as string) : null;
  }
  if ("ProjectReferenceLookupId" in fields) {
    const v = fields.ProjectReferenceLookupId;
    next.parentProject = v
      ? resolveProject(qc, Number(v)) ?? {
          lookupId: Number(v),
          title: next.parentProject?.title ?? "",
        }
      : null;
  }
  return next;
}

function buildInverseFields(prev: Eir, fields: Record<string, unknown>): Record<string, unknown> {
  const inv: Record<string, unknown> = {};
  if ("Title" in fields) inv.Title = prev.title;
  if ("Description" in fields) inv.Description = prev.description;
  if ("Status" in fields) inv.Status = prev.status;
  if ("Resolution" in fields) inv.Resolution = prev.resolution;
  if ("RequestType" in fields) inv.RequestType = prev.requestType;
  if ("Priority" in fields) inv.Priority = prev.requestedPriority;
  if ("EngineeringResponse" in fields) inv.EngineeringResponse = prev.engineeringResponse;
  if ("WhereUsed" in fields) inv.WhereUsed = prev.whereUsed;
  if ("EAU" in fields) inv.EAU = prev.eau;
  if ("CurrentStock" in fields) inv.CurrentStock = prev.currentStock;
  if ("MFG" in fields) inv.MFG = prev.mfg;
  if ("MFGP_x002f_N" in fields) inv.MFGP_x002f_N = prev.mfgPartNumber;
  if ("Current_x0020_Price" in fields) inv.Current_x0020_Price = prev.currentPrice;
  if ("Altronic_x0020_Part_x0020_Number" in fields)
    inv.Altronic_x0020_Part_x0020_Number = prev.altronicPartNumber;
  if ("TaskReference" in fields) inv.TaskReference = prev.taskReference;
  if ("BuyerCode" in fields) inv.BuyerCode = prev.buyerCode;
  if ("Requested_x0020_Completion_x0020" in fields)
    inv.Requested_x0020_Completion_x0020 = prev.requestedCompletionDate
      ? prev.requestedCompletionDate.toISOString()
      : null;
  if ("LTBDate" in fields)
    inv.LTBDate = prev.ltbDate ? prev.ltbDate.toISOString() : null;
  if ("ProjectReferenceLookupId" in fields)
    inv.ProjectReferenceLookupId = prev.parentProject?.lookupId ?? null;
  return inv;
}

function messageForFieldsUpdate(fields: Record<string, unknown>): string {
  const keys = Object.keys(fields).filter((k) => !k.endsWith("@odata.type"));
  if (keys.length === 1) {
    switch (keys[0]) {
      case "Status":
        return `Status changed to "${fields.Status}".`;
      case "Resolution":
        return `Resolution changed to "${fields.Resolution}".`;
      case "RequestType":
        return `Request type changed to "${fields.RequestType}".`;
      case "Priority":
        return fields.Priority
          ? `Requested priority changed to "${fields.Priority}".`
          : "Requested priority cleared.";
      case "EngineeringResponse":
        return "Engineering response updated.";
      case "Title":
        return "Title updated.";
      case "Description":
        return "Description updated.";
      case "WhereUsed":
      case "EAU":
      case "CurrentStock":
      case "MFG":
      case "MFGP_x002f_N":
      case "Current_x0020_Price":
      case "Altronic_x0020_Part_x0020_Number":
        return "Part details updated.";
      case "Requested_x0020_Completion_x0020":
        return "Requested completion date updated.";
      case "LTBDate":
        return "LTB date updated.";
      case "ProjectReferenceLookupId":
        return "Project updated.";
      case "TaskReference":
        return "Task reference updated.";
    }
  }
  return "EIR updated.";
}
