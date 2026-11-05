import { beforeEach, describe, expect, it, vi } from "vitest";

// Real-mode request shapes for Panel Time Off — invisible from the demo
// store. TeamMember is a SINGLE person column: both halves selected, written
// as a bare integer resolved on the PANEL site, refused when unresolvable.

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const resolveSiteUserLookupId = vi.hoisted(() => vi.fn());
const listPanelSiteUsers = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({ graphFetch, graphFetchAll }));
vi.mock("./siteUsers", () => ({ resolveSiteUserLookupId }));
vi.mock("./panelOrders", () => ({ listPanelSiteUsers }));
vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, panelTeam: "panel-site" },
    SP_PANELTEAM_SITE_URL: "https://example/sites/panel",
    SP_PANEL_TIME_OFF_LIST_ID: "time-off-list",
  };
});

import { createPanelTimeOff, listPanelTimeOff, panelTimeOffProblem } from "./panelTimeOff";

const ANA = { displayName: "Ana", email: "ana@example.com", lookupId: 999 };
const day = (k: string) => new Date(`${k}T12:00:00Z`);

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  resolveSiteUserLookupId.mockReset();
  listPanelSiteUsers.mockReset();
  listPanelSiteUsers.mockResolvedValue(new Map([[7, { displayName: "Ana", email: "ana@example.com", lookupId: 7 }]]));
});

describe("listPanelTimeOff", () => {
  it("selects both halves of the person column and joins the name", async () => {
    graphFetchAll.mockResolvedValue([
      {
        id: "3",
        fields: {
          Title: "Vacation",
          TeamMemberLookupId: "7",
          StartDate: "2026-11-02T12:00:00Z",
          EndDate: "2026-11-03T12:00:00Z",
          HoursPerDay: null,
        },
      },
      { id: "4", fields: { TeamMemberLookupId: "88", HoursPerDay: "4" } },
    ]);
    const rows = await listPanelTimeOff();
    expect(graphFetchAll.mock.calls[0][0]).toContain("/sites/panel-site/lists/time-off-list/items");
    expect(graphFetchAll.mock.calls[0][0]).toContain("TeamMember,TeamMemberLookupId");
    expect(rows[0]).toMatchObject({ id: 3, reason: "Vacation", hoursPerDay: null });
    expect(rows[0].person?.displayName).toBe("Ana");
    // A set column never reads as empty.
    expect(rows[1].person?.displayName).toBe("User #88");
    expect(rows[1].hoursPerDay).toBe(4);
  });
});

describe("createPanelTimeOff", () => {
  const input = {
    person: ANA,
    reason: " Vacation ",
    startDate: day("2026-11-02"),
    endDate: day("2026-11-03"),
    hoursPerDay: null,
    companyHoliday: false,
  };

  it("writes a bare lookupId resolved on the panel site — not the id it arrived with", async () => {
    resolveSiteUserLookupId.mockResolvedValue(7);
    graphFetch.mockResolvedValue({ id: "9", fields: {} });
    await createPanelTimeOff(input);
    expect(resolveSiteUserLookupId).toHaveBeenCalledWith(
      "panel-site",
      "https://example/sites/panel",
      "ana@example.com",
    );
    const body = JSON.parse(graphFetch.mock.calls[0][1].body);
    expect(body.fields).toEqual({
      Title: "Vacation",
      TeamMemberLookupId: 7,
      StartDate: "2026-11-02T12:00:00Z",
      EndDate: "2026-11-03T12:00:00Z",
      HoursPerDay: null,
      CompanyHoliday: false,
    });
  });

  it("refuses rather than writing nobody when the person can't be resolved", async () => {
    resolveSiteUserLookupId.mockResolvedValue(0);
    await expect(createPanelTimeOff(input)).rejects.toThrow(/Couldn't find Ana/);
    expect(graphFetch).not.toHaveBeenCalled();
  });
});

describe("panelTimeOffProblem", () => {
  it("checks who, the days, and the hours", () => {
    const ok = { person: ANA, startDate: day("2026-11-02"), endDate: day("2026-11-02"), hoursPerDay: null };
    expect(panelTimeOffProblem(ok)).toBeNull();
    expect(panelTimeOffProblem({ ...ok, person: undefined })).toMatch(/who/);
    expect(panelTimeOffProblem({ ...ok, endDate: day("2026-11-01") })).toMatch(/before/);
    expect(panelTimeOffProblem({ ...ok, hoursPerDay: 0 })).toMatch(/more than 0/);
    expect(panelTimeOffProblem({ ...ok, hoursPerDay: Number.NaN })).toMatch(/more than 0/);
  });

  it("needs no person on a company holiday", () => {
    const holiday = { person: null, startDate: day("2026-12-25"), endDate: day("2026-12-25"), hoursPerDay: null };
    expect(panelTimeOffProblem({ ...holiday, companyHoliday: true })).toBeNull();
    expect(panelTimeOffProblem({ ...holiday, companyHoliday: false })).toMatch(/who/);
  });
});

describe("a company holiday (real mode)", () => {
  it("writes no person, CompanyHoliday Yes, and never looks anybody up", async () => {
    graphFetch.mockResolvedValue({ id: "9", fields: { CompanyHoliday: true } });
    const saved = await createPanelTimeOff({
      person: null,
      reason: "Christmas",
      startDate: day("2026-12-25"),
      endDate: day("2026-12-25"),
      hoursPerDay: null,
      companyHoliday: true,
    });
    expect(resolveSiteUserLookupId).not.toHaveBeenCalled();
    expect(JSON.parse(graphFetch.mock.calls[0][1].body).fields).toEqual({
      Title: "Christmas",
      TeamMemberLookupId: null,
      CompanyHoliday: true,
      StartDate: "2026-12-25T12:00:00Z",
      EndDate: "2026-12-25T12:00:00Z",
      HoursPerDay: null,
    });
    expect(saved).toMatchObject({ person: null, companyHoliday: true });
  });

  it("selects CompanyHoliday and reads it", async () => {
    graphFetchAll.mockResolvedValueOnce([{ id: "3", fields: { Title: "Shutdown", CompanyHoliday: true } }]);
    const [row] = await listPanelTimeOff();
    expect(graphFetchAll.mock.calls.at(-1)?.[0]).toContain("CompanyHoliday");
    expect(row).toMatchObject({ companyHoliday: true, person: null });
  });
});
