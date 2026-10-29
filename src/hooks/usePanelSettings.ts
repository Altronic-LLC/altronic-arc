import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getPanelSettings, setPanelAmberPercent } from "@/api/panelSettings";
import { amberPercentProblem } from "@/lib/panelSettings";
import { useRequirePanelCapacityManager } from "./usePanelRoles";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Panel Settings — read by the Capacity view; changed only by a panel Super
// User or an ARC admin, asked INSIDE the mutationFn.
// =============================================================================

export const PANEL_SETTINGS_KEY = ["panelSettings"] as const;

export function usePanelSettings() {
  return useQuery({ queryKey: PANEL_SETTINGS_KEY, queryFn: getPanelSettings, staleTime: 5 * 60_000 });
}

export function useSetPanelAmberPercent() {
  const qc = useQueryClient();
  const requireManager = useRequirePanelCapacityManager();
  return useMutation({
    mutationFn: async (percent: number) => {
      await requireManager();
      const problem = amberPercentProblem(percent);
      if (problem) throw new Error(problem);
      return setPanelAmberPercent(percent);
    },
    onSuccess: (settings) => {
      qc.setQueryData(PANEL_SETTINGS_KEY, settings);
      pushToast({ message: `Amber now starts above ${settings.amberPercent}%.` });
    },
    onError: (err) =>
      pushToast({
        message: err instanceof Error ? err.message : "Couldn't change the amber threshold.",
        variant: "error",
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: PANEL_SETTINGS_KEY }),
  });
}
