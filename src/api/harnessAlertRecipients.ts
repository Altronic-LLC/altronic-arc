import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_HARNESS_ALERT_RECIPIENTS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import {
  HARNESS_ALERTS,
  type HarnessAlert,
  type HarnessAlertRecipient,
  type HarnessAlertRecipientInput,
} from "@/types/harness";

// =============================================================================
// Harness Alert Recipients — who the Harness department's emails go to, on the
// PMO site. Created by scripts/create-crimp-lists.ps1 (Title = name, Email,
// Alert choice). ARC admins add and remove people at /harness/alert-recipients;
// the gate lives in hooks/useHarnessAlertRecipients.ts.
//
// A LIST rather than a VITE_* variable, on purpose (Tim, 2026-10-27): changing
// who is told is a list edit, not a redeploy. The list is READ by whoever
// triggers an email (an operator recording an out-of-spec check), so it is
// read fresh at send time — never a cached copy that predates an edit.
//
// It HAS a delete: it is a membership list, not a record of something that
// happened. The mock is seeded with invented people only (rule 8).
// =============================================================================

const SELECT = "Title,Email,Alert";

const MOCK_SEED: HarnessAlertRecipient[] = [
  { id: 1, name: "Demo Supervisor", email: "supervisor@example.com", alert: "Crimp out of spec" },
  { id: 2, name: "Demo Quality", email: "quality@example.com", alert: "Crimp out of spec" },
  { id: 3, name: "Demo Supervisor", email: "supervisor@example.com", alert: "Part number request" },
];

let mockStore: HarnessAlertRecipient[] = MOCK_SEED.map((r) => ({ ...r }));

/** Test seam. */
export function resetHarnessAlertRecipientMockStore(): void {
  mockStore = MOCK_SEED.map((r) => ({ ...r }));
}

function itemsPath(action: string): string {
  if (!SP_HARNESS_ALERT_RECIPIENTS_LIST_ID) {
    throw new Error(`Cannot ${action}: the Harness Alert Recipients list id is not configured.`);
  }
  return `/sites/${SITES.pmo}/lists/${SP_HARNESS_ALERT_RECIPIENTS_LIST_ID}/items`;
}

function toAlert(raw: unknown): HarnessAlert | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  return (HARNESS_ALERTS as readonly string[]).includes(v) ? (v as HarnessAlert) : null;
}

/** A row with no usable email or an alert ARC doesn't know is dropped, not guessed at. */
export function toHarnessAlertRecipient(item: GraphListItem): HarnessAlertRecipient | null {
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
export async function listHarnessAlertRecipients(): Promise<HarnessAlertRecipient[]> {
  const sort = (rows: HarnessAlertRecipient[]) =>
    [...rows].sort((a, b) => HARNESS_ALERTS.indexOf(a.alert) - HARNESS_ALERTS.indexOf(b.alert) || a.name.localeCompare(b.name));
  if (USE_MOCK) return mockDelay(sort(mockStore).map((r) => ({ ...r })));
  if (!SP_HARNESS_ALERT_RECIPIENTS_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `${itemsPath("read the alert recipients")}?$expand=fields($select=${SELECT})&$top=999`,
  );
  return sort(items.map(toHarnessAlertRecipient).filter((r): r is HarnessAlertRecipient => r !== null));
}

/** Refuses a person already on that alert (case-insensitive email). */
export async function addHarnessAlertRecipient(input: HarnessAlertRecipientInput): Promise<HarnessAlertRecipient> {
  const email = input.email.trim();
  if (!email) throw new Error("Pick a person with an email address.");
  const existing = await listHarnessAlertRecipients();
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
  const row = toHarnessAlertRecipient(created);
  if (!row) throw new Error("SharePoint saved the recipient but didn't hand it back. Refresh to check.");
  return row;
}

export async function removeHarnessAlertRecipient(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((r) => r.id !== id);
    return mockDelay(undefined);
  }
  await graphFetch(`${itemsPath("remove an alert recipient")}/${id}`, { method: "DELETE" });
}
