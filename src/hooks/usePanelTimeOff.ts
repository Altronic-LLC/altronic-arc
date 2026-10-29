import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPanelTimeOff,
  deletePanelTimeOff,
  listPanelTimeOff,
  updatePanelTimeOff,
  type PanelTimeOffInput,
} from "@/api/panelTimeOff";
import type { PanelTimeOff } from "@/types/task";
import { pushToast } from "@/components/Toast";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { useRequirePanelCapacityManager, useRequirePanelTeamEdit } from "./usePanelRoles";

// =============================================================================
// Panel Time Off — the panel team's "Where am I?" (BusinessIT#42). Every write
// asks the panel team access rule INSIDE its mutationFn (awaiting the roles
// and Admins lists), so no screen can reach the API ungated. A COMPANY HOLIDAY
// (adding one, editing one, or removing one) also needs a panel Super User or
// an ARC admin; an existing entry is judged by the cached row as it stood.
// =============================================================================

export const PANEL_TIME_OFF_KEY = ["panelTimeOff", "list"] as const;

export function usePanelTimeOff() {
  return useQuery({
    queryKey: PANEL_TIME_OFF_KEY,
    queryFn: listPanelTimeOff,
    staleTime: 120_000,
  });
}

function failure(err: unknown, action: string, permission: "editing" | "deleting") {
  pushToast({
    message: describeListWriteFailure(err, {
      action,
      site: "ALTRONICPANELTEAM",
      permission,
    }),
    variant: "error",
  });
}

function isHoliday(qc: ReturnType<typeof useQueryClient>, id: number | null): boolean {
  if (id === null) return false;
  return !!qc.getQueryData<PanelTimeOff[]>(PANEL_TIME_OFF_KEY)?.find((e) => e.id === id)?.companyHoliday;
}

export function useSavePanelTimeOff() {
  const qc = useQueryClient();
  const requireEdit = useRequirePanelTeamEdit();
  const requireHolidays = useRequirePanelCapacityManager();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number | null; input: PanelTimeOffInput }) => {
      await requireEdit();
      if (input.companyHoliday || isHoliday(qc, id)) await requireHolidays();
      return id === null ? createPanelTimeOff(input) : updatePanelTimeOff(id, input);
    },
    onSuccess: (saved, { id }) => {
      qc.setQueryData<PanelTimeOff[]>(PANEL_TIME_OFF_KEY, (old = []) =>
        id === null ? [...old, saved] : old.map((e) => (e.id === id ? saved : e)),
      );
      pushToast({ message: id === null ? "Time off added." : "Time off updated." });
    },
    onError: (err, { id }) =>
      failure(err, id === null ? "add the time off" : "save the time off", "editing"),
    onSettled: () => qc.invalidateQueries({ queryKey: PANEL_TIME_OFF_KEY }),
  });
}

export function useDeletePanelTimeOff() {
  const qc = useQueryClient();
  const requireEdit = useRequirePanelTeamEdit();
  const requireHolidays = useRequirePanelCapacityManager();
  return useMutation({
    mutationFn: async (id: number) => {
      await requireEdit();
      if (isHoliday(qc, id)) await requireHolidays();
      await deletePanelTimeOff(id);
    },
    onSuccess: (_d, id) => {
      qc.setQueryData<PanelTimeOff[]>(PANEL_TIME_OFF_KEY, (old = []) =>
        old.filter((e) => e.id !== id),
      );
      pushToast({ message: "Time off removed." });
    },
    onError: (err) => failure(err, "remove the time off", "deleting"),
    onSettled: () => qc.invalidateQueries({ queryKey: PANEL_TIME_OFF_KEY }),
  });
}
