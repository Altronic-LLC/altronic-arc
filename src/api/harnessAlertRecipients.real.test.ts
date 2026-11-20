import { beforeEach, describe, expect, it, vi } from "vitest";

// Harness Alert Recipients in REAL mode: what is read, what is written, and
// that a duplicate is refused before any write.

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));
vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  USE_MOCK: false,
  SP_HARNESS_ALERT_RECIPIENTS_LIST_ID: "recipients-list",
}));

import { addHarnessAlertRecipient, listHarnessAlertRecipients } from "./harnessAlertRecipients";

const row = (id: string, fields: Record<string, unknown>) => ({ id, fields });

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
});

describe("listHarnessAlertRecipients (real mode)", () => {
  it("drops a row with no email or an alert ARC doesn't know", async () => {
    graphFetchAll.mockResolvedValue([
      row("1", { Title: "Lead", Email: "lead@example.com", Alert: "Part number request" }),
      row("2", { Title: "No email", Email: "", Alert: "Crimp out of spec" }),
      row("3", { Title: "Odd", Email: "odd@example.com", Alert: "Lunch" }),
    ]);
    const rows = await listHarnessAlertRecipients();
    expect(rows.map((r) => r.id)).toEqual([1]);
    expect(graphFetchAll.mock.calls[0][0]).toContain("/lists/recipients-list/items");
  });
});

describe("addHarnessAlertRecipient (real mode)", () => {
  it("POSTs Title, Email and Alert", async () => {
    graphFetchAll.mockResolvedValue([]);
    graphFetch.mockResolvedValue(row("7", { Title: "Lead", Email: "lead@example.com", Alert: "Crimp out of spec" }));
    await addHarnessAlertRecipient({ name: "Lead", email: "lead@example.com", alert: "Crimp out of spec" });
    expect(JSON.parse(graphFetch.mock.calls[0][1].body as string)).toEqual({
      fields: { Title: "Lead", Email: "lead@example.com", Alert: "Crimp out of spec" },
    });
  });

  it("refuses somebody already on that alert, before writing", async () => {
    graphFetchAll.mockResolvedValue([row("1", { Title: "Lead", Email: "LEAD@example.com", Alert: "Crimp out of spec" })]);
    await expect(
      addHarnessAlertRecipient({ name: "Lead", email: "lead@example.com", alert: "Crimp out of spec" }),
    ).rejects.toThrow(/already told/);
    expect(graphFetch).not.toHaveBeenCalled();
  });
});
