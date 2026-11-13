import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPanelTaskTemplate,
  deletePanelTaskTemplate,
  listPanelTaskTemplates,
  updatePanelTaskTemplate,
  type PanelTaskTemplateInput,
} from "@/api/panelTaskTemplates";
import { useRequirePanelTemplateManager } from "./usePanelRoles";
import { pushToast } from "@/components/Toast";
import { panelTaskTemplateProblem } from "@/lib/panelOrderTasks";

// =============================================================================
// Panel Task Templates — the tasks a new Panel Order raises. Anyone may read
// them (the New Order form lists them); only a panel Manager / Admin / Super
// User or an ARC admin may change them, asked INSIDE every mutationFn.
// =============================================================================

export const PANEL_TASK_TEMPLATES_KEY = ["panelTaskTemplates"] as const;

export function usePanelTaskTemplates() {
  return useQuery({
    queryKey: PANEL_TASK_TEMPLATES_KEY,
    queryFn: listPanelTaskTemplates,
    staleTime: 5 * 60_000,
  });
}

function checked(input: PanelTaskTemplateInput): PanelTaskTemplateInput {
  const problem = panelTaskTemplateProblem(input);
  if (problem) throw new Error(problem);
  return input;
}

function errorToast(err: unknown, fallback: string) {
  pushToast({ message: err instanceof Error ? err.message : fallback, variant: "error" });
}

export function useCreatePanelTaskTemplate() {
  const qc = useQueryClient();
  const requireManager = useRequirePanelTemplateManager();
  return useMutation({
    mutationFn: async (input: PanelTaskTemplateInput) => {
      await requireManager();
      return createPanelTaskTemplate(checked(input));
    },
    onSuccess: (t) => pushToast({ message: `Added "${t.title}" to the standard tasks.` }),
    onError: (err) => errorToast(err, "Couldn't add the task."),
    onSettled: () => qc.invalidateQueries({ queryKey: PANEL_TASK_TEMPLATES_KEY }),
  });
}

export function useUpdatePanelTaskTemplate() {
  const qc = useQueryClient();
  const requireManager = useRequirePanelTemplateManager();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: PanelTaskTemplateInput }) => {
      await requireManager();
      return updatePanelTaskTemplate(id, checked(input));
    },
    onSuccess: (t) => pushToast({ message: `Saved "${t.title}".` }),
    onError: (err) => errorToast(err, "Couldn't save the task."),
    onSettled: () => qc.invalidateQueries({ queryKey: PANEL_TASK_TEMPLATES_KEY }),
  });
}

export function useDeletePanelTaskTemplate() {
  const qc = useQueryClient();
  const requireManager = useRequirePanelTemplateManager();
  return useMutation({
    mutationFn: async (id: number) => {
      await requireManager();
      await deletePanelTaskTemplate(id);
    },
    onSuccess: () => pushToast({ message: "Removed from the standard tasks." }),
    onError: (err) => errorToast(err, "Couldn't remove the task."),
    onSettled: () => qc.invalidateQueries({ queryKey: PANEL_TASK_TEMPLATES_KEY }),
  });
}
