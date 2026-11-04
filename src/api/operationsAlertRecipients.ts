import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_OPERATIONS_ALERT_RECIPIENTS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import {
  OPERATIONS_ALERTS,
  type OperationsAlert,
  type OperationsAlertRecipient,
  type OperationsAlertRecipientInput,
} from "@/types/operationsAlerts";

// =============================================================================
// Operations Alert Recipients — who the Operations department's emails go to,
// on the PMO site. Created by scripts/create-coating-lists.ps1 (Title = name,
// Email, Alert choice). ARC admins add and remove people at
// /operations/alert-recipients; the gate lives in
// hooks/useOperationsAlertRecipients.ts.
//
// The Harness Alert Recipients arrangement, as its own list (Tim, 2026-11-04):
// changing who is told is a list edit, not a redeploy, and it is READ fresh by
// whoever triggers an email. It HAS a delete — a membership list, not a
// record. The mock is seeded with invented people only (rule 8).
// =============================================================================

const SELECT = "Title,Email,Alert";

const MOCK_SEED: OperationsAlertRecipient[] = [
  { id: 1, name: "Demo Supervisor", email: "supervisor@example.com", alert: "Coating out of spec" },
  { id: 2, name: "Demo Quality", email: "quality@example.com", alert: "Coating out of spec" },
];

let mockStore: OperationsAlertRecipient[] = MOCK_SEED.map((r) => ({ ...r }));

/** Test seam. */
export function resetOperationsAlertRecipientMockStore(): void {
  mockStore = MOCK_SEED.map((r) => ({ ...r }));
}

function itemsPath(action: string): string {
  if (!SP_OPERATIONS_ALERT_RECIPIENTS_LIST_ID) {
    throw new Error(`Cannot ${action}: the Operations Alert Recipients list id is not configured.`);
  }
  return `/sites/${SITES.pmo}/lists/${SP_OPERATIONS_ALERT_RECIPIENTS_LIST_ID}/items`;
}

function toAlert(raw: unknown): OperationsAlert | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  return (OPERATIONS_ALERTS as readonly string[]).includes(v) ? (v as OperationsAlert) : null;
}

/** A row with no usable email or an alert ARC doesn't know is dropped, not guessed at. */
export function toOperationsAlertRecipient(item: GraphListItem): OperationsAlertRecipient | null {
  const f = (item.fields ?? {}) as Record<string, unknown>;
  const email = typeof f.Email === "string" ? f.Email.trim() : "";
  const alert = toAlert(f.Alert);
  if (!email || !alert) return null;
  return {
    id: parseInt(item.id, 10),
    name: typeof f.Title === "string" && f.Title.trim() ? f.Title.trim() : email,
    email,
    alert,
  };
}

/** Everyone on the list, by alert then name. An unset list id reads as nobody. */
export async function listOperationsAlertRecipients(): Promise<OperationsAlertRecipient[]> {
  const sort = (rows: OperationsAlertRecipient[]) =>
    [...rows].sort(
      (a, b) => OPERATIONS_ALERTS.indexOf(a.alert) - OPERATIONS_ALERTS.indexOf(b.alert) || a.name.localeCompare(b.name),
    );
  if (USE_MOCK) return mockDelay(sort(mockStore).map((r) => ({ ...r })));
  if (!SP_OPERATIONS_ALERT_RECIPIENTS_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `${itemsPath("read the alert recipients")}?$expand=fields($select=${SELECT})&$top=999`,
  );
  return sort(items.map(toOperationsAlertRecipient).filter((r): r is OperationsAlertRecipient => r !== null));
}

/** Refuses a person already on that alert (case-insensitive email). */
export async function addOperationsAlertRecipient(input: OperationsAlertRecipientInput): Promise<OperationsAlertRecipient> {
  const email = input.email.trim();
  if (!email) throw new Error("Pick a person with an email address.");
  const existing = await listOperationsAlertRecipients();
  if (existing.some((r) => r.alert === input.alert && r.email.toLowerCase() === email.toLowerCase())) {
    throw new Error(`${input.name || email} is already told about "${input.alert}".`);
  }
  if (USE_MOCK) {
    const created = { ...input, email, id: Math.max(0, ...mockStore.map((r) => r.id)) + 1 };
    mockStore = [...mockStore, created];
    return mockDelay({ ...created });
  }
  const created = await graphFetch<GraphListItem>(itemsPath("add an alert recipient"), {
    method: "POST",
    body: JSON.stringify({ fields: { Title: input.name.trim() || email, Email: email, Alert: input.alert } }),
  });
  const row = toOperationsAlertRecipient(created);
  if (!row) throw new Error("SharePoint saved the recipient but didn't hand it back. Refresh to check.");
  return row;
}

export async function removeOperationsAlertRecipient(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((r) => r.id !== id);
    return mockDelay(undefined);
  }
  await graphFetch(`${itemsPath("remove an alert recipient")}/${id}`, { method: "DELETE" });
}
