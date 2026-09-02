import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPanelQcDefect, createPanelQcIssue, listPanelQcDefects, listPanelQcIssues, updatePanelQcIssue } from "@/api/panelQcIssues";
import type { PanelQcDefect, PanelQcIssue, PanelQcIssueInput } from "@/types/task";
import { pushToast } from "@/components/Toast";

export const PANEL_QC_ISSUES_KEY = ["panelQcIssues"] as const;
export const PANEL_QC_DEFECTS_KEY = ["panelQcDefects"] as const;

export function usePanelQcIssues() { return useQuery({ queryKey: PANEL_QC_ISSUES_KEY, queryFn: listPanelQcIssues, staleTime: 2 * 60_000 }); }
export function usePanelQcDefects() { return useQuery({ queryKey: PANEL_QC_DEFECTS_KEY, queryFn: listPanelQcDefects, staleTime: 5 * 60_000 }); }

export function useCreatePanelQcIssue() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: createPanelQcIssue, onSuccess: (created) => { queryClient.setQueryData<PanelQcIssue[]>(PANEL_QC_ISSUES_KEY, (old) => old ? [created, ...old] : [created]); queryClient.invalidateQueries({ queryKey: PANEL_QC_ISSUES_KEY }); pushToast({ message: "Panel QC issue added." }); }, onError: (error: Error) => pushToast({ message: `Couldn't add the issue: ${error.message}`, variant: "error" }) });
}

export function useUpdatePanelQcIssue() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ id, input }: { id: number; input: PanelQcIssueInput }) => updatePanelQcIssue(id, input), onSuccess: (updated) => { queryClient.setQueryData<PanelQcIssue[]>(PANEL_QC_ISSUES_KEY, (old) => old?.map((item) => item.id === updated.id ? updated : item)); queryClient.invalidateQueries({ queryKey: PANEL_QC_ISSUES_KEY }); pushToast({ message: "Panel QC issue saved." }); }, onError: (error: Error) => pushToast({ message: `Couldn't save the issue: ${error.message}`, variant: "error" }) });
}

export function useCreatePanelQcDefect() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: createPanelQcDefect, onSuccess: (created) => { queryClient.setQueryData<PanelQcDefect[]>(PANEL_QC_DEFECTS_KEY, (old) => old ? [...old, created].sort((a, b) => a.name.localeCompare(b.name)) : [created]); queryClient.invalidateQueries({ queryKey: PANEL_QC_DEFECTS_KEY }); pushToast({ message: `Added defect category "${created.name}".` }); }, onError: (error: Error) => pushToast({ message: `Couldn't add the defect category: ${error.message}`, variant: "error" }) });
}