import { describe, expect, it } from "vitest";
import type { Person } from "@/types/task";
import type { PricingRole, PricingRoleEntry } from "@/types/pricing";
import type { ChangeTarget } from "./changeAlerts";
import {
  buildAddedToSapEmails,
  buildPricedEmails,
  buildPricingRequestRaisedEmails,
  pricingManagersOrAdmins,
  pricingPeople,
  requestDetails,
} from "./pricingAlerts";

const target: ChangeTarget = { kind: "pricingRequest", id: 7, title: "PR-2026-0007" };

let nextId = 1;
function role(email: string, roles: PricingRole[], displayName = ""): PricingRoleEntry {
  return { id: nextId++, email, displayName, roles, note: "" };
}

const MANAGER: Person = { displayName: "Mia Manager", email: "mia@altronic-llc.com" };
const ADMIN: Person = { displayName: "Adam Admin", email: "adam@altronic-llc.com" };
const REQUESTER: Person = { displayName: "Rita Requester", email: "rita@altronic-llc.com" };

const ROLES: PricingRoleEntry[] = [
  role(MANAGER.email!, ["manager"], MANAGER.displayName),
  role(ADMIN.email!, ["admin"], ADMIN.displayName),
  role(REQUESTER.email!, ["requester"], REQUESTER.displayName),
];

const emails = (out: { email: string }[]) => out.map((e) => e.email);

describe("pricingPeople / pricingManagersOrAdmins", () => {
  it("lists holders of the TAG itself (an admin is not listed as a manager)", () => {
    expect(pricingPeople(ROLES, "manager")).toEqual([MANAGER]);
    expect(pricingPeople(ROLES, "admin")).toEqual([ADMIN]);
  });

  it("falls back to the email for a missing name, and skips a row with no email", () => {
    expect(pricingPeople([role("x@a.com", ["admin"]), role("", ["admin"], "Nobody")], "admin")).toEqual([
      { displayName: "x@a.com", email: "x@a.com" },
    ]);
  });

  it("asks the admins when nobody holds manager", () => {
    expect(pricingManagersOrAdmins(ROLES)).toEqual([MANAGER]);
    expect(pricingManagersOrAdmins([role(ADMIN.email!, ["admin"], ADMIN.displayName)])).toEqual([ADMIN]);
    expect(pricingManagersOrAdmins([])).toEqual([]);
  });
});

describe("requestDetails", () => {
  it("names the customer with their sold-to when there is one", () => {
    const d = requestDetails({
      altronicPartNumber: "A",
      sapPartNumber: "S",
      description: "D",
      customerName: "Acme",
      customerSoldTo: "100",
    });
    expect(d.find((x) => x.label === "Customer")!.value).toBe("Acme (100)");
    expect(
      requestDetails({ altronicPartNumber: "", sapPartNumber: "", description: "", customerName: "Acme", customerSoldTo: "" })
        .find((x) => x.label === "Customer")!.value,
    ).toBe("Acme");
  });
});

describe("buildPricingRequestRaisedEmails", () => {
  it("in SAP: the managers are asked to price it, and the requester gets a receipt", () => {
    const out = buildPricingRequestRaisedEmails({ target, actor: REQUESTER, requester: REQUESTER, roles: ROLES, inSap: true });
    expect(emails(out)).toEqual([MANAGER.email, REQUESTER.email]);
    expect(out[0].subject).toBe("New pricing request: PR-2026-0007");
    expect(out[0].headlineHtml).toMatch(/ready to price/);
    expect(out[1].subject).toBe("Pricing request received: PR-2026-0007");
    expect(out[1].headlineHtml).toMatch(/sent to the pricing managers/);
  });

  it("in SAP with no manager on the list: the admins are asked instead", () => {
    const roles = [role(ADMIN.email!, ["admin"], ADMIN.displayName)];
    const out = buildPricingRequestRaisedEmails({ target, actor: REQUESTER, requester: REQUESTER, roles, inSap: true });
    expect(emails(out)).toEqual([ADMIN.email, REQUESTER.email]);
  });

  it("NOT in SAP: the admins are asked to set it up, and the receipt says so", () => {
    const out = buildPricingRequestRaisedEmails({ target, actor: REQUESTER, requester: REQUESTER, roles: ROLES, inSap: false });
    expect(emails(out)).toEqual([ADMIN.email, REQUESTER.email]);
    expect(out[0].subject).toBe("Set up in SAP: PR-2026-0007");
    expect(out[0].headlineHtml).toMatch(/Added to SAP/);
    expect(out[1].headlineHtml).toMatch(/isn't in SAP yet/);
  });

  it("drops the actor from the queue only when somebody else is left", () => {
    const roles = [role(MANAGER.email!, ["manager"], MANAGER.displayName), role("m2@altronic-llc.com", ["manager"], "M2")];
    const out = buildPricingRequestRaisedEmails({ target, actor: MANAGER, requester: null, roles, inSap: true });
    expect(emails(out)).toEqual(["m2@altronic-llc.com"]);

    const solo = buildPricingRequestRaisedEmails({
      target,
      actor: MANAGER,
      requester: null,
      roles: [role(MANAGER.email!, ["manager"], MANAGER.displayName)],
      inSap: true,
    });
    expect(emails(solo)).toEqual([MANAGER.email]);
  });

  it("sends ONE email to a requester who is also a manager — the queue's", () => {
    const out = buildPricingRequestRaisedEmails({
      target,
      actor: { displayName: "Someone", email: "someone@altronic-llc.com" },
      requester: { displayName: "Mia", email: "MIA@altronic-llc.com" },
      roles: ROLES,
      inSap: true,
    });
    expect(out).toHaveLength(1);
    expect(out[0].subject).toMatch(/^New pricing request/);
  });

  it("sends no receipt when there is no requester address", () => {
    const out = buildPricingRequestRaisedEmails({
      target,
      actor: REQUESTER,
      requester: { displayName: "No Mail" },
      roles: ROLES,
      inSap: true,
    });
    expect(emails(out)).toEqual([MANAGER.email]);
  });

  it("escapes names and drops blank details", () => {
    const out = buildPricingRequestRaisedEmails({
      target,
      actor: { displayName: "<b>x</b>", email: "x@a.com" },
      requester: null,
      roles: ROLES,
      inSap: true,
      details: [
        { label: "Altronic part #", value: "791950-08" },
        { label: "SAP part #", value: "  " },
      ],
    });
    expect(out[0].headlineHtml).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(out[0].detailHtml).toContain("791950-08");
    expect(out[0].detailHtml).not.toContain("SAP part #");
  });
});

describe("buildAddedToSapEmails", () => {
  it("tells the managers it's ready to price, and the requester it's in SAP", () => {
    const out = buildAddedToSapEmails({ target, actor: ADMIN, requester: REQUESTER, roles: ROLES, sapPartNumber: "1000-0000-08" });
    expect(emails(out)).toEqual([MANAGER.email, REQUESTER.email]);
    expect(out[0].subject).toBe("Ready to price: PR-2026-0007");
    expect(out[0].headlineHtml).toContain("1000-0000-08");
    expect(out[1].subject).toBe("In SAP now: PR-2026-0007");
  });

  it("doesn't tell a requester who pressed it themselves, or one already told as a manager", () => {
    expect(
      emails(buildAddedToSapEmails({ target, actor: REQUESTER, requester: REQUESTER, roles: ROLES, sapPartNumber: "S" })),
    ).toEqual([MANAGER.email]);
    expect(
      emails(buildAddedToSapEmails({ target, actor: ADMIN, requester: MANAGER, roles: ROLES, sapPartNumber: "S" })),
    ).toEqual([MANAGER.email]);
  });
});

describe("buildPricedEmails", () => {
  const base = {
    target,
    listPrice: 253,
    customerName: "Acme",
    customerPrice: 227.7,
    repriced: false,
  };

  it("tells the requester and watchers, de-duplicated", () => {
    const out = buildPricedEmails({
      ...base,
      actor: MANAGER,
      requester: REQUESTER,
      watchers: [{ displayName: "Rita again", email: "RITA@altronic-llc.com" }, ADMIN],
    });
    expect(emails(out)).toEqual([REQUESTER.email, ADMIN.email]);
    expect(out[0].subject).toBe("Priced: PR-2026-0007");
    expect(out[0].detailHtml).toContain("$253.00");
    expect(out[0].detailHtml).toContain("$227.70");
    expect(out[0].detailHtml).toContain("Acme");
  });

  it("says whether the part stays Contact Factory — and says nothing when it wasn't answered", () => {
    const args = { ...base, actor: MANAGER, requester: REQUESTER, watchers: [] };
    expect(buildPricedEmails({ ...args, leaveAsContactFactory: true })[0].detailHtml).toContain("Leave as Contact Factory: <strong>Yes</strong>");
    expect(buildPricedEmails({ ...args, leaveAsContactFactory: false })[0].detailHtml).toContain("Leave as Contact Factory: <strong>No</strong>");
    expect(buildPricedEmails({ ...args, leaveAsContactFactory: null })[0].detailHtml).not.toContain("Contact Factory");
  });

  it("drops the actor STRICTLY — even when that leaves nobody", () => {
    const out = buildPricedEmails({ ...base, actor: MANAGER, requester: MANAGER, watchers: [MANAGER] });
    expect(out).toEqual([]);
  });

  it("says Re-priced on a re-price, and omits the customer line with no customer price", () => {
    const out = buildPricedEmails({
      ...base,
      repriced: true,
      customerPrice: null,
      actor: MANAGER,
      requester: REQUESTER,
      watchers: [],
    });
    expect(out[0].subject).toBe("Re-priced: PR-2026-0007");
    expect(out[0].headlineHtml).toMatch(/changed the price/);
    expect(out[0].detailHtml).not.toContain("Price for");
  });

  it("skips people with no address", () => {
    const out = buildPricedEmails({ ...base, actor: MANAGER, requester: { displayName: "No mail" }, watchers: [] });
    expect(out).toEqual([]);
  });
});
