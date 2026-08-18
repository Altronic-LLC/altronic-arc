import { graphFetch, graphFetchAll } from "./graph";
import { SHARED_MAILBOX, SITES, SP_POTTING_LIMIT_LIST_ID, SP_POTTING_SAMPLE_LOG_LIST_ID, SP_PSR_NOTIFICATION_LIST_ID, USE_MOCK } from "./config";
import type { GraphListItem } from "@/types/task";
import {
  checkLimitBreach,
  type PottingLimits,
  type PottingSampleEntry,
  type PsrNotificationPerson,
} from "@/lib/pottingSampleLog";
import { pottingLimitAlertHtml, pottingLimitAlertSubject } from "@/lib/pottingSampleAlerts";
import {
  POTTING_LIMIT_MOCK,
  POTTING_SAMPLE_MOCK_ENTRIES,
  PSR_NOTIFICATION_MOCK,
} from "@/data/pottingSampleMockData";

// =============================================================================
// Coils — Potting Sample Log API.
//
// Three lists on the PMO site (SITES.pmo, see api/config.ts):
//   - Coil-PottingSampleLog: operator-entered samples (Date, Volume, Weight).
//   - Coil-PottingLimit: two fixed rows (Title = "Lower Spec Limit" /
//     "Upper Spec Limit", Limit = the numeric value), editable by anyone.
//   - Coil PSR Notification List: Title = display name, Email = notify
//     address, editable by anyone (add/remove people).
//
// After a sample is saved, we check its weight against the current limits and
// email the PSR notification list if it's out of range (see
// notifyIfOutOfLimit below). Mock mode logs the email instead of sending it.
// =============================================================================

function toPottingSampleEntry(item: GraphListItem): PottingSampleEntry {
  const fields = item.fields as Record<string, unknown>;
  return {
    id: item.id,
    date: String(fields.Date ?? ""),
    volume: Number(fields.Volume ?? 0),
    weight: Number(fields.Weight ?? 0),
  };
}

function mockDelay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

let mockEntries = POTTING_SAMPLE_MOCK_ENTRIES;
let mockLimits = POTTING_LIMIT_MOCK;
let mockPsrList = PSR_NOTIFICATION_MOCK;

// =============================================================================
// Sample entries
// =============================================================================

export async function listPottingSampleEntries(): Promise<PottingSampleEntry[]> {
  if (USE_MOCK) {
    return mockDelay(
      [...mockEntries].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
    );
  }

  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${SP_POTTING_SAMPLE_LOG_LIST_ID}` +
      `/items?$expand=fields($select=Date,Volume,Weight)`,
  );
  return items
    .map(toPottingSampleEntry)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

export async function createPottingSampleEntry(input: {
  date: string;
  volume: number;
  weight: number;
}): Promise<PottingSampleEntry> {
  let created: PottingSampleEntry;

  if (USE_MOCK) {
    const id = String(Math.max(...mockEntries.map((e) => Number(e.id) || 0)) + 1);
    created = { id, ...input };
    mockEntries = [created, ...mockEntries];
    await mockDelay(null);
  } else {
    const item = await graphFetch<GraphListItem>(
      `/sites/${SITES.pmo}/lists/${SP_POTTING_SAMPLE_LOG_LIST_ID}/items`,
      {
        method: "POST",
        body: JSON.stringify({
          fields: { Date: input.date, Volume: input.volume, Weight: input.weight },
        }),
      },
    );
    created = toPottingSampleEntry(item);
  }

  // Best-effort: a slow/failed notification shouldn't make the save look
  // like it failed. The entry is already saved by this point either way.
  try {
    await notifyIfOutOfLimit(created);
  } catch (err) {
    console.error("[pottingSampleLog] failed to send out-of-limit notification:", err);
  }

  return created;
}

// =============================================================================
// Limits (Coil-PottingLimit)
// =============================================================================

const LOWER_LIMIT_TITLE = "Lower Spec Limit";
const UPPER_LIMIT_TITLE = "Upper Spec Limit";

interface PottingLimitRow {
  id: string;
  title: string;
  limit: number;
}

async function listPottingLimitRows(): Promise<PottingLimitRow[]> {
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${SP_POTTING_LIMIT_LIST_ID}/items?$expand=fields($select=Title,Limit)`,
  );
  return items.map((item) => {
    const fields = item.fields as Record<string, unknown>;
    return { id: item.id, title: String(fields.Title ?? ""), limit: Number(fields.Limit ?? 0) };
  });
}

export async function getPottingLimits(): Promise<PottingLimits> {
  if (USE_MOCK) return mockDelay({ ...mockLimits });

  const rows = await listPottingLimitRows();
  const lower = rows.find((r) => r.title === LOWER_LIMIT_TITLE)?.limit;
  const upper = rows.find((r) => r.title === UPPER_LIMIT_TITLE)?.limit;
  return { lowerLimit: lower ?? 0, upperLimit: upper ?? 0 };
}

export async function updatePottingLimits(limits: PottingLimits): Promise<PottingLimits> {
  if (USE_MOCK) {
    mockLimits = { ...limits };
    return mockDelay({ ...mockLimits });
  }

  const rows = await listPottingLimitRows();
  const lowerRow = rows.find((r) => r.title === LOWER_LIMIT_TITLE);
  const upperRow = rows.find((r) => r.title === UPPER_LIMIT_TITLE);

  await Promise.all(
    [
      lowerRow && { row: lowerRow, value: limits.lowerLimit },
      upperRow && { row: upperRow, value: limits.upperLimit },
    ]
      .filter((x): x is { row: PottingLimitRow; value: number } => !!x)
      .map(({ row, value }) =>
        graphFetch(`/sites/${SITES.pmo}/lists/${SP_POTTING_LIMIT_LIST_ID}/items/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ fields: { Limit: value } }),
        }),
      ),
  );

  return getPottingLimits();
}

// =============================================================================
// PSR notification list
// =============================================================================

export async function listPsrNotificationPeople(): Promise<PsrNotificationPerson[]> {
  if (USE_MOCK) return mockDelay([...mockPsrList]);

  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${SP_PSR_NOTIFICATION_LIST_ID}/items?$expand=fields($select=Title,Email)`,
  );
  return items.map((item) => {
    const fields = item.fields as Record<string, unknown>;
    return {
      id: item.id,
      displayName: String(fields.Title ?? ""),
      email: String(fields.Email ?? ""),
    };
  });
}

export async function addPsrNotificationPerson(input: {
  displayName: string;
  email: string;
}): Promise<PsrNotificationPerson> {
  if (USE_MOCK) {
    const id = String(Math.max(...mockPsrList.map((p) => Number(p.id) || 0)) + 1);
    const person: PsrNotificationPerson = { id, ...input };
    mockPsrList = [...mockPsrList, person];
    return mockDelay(person);
  }

  const item = await graphFetch<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${SP_PSR_NOTIFICATION_LIST_ID}/items`,
    {
      method: "POST",
      body: JSON.stringify({ fields: { Title: input.displayName, Email: input.email } }),
    },
  );
  const fields = item.fields as Record<string, unknown>;
  return {
    id: item.id,
    displayName: String(fields.Title ?? input.displayName),
    email: String(fields.Email ?? input.email),
  };
}

export async function removePsrNotificationPerson(id: string): Promise<void> {
  if (USE_MOCK) {
    mockPsrList = mockPsrList.filter((p) => p.id !== id);
    await mockDelay(null);
    return;
  }

  await graphFetch(`/sites/${SITES.pmo}/lists/${SP_PSR_NOTIFICATION_LIST_ID}/items/${id}`, {
    method: "DELETE",
  });
}

// =============================================================================
// Out-of-limit email
// =============================================================================

async function notifyIfOutOfLimit(entry: PottingSampleEntry): Promise<void> {
  const limits = USE_MOCK ? { ...mockLimits } : await getPottingLimits();
  const breach = checkLimitBreach(entry.weight, limits);
  if (!breach) return;

  const people = USE_MOCK ? [...mockPsrList] : await listPsrNotificationPeople();
  const recipients = people.filter((p) => !!p.email);
  if (recipients.length === 0) return;

  const subject = pottingLimitAlertSubject(entry, breach);
  const html = pottingLimitAlertHtml(entry, limits, breach);

  if (USE_MOCK) {
    // eslint-disable-next-line no-console
    console.info("[email mock] potting sample out-of-limit alert:", {
      to: recipients.map((r) => r.email),
      subject,
      entry,
      limits,
      breach,
    });
    return;
  }

  if (!SHARED_MAILBOX) {
    console.warn(
      "[pottingSampleLog] VITE_SHARED_MAILBOX is not set — cannot send the out-of-limit alert.",
    );
    return;
  }

  const message = {
    subject,
    body: { contentType: "HTML", content: html },
    toRecipients: recipients.map((r) => ({
      emailAddress: { address: r.email, name: r.displayName || r.email },
    })),
  };

  await graphFetch(`/users/${encodeURIComponent(SHARED_MAILBOX)}/sendMail`, {
    method: "POST",
    body: JSON.stringify({ message, saveToSentItems: false }),
  });
}
