import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  appendDrawingChange,
  createDrawingLogEntry,
  deleteDrawingLogEntry,
  listDrawingLog,
  updateDrawingLogEntry,
} from "@/api/drawingLogs";
import type {
  DrawingChangeInput,
  DrawingLogInput,
  DrawingLogKind,
} from "@/types/task";
import { drawingLogLabel } from "@/lib/drawingLogMapper";
import { pushToast } from "@/components/Toast";
import { useIsAdmin } from "./useIsAdmin";

// =============================================================================
// Drawing File Logs hooks. One query per log (they're separate SharePoint lists
// and separate tabs), keyed under a shared prefix so a write can refresh just
// the log it touched.
//
// Drawing registers are reference data that changes a few times a month, so the
// cache is long-lived.
//
// WRITES ARE ADMIN-ONLY, guarded here as well as in the view — the same
// defence-in-depth as useCsaListings / useAdmins, so no future call path can
// write without the check. Reading is open to any signed-in user.
// =============================================================================

const ADMIN_ONLY = "Only admins can add, edit or delete drawing log entries.";

export const DRAWING_LOGS_KEY = ["drawingLogs"] as const;
export const drawingLogKey = (kind: DrawingLogKind) => [...DRAWING_LOGS_KEY, kind] as const;

export function useDrawingLog(kind: DrawingLogKind) {
  return useQuery({
    queryKey: drawingLogKey(kind),
    queryFn: () => listDrawingLog(kind),
    staleTime: 5 * 60_000,
  });
}

export function useCreateDrawingLogEntry(kind: DrawingLogKind) {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: (input: DrawingLogInput) => {
      if (!isAdmin) throw new Error(ADMIN_ONLY);
      return createDrawingLogEntry(kind, input);
    },
    onSuccess: (created) => {
      pushToast({ message: `Added ${drawingLogLabel(created)}` });
      qc.invalidateQueries({ queryKey: drawingLogKey(kind) });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't add the drawing: ${err.message}`, variant: "error" });
    },
  });
}

export function useUpdateDrawingLogEntry(kind: DrawingLogKind) {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: DrawingLogInput }) => {
      if (!isAdmin) throw new Error(ADMIN_ONLY);
      return updateDrawingLogEntry(kind, id, input);
    },
    onSuccess: (updated) => {
      pushToast({ message: `Saved ${drawingLogLabel(updated)}` });
      qc.invalidateQueries({ queryKey: drawingLogKey(kind) });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't save the drawing: ${err.message}`, variant: "error" });
    },
  });
}

/**
 * Record a change against a drawing — the app's main write path for these logs.
 *
 * The error message from a full change log is deliberately surfaced verbatim:
 * "all 16 slots are used" is actionable, where a generic failure isn't.
 */
export function useAppendDrawingChange(kind: DrawingLogKind) {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: ({ id, change }: { id: number; change: DrawingChangeInput }) => {
      if (!isAdmin) throw new Error(ADMIN_ONLY);
      return appendDrawingChange(kind, id, change);
    },
    onSuccess: (updated) => {
      pushToast({ message: `Change recorded on ${drawingLogLabel(updated)}` });
      qc.invalidateQueries({ queryKey: drawingLogKey(kind) });
    },
    onError: (err: Error) => {
      pushToast({ message: err.message, variant: "error" });
    },
  });
}

export function useDeleteDrawingLogEntry(kind: DrawingLogKind) {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: (id: number) => {
      if (!isAdmin) throw new Error(ADMIN_ONLY);
      return deleteDrawingLogEntry(kind, id);
    },
    onSuccess: () => {
      pushToast({ message: "Drawing deleted" });
      qc.invalidateQueries({ queryKey: drawingLogKey(kind) });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't delete the drawing: ${err.message}`, variant: "error" });
    },
  });
}
