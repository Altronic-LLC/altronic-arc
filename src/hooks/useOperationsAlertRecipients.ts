import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addOperationsAlertRecipient,
  listOperationsAlertRecipients,
  removeOperationsAlertRecipient,
} from "@/api/operationsAlertRecipients";
import { SP_OPERATIONS_ALERT_RECIPIENTS_LIST_ID, USE_MOCK } from "@/api/config";
import type { OperationsAlert, OperationsAlertRecipientInput } from "@/types/operationsAlerts";
import type { Person } from "@/types/task";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";
import { useRequireArcAdmin } from "./useRequireArcAdmin";

// =============================================================================
// Operations Alert Recipients — who the Operations department's emails go to.
// Reading is open (the person who triggers an email reads the list); adding
// and removing is ARC-admin only, asked INSIDE the mutationFn. The Harness
// Alert Recipients hooks, for Operations.
// =============================================================================

/** The list is set up (always true in mock mode). Unset means nobody is told. */
export const OPERATIONS_ALERTS_CONFIGURED = USE_MOCK || !!SP_OPERATIONS_ALERT_RECIPIENTS_LIST_ID;

export const OPERATIONS_ALERT_RECIPIENTS_KEY = ["operationsAlertRecipients"] as const;

export function useOperationsAlertRecipients() {
  return useQuery({
    queryKey: OPERATIONS_ALERT_RECIPIENTS_KEY,
    queryFn: listOperationsAlertRecipients,
    staleTime: 60_000,
  });
}

/**
 * The people on one alert, read FRESH — an email must reach whoever is on the
 * list now, not whoever was on it when this screen loaded.
 */
export async function readOperationsRecipients(qc: QueryClient, alert: OperationsAlert): Promise<Person[]> {
  const rows = await qc.fetchQuery({
    queryKey: OPERATIONS_ALERT_RECIPIENTS_KEY,
    queryFn: listOperationsAlertRecipients,
    staleTime: 0,
  });
  return rows.filter((r) => r.alert === alert).map((r) => ({ displayName: r.name, email: r.email }));
}

export function useAddOperationsAlertRecipient() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async (input: OperationsAlertRecipientInput) => {
      await requireAdmin("change who is notified");
      return addOperationsAlertRecipient(input);
    },
    onSuccess: (r) => pushToast({ message: `${r.name} will be told about "${r.alert}".` }),
    onError: (err) =>
      pushToast({
        message:
          err instanceof Error && /^(Only ARC admins|.* is already told)/.test(err.message)
            ? err.message
            : describeListWriteFailure(err, { action: "add this person", site: "Altronic_PMO", permission: "editing" }),
        variant: "error",
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: OPERATIONS_ALERT_RECIPIENTS_KEY }),
  });
}

export function useRemoveOperationsAlertRecipient() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async (id: number) => {
      await requireAdmin("change who is notified");
      return removeOperationsAlertRecipient(id);
    },
    onSuccess: () => pushToast({ message: "Removed." }),
    onError: (err) =>
      pushToast({
        message:
          err instanceof Error && err.message.startsWith("Only ARC admins")
            ? err.message
            : describeListWriteFailure(err, { action: "remove this person", site: "Altronic_PMO" }),
        variant: "error",
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: OPERATIONS_ALERT_RECIPIENTS_KEY }),
  });
}
