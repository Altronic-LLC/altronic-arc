import { describe, expect, it } from "vitest";
import {
  archiveScopeParam,
  inArchiveScope,
  legacyPanelOrderId,
  panelOrderCreatedAt,
  parseArchiveScope,
  pickableOrders,
} from "./panelOrderArchive";
import type { PanelOrder } from "@/types/task";

function order(over: Partial<PanelOrder>): PanelOrder {
  return {
    id: 1,
    title: "Order",
    status: "Submitted",
    projectRef: null,
    salesOrder: "",
    sapNumber: "",
    purchaseOrder: "",
    customerReference: "",
    customer: "",
    customerContactEmail: "",
    orderNotes: "",
    engineerAssigned: null,
    watchers: [],
    comments: [],
    hasAttachments: false,
    createdAt: new Date("2026-11-13T12:00:00Z"),
    modifiedAt: new Date("2026-11-13T12:00:00Z"),
    author: null,
    archived: false,
    legacySource: "",
    legacyCreatedAt: null,
    ...over,
  };
}

describe("archive scope", () => {
  it("reads ?archived= and defaults to active", () => {
    expect(parseArchiveScope(null)).toBe("active");
    expect(parseArchiveScope("only")).toBe("archived");
    expect(parseArchiveScope("all")).toBe("all");
    expect(parseArchiveScope("nonsense")).toBe("active");
  });

  it("writes the param back, dropping it for the default", () => {
    expect(archiveScopeParam("active")).toBeNull();
    expect(archiveScopeParam("archived")).toBe("only");
    expect(archiveScopeParam("all")).toBe("all");
  });

  it("active hides archived orders, archived shows only them, all shows both", () => {
    const live = order({ id: 1 });
    const old = order({ id: 2, archived: true });
    expect([live, old].filter((o) => inArchiveScope(o, "active")).map((o) => o.id)).toEqual([1]);
    expect([live, old].filter((o) => inArchiveScope(o, "archived")).map((o) => o.id)).toEqual([2]);
    expect([live, old].filter((o) => inArchiveScope(o, "all")).map((o) => o.id)).toEqual([1, 2]);
  });
});

describe("panelOrderCreatedAt", () => {
  it("uses the old list's date when the order was moved", () => {
    const moved = order({ legacyCreatedAt: new Date("2023-08-14T14:00:00Z") });
    expect(panelOrderCreatedAt(moved).toISOString()).toBe("2023-08-14T14:00:00.000Z");
  });
  it("uses Created otherwise", () => {
    expect(panelOrderCreatedAt(order({})).toISOString()).toBe("2026-11-13T12:00:00.000Z");
  });
});

describe("legacyPanelOrderId", () => {
  it("reads the old item id", () => {
    expect(legacyPanelOrderId(order({ legacySource: "PanelJobDashboard#1984" }))).toBe(1984);
  });
  it("is null for an order made in ARC or a value it doesn't recognise", () => {
    expect(legacyPanelOrderId(order({}))).toBeNull();
    expect(legacyPanelOrderId(order({ legacySource: "Something#5" }))).toBeNull();
    expect(legacyPanelOrderId(order({ legacySource: "PanelJobDashboard#abc" }))).toBeNull();
  });
});

describe("pickableOrders", () => {
  it("leaves archived orders out, but keeps the one already chosen", () => {
    const orders = [order({ id: 1 }), order({ id: 2, archived: true }), order({ id: 3, archived: true })];
    expect(pickableOrders(orders, null).map((o) => o.id)).toEqual([1]);
    expect(pickableOrders(orders, 3).map((o) => o.id)).toEqual([1, 3]);
  });
});
