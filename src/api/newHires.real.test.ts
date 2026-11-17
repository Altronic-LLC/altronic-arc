import { beforeEach, describe, expect, it, vi } from "vitest";

// New Hires and HR Roles in REAL mode — none of this is visible from the mock
// branch. What's pinned:
//  - every read and write goes to the HR site's lists;
//  - an edit writes only the fields given, plus the DERIVED Status;
//  - a step is ticked after a FRESH read, and a step already ticked is never
//    re-stamped (whoever did it first did it);
//  - cancelling writes the three cancellation columns and Status;
//  - only a 404 reads as "not found" — anything else propagates.

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./graph")>();
  return { ...actual, graphFetch, graphFetchAll };
});
vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, HR_SITE_ID: "hr-site", SP_HR_ROLES_LIST_ID: "roles-list", SP_NEW_HIRES_LIST_ID: "hires-list" };
});

import { GraphError } from "./graph";
import { getNewHire, listNewHires, setNewHireCancelled, setNewHireStep, updateNewHire } from "./newHires";
import { createHrRoleEntry, listHrRoleEntries } from "./hrRoles";
import { toNewHire } from "@/lib/newHireMapper";

const actor = { displayName: "Ivy IT", email: "ivy@example.com" };

const row = (fields: Record<string, unknown> = {}) => ({
  id: "3",
  fields: { Title: "Robin Starter", LegalFirstName: "Robert", PreferredFirstName: "Robin", LastName: "Starter", NeedsComputer: true, ...fields },
});

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
});

describe("reading", () => {
  it("reads the HR site's New Hires list with its columns", async () => {
    graphFetchAll.mockResolvedValue([row()]);
    const [h] = await listNewHires();
    const url = graphFetchAll.mock.calls[0][0] as string;
    expect(url).toContain("/sites/hr-site/lists/hires-list/items?");
    expect(url).toMatch(/\$select=Title,StartDate,.*WorkEmail/);
    expect(h.displayName).toBe("Robin Starter");
  });

  it("reads one row, null only for a 404", async () => {
    graphFetch.mockRejectedValueOnce(new GraphError(404, "Not Found", "", "u"));
    expect(await getNewHire(3)).toBeNull();
    graphFetch.mockRejectedValueOnce(new GraphError(503, "Unavailable", "", "u"));
    await expect(getNewHire(3)).rejects.toThrow(/503/);
  });

  it("reads HR Roles from the HR site", async () => {
    graphFetchAll.mockResolvedValue([{ id: "1", fields: { Title: "A@Example.com", PersonName: "A", Roles: "new hire,admin" } }]);
    const [e] = await listHrRoleEntries();
    expect(graphFetchAll.mock.calls[0][0]).toContain("/sites/hr-site/lists/roles-list/items?");
    expect(e).toMatchObject({ email: "a@example.com", roles: ["new hire", "admin"] });
  });
});

describe("writing", () => {
  it("adds a role row with PersonName, never DisplayName", async () => {
    graphFetch.mockResolvedValue({ id: "9", fields: { Title: "b@example.com", PersonName: "B", Roles: "new hire it" } });
    await createHrRoleEntry({ email: "B@example.com", displayName: "B", roles: ["new hire it"], note: "" });
    const body = JSON.parse(graphFetch.mock.calls[0][1].body);
    expect(body.fields).toEqual({ Title: "b@example.com", PersonName: "B", Roles: "new hire it", Note: "" });
  });

  it("writes only the changed field and the derived status on an edit", async () => {
    const previous = toNewHire(row({ AddedToSapAt: "2026-11-01T12:00:00Z", AddedToSapBy: "S <s@example.com>" }));
    graphFetch.mockResolvedValueOnce({}).mockResolvedValueOnce(row());
    await updateNewHire(3, { deskLocation: "Desk 4" }, previous);
    const [url, init] = graphFetch.mock.calls[0];
    expect(url).toBe("/sites/hr-site/lists/hires-list/items/3/fields");
    expect(JSON.parse(init.body)).toEqual({ DeskLocation: "Desk 4", Status: "In progress" });
  });

  it("moves the status when 'computer needed' turns the last step unnecessary", async () => {
    const three = {
      AddedToSapAt: "2026-11-01T12:00:00Z",
      ItTicketRaisedAt: "2026-11-01T12:00:00Z",
      ItAccountCreatedAt: "2026-11-01T12:00:00Z",
    };
    graphFetch.mockResolvedValueOnce({}).mockResolvedValueOnce(row());
    await updateNewHire(3, { needsComputer: false }, toNewHire(row(three)));
    expect(JSON.parse(graphFetch.mock.calls[0][1].body)).toEqual({ NeedsComputer: false, Status: "Complete" });
  });

  it("ticks a step after a fresh read, stamping who and when", async () => {
    graphFetch.mockResolvedValueOnce(row()).mockResolvedValueOnce({}).mockResolvedValueOnce(row());
    await setNewHireStep(3, "itTicketRaised", true, actor);
    expect(graphFetch.mock.calls[0][0]).toContain("/items/3?$expand=fields");
    const body = JSON.parse(graphFetch.mock.calls[1][1].body);
    expect(body.ItTicketRaisedBy).toBe("Ivy IT <ivy@example.com>");
    expect(body.ItTicketRaisedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.Status).toBe("In progress");
  });

  it("never re-stamps a step somebody already ticked", async () => {
    const ticked = row({ ItTicketRaisedAt: "2026-11-01T12:00:00Z", ItTicketRaisedBy: "First <first@example.com>" });
    graphFetch.mockResolvedValueOnce(ticked);
    const after = await setNewHireStep(3, "itTicketRaised", true, actor);
    expect(graphFetch).toHaveBeenCalledTimes(1);
    expect(after.steps.itTicketRaised?.by.email).toBe("first@example.com");
  });

  it("cancels with a reason, and refuses one without", async () => {
    graphFetch.mockResolvedValueOnce(row()).mockResolvedValueOnce({}).mockResolvedValueOnce(row());
    await setNewHireCancelled(3, "Offer declined", actor);
    expect(JSON.parse(graphFetch.mock.calls[1][1].body)).toMatchObject({
      CancelledBy: "Ivy IT <ivy@example.com>",
      CancelReason: "Offer declined",
      Status: "Cancelled",
    });
    graphFetch.mockReset();
    graphFetch.mockResolvedValueOnce(row());
    await expect(setNewHireCancelled(3, "  ", actor)).rejects.toThrow(/Say why/);
  });
});
