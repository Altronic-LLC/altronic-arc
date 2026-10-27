import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addHarnessAlertRecipient,
  listHarnessAlertRecipients,
  removeHarnessAlertRecipient,
} from "@/api/harnessAlertRecipients";
import { listHarnessPartNumbers } from "@/api/harnessPartNumbers";
import { notifyChangeEmails } from "@/api/email";
import { SP_HARNESS_ALERT_RECIPIENTS_LIST_ID, USE_MOCK } from "@/api/config";
import type { HarnessAlert, HarnessAlertRecipientInput } from "@/types/harness";
import type { Person } from "@/types/task";
import { appPageUrl } from "@/lib/appUrl";
import { buildHarnessPartRequestEmails, classifyHarnessPartRequest } from "@/lib/harnessPartRequest";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";
import { useCurrentUser } from "./useCurrentUser";
import { HARNESS_PARTS_KEY } from "./useHarnessProductionLog";
import { useRequireArcAdmin } from "./useRequireArcAdmin";

// =============================================================================
// Harness Alert Recipients — who the Harness department's emails go to — and
// the part number request that is the second thing they're told about.
//
// Reading is open (the person who triggers an email reads the list); adding
// and removing is ARC-admin only, asked INSIDE the mutationFn.
// =============================================================================

/** The list is set up (always true in mock mode). Unset means nobody is told. */
export const HARNESS_ALERTS_CONFIGURED = USE_MOCK || !!SP_HARNESS_ALERT_RECIPIENTS_LIST_ID;

export const HARNESS_ALERT_RECIPIENTS_KEY = ["harnessAlertRecipients"] as const;

export function useHarnessAlertRecipients() {
  return useQuery({
    queryKey: HARNESS_ALERT_RECIPIENTS_KEY,
    queryFn: listHarnessAlertRecipients,
    staleTime: 60_000,
  });
}

/**
 * The people on one alert, read FRESH — an email must reach whoever is on the
 * list now, not whoever was on it when this screen loaded.
 */
export async function readHarnessRecipients(qc: QueryClient, alert: HarnessAlert): Promise<Person[]> {
  const rows = await qc.fetchQuery({ queryKey: HARNESS_ALERT_RECIPIENTS_KEY, queryFn: listHarnessAlertRecipients, staleTime: 0 });
  return rows.filter((r) => r.alert === alert).map((r) => ({ displayName: r.name, email: r.email }));
}

export function useAddHarnessAlertRecipient() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async (input: HarnessAlertRecipientInput) => {
      await requireAdmin("change who is notified");
      return addHarnessAlertRecipient(input);
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
    onSettled: () => qc.invalidateQueries({ queryKey: HARNESS_ALERT_RECIPIENTS_KEY }),
  });
}

export function useRemoveHarnessAlertRecipient() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async (id: number) => {
      await requireAdmin("change who is notified");
      return removeHarnessAlertRecipient(id);
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
    onSettled: () => qc.invalidateQueries({ queryKey: HARNESS_ALERT_RECIPIENTS_KEY }),
  });
}

export interface HarnessPartRequest {
  partNumber: string;
  description: string;
  note: string;
}

/**
 * Ask for a new or retired part number. AWAITED and throws when it reaches
 * nobody — the dialog's only job is the send, so "Sent to …" must be true
 * (the Parts List new-list request's rule). Resolves to who was emailed.
 */
export function useRequestHarnessPartNumber() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: async ({ partNumber, description, note }: HarnessPartRequest): Promise<string[]> => {
      if (!partNumber.trim()) throw new Error("Enter the part number you need.");
      const parts = await qc.ensureQueryData({ queryKey: HARNESS_PARTS_KEY, queryFn: listHarnessPartNumbers });
      const request = classifyHarnessPartRequest(partNumber, parts);
      if (request.kind === "active") {
        throw new Error(`${request.part.title} is already on the list — pick it from the Part Number dropdown.`);
      }
      const emails = buildHarnessPartRequestEmails({
        partNumber,
        request,
        description,
        note,
        recipients: await readHarnessRecipients(qc, "Part number request"),
        actor,
      });
      if (emails.length === 0) {
        throw new Error("Nobody is set up to receive part number requests. Ask an ARC admin directly.");
      }
      const result = await notifyChangeEmails({
        // Not about one item: keeps its own subject, no Outlook conversation.
        target: { kind: "harnessPartNumber", id: 0, title: `Part number ${partNumber.trim().toUpperCase()}`, thread: null },
        emails,
        link: { url: appPageUrl("/harness/production-log/part-numbers"), buttonText: "Open the part numbers" },
      });
      if (result.sent.length === 0) throw new Error("The email didn't send — try again, or ask an ARC admin directly.");
      const sent = new Set(result.sent.map((e) => e.toLowerCase()));
      return emails.filter((e) => sent.has(e.email.toLowerCase())).map((e) => e.displayName || e.email);
    },
  });
}
