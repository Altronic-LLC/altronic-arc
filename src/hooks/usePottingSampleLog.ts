import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addPsrNotificationPerson,
  createPottingSampleEntry,
  getPottingLimits,
  listPottingSampleEntries,
  listPsrNotificationPeople,
  removePsrNotificationPerson,
  updatePottingLimits,
} from "@/api/pottingSampleLog";
import type { PottingLimits, PottingSampleEntry, PsrNotificationPerson } from "@/lib/pottingSampleLog";

const ENTRIES_KEY = ["pottingSampleEntries"] as const;
const LIMITS_KEY = ["pottingLimits"] as const;
const PSR_LIST_KEY = ["psrNotificationList"] as const;

// =============================================================================
// Sample entries — any signed-in user can add one.
// =============================================================================

export function useListPottingSampleEntries() {
  return useQuery({
    queryKey: ENTRIES_KEY,
    queryFn: listPottingSampleEntries,
    staleTime: 60_000,
  });
}

export function useCreatePottingSampleEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { date: string; volume: number; weight: number }) =>
      createPottingSampleEntry(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ENTRIES_KEY });
      const previous = qc.getQueryData<PottingSampleEntry[]>(ENTRIES_KEY);
      const temp: PottingSampleEntry = { id: `temp-${Date.now()}`, ...input };
      qc.setQueryData<PottingSampleEntry[]>(ENTRIES_KEY, (old) => (old ? [temp, ...old] : [temp]));
      return { previous };
    },
    onSuccess: (created) => {
      qc.setQueryData<PottingSampleEntry[]>(ENTRIES_KEY, (old) =>
        old ? old.map((e) => (e.id.startsWith("temp-") ? created : e)) : [created],
      );
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(ENTRIES_KEY, ctx.previous);
    },
  });
}

// =============================================================================
// Limits — read and edited by any signed-in user (same as Teradyne's
// reference lists — no admin gate).
// =============================================================================

export function usePottingLimits() {
  return useQuery({
    queryKey: LIMITS_KEY,
    queryFn: getPottingLimits,
    staleTime: 60_000,
  });
}

export function useUpdatePottingLimits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (limits: PottingLimits) => updatePottingLimits(limits),
    onSuccess: (limits) => qc.setQueryData(LIMITS_KEY, limits),
  });
}

// =============================================================================
// PSR notification list — read and edited by any signed-in user (no admin
// gate).
// =============================================================================

export function usePsrNotificationList() {
  return useQuery({
    queryKey: PSR_LIST_KEY,
    queryFn: listPsrNotificationPeople,
    staleTime: 60_000,
  });
}

export function useAddPsrNotificationPerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { displayName: string; email: string }) => addPsrNotificationPerson(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: PSR_LIST_KEY });
      const previous = qc.getQueryData<PsrNotificationPerson[]>(PSR_LIST_KEY);
      const temp: PsrNotificationPerson = { id: `temp-${Date.now()}`, ...input };
      qc.setQueryData<PsrNotificationPerson[]>(PSR_LIST_KEY, (old) => (old ? [...old, temp] : [temp]));
      return { previous };
    },
    onSuccess: (created) => {
      qc.setQueryData<PsrNotificationPerson[]>(PSR_LIST_KEY, (old) =>
        old ? old.map((p) => (p.id.startsWith("temp-") ? created : p)) : [created],
      );
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(PSR_LIST_KEY, ctx.previous);
    },
  });
}

export function useRemovePsrNotificationPerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removePsrNotificationPerson(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: PSR_LIST_KEY });
      const previous = qc.getQueryData<PsrNotificationPerson[]>(PSR_LIST_KEY);
      qc.setQueryData<PsrNotificationPerson[]>(PSR_LIST_KEY, (old) => old?.filter((p) => p.id !== id));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(PSR_LIST_KEY, ctx.previous);
    },
  });
}
