import { beforeEach, describe, expect, it, vi } from "vitest";

// The Cold Call Log's Graph requests, in REAL mode — none of this is visible
// from the mock branch: the list is on the PMO site, a read asks for every
// column ARC maps, an edit sends only what changed, and a delete of a row
// that's already gone counts as done.

const graph = vi.hoisted(() => ({ fetch: vi.fn(), fetchAll: vi.fn() }));

vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  USE_MOCK: false,
  SP_SUPPLIER_COLD_CALLS_LIST_ID: "cold-call-list",
}));
vi.mock("./graph", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./graph")>()),
  graphFetch: graph.fetch,
  graphFetchAll: graph.fetchAll,
}));

import * as api from "./supplierColdCalls";
import { GraphError } from "./graph";
import { SITES } from "./config";
import type { SupplierColdCall } from "@/types/supplierColdCall";

const base = `/sites/${SITES.pmo}/lists/cold-call-list/items`;

function row(id: number, title: string) {
  return {
    id: String(id),
    createdDateTime: "2026-11-01T12:00:00Z",
    lastModifiedDateTime: "2026-11-01T12:00:00Z",
    fields: { Title: title },
  };
}

const previous: SupplierColdCall = {
  id: 5,
  company: "Acme",
  website: "acme.example",
  commodity: "Castings",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  notes: "",
  createdBy: null,
  createdAt: new Date(),
  modifiedAt: new Date(),
};

beforeEach(() => {
  graph.fetch.mockReset();
  graph.fetchAll.mockReset();
});

describe("listSupplierColdCalls", () => {
  it("pages the whole list on the PMO site, asking for every column ARC reads", async () => {
    graph.fetchAll.mockResolvedValue([row(2, "Zenith"), row(1, "Acme")]);
    const out = await api.listSupplierColdCalls();
    const url = graph.fetchAll.mock.calls[0][0] as string;
    expect(url.startsWith(base)).toBe(true);
    expect(url).toContain("$select=Title,Website,Commodity,ContactName,ContactEmail,ContactPhone,Notes");
    expect(out.map((c) => c.company)).toEqual(["Acme", "Zenith"]);
  });
});

describe("createSupplierColdCall", () => {
  it("POSTs every column, then re-reads the row", async () => {
    graph.fetch.mockResolvedValueOnce(row(9, "Acme")).mockResolvedValueOnce(row(9, "Acme"));
    await api.createSupplierColdCall({
      company: "Acme",
      website: "acme.example",
      commodity: "Castings",
      contactName: "Dana",
      contactEmail: "",
      contactPhone: "",
      notes: "Hi",
    });
    const [url, init] = graph.fetch.mock.calls[0];
    expect(url).toBe(base);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).fields).toMatchObject({ Title: "Acme", Commodity: "Castings", Notes: "Hi" });
    expect(graph.fetch.mock.calls[1][0]).toContain(`${base}/9?$expand=fields`);
  });

  it("refuses an entry with no company before anything is sent", async () => {
    await expect(api.createSupplierColdCall({ ...previous, company: " " })).rejects.toThrow(
      /Company is required/,
    );
    expect(graph.fetch).not.toHaveBeenCalled();
  });
});

describe("updateSupplierColdCall", () => {
  it("PATCHes only the changed columns", async () => {
    graph.fetch.mockResolvedValueOnce({}).mockResolvedValueOnce(row(5, "Acme"));
    await api.updateSupplierColdCall(5, { ...previous, notes: "Called back" }, previous);
    const [url, init] = graph.fetch.mock.calls[0];
    expect(url).toBe(`${base}/5/fields`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ Notes: "Called back" });
  });

  it("sends nothing when nothing changed", async () => {
    const out = await api.updateSupplierColdCall(5, { ...previous }, previous);
    expect(graph.fetch).not.toHaveBeenCalled();
    expect(out.company).toBe("Acme");
  });
});

describe("deleteSupplierColdCall", () => {
  it("DELETEs the item; a 404 counts as done, anything else throws", async () => {
    graph.fetch.mockResolvedValueOnce(undefined);
    await api.deleteSupplierColdCall(5);
    expect(graph.fetch.mock.calls[0]).toEqual([`${base}/5`, { method: "DELETE" }]);

    graph.fetch.mockRejectedValueOnce(new GraphError(404, "Not Found", "", "u"));
    await expect(api.deleteSupplierColdCall(5)).resolves.toBeUndefined();

    graph.fetch.mockRejectedValueOnce(new GraphError(403, "Forbidden", "accessDenied", "u"));
    await expect(api.deleteSupplierColdCall(5)).rejects.toThrow(/403/);
  });
});
