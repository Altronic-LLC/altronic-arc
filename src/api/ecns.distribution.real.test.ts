import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// ECN distribution (BusinessIT#57) in REAL mode — the request shapes, which no
// mock-mode test or rendered page can see:
//
//  - Distribution is a MULTI-choice column, so every write carries the
//    Collection(Edm.String) annotation (a bare array is a bare 400).
//  - The three columns are added by a script that runs apart from a deploy,
//    so a read asks for them and, on a 400, retries once without — the ECN
//    list must never go blank because the script hasn't run yet.
// =============================================================================

const { graphFetch, graphFetchAll, GraphError } = vi.hoisted(() => {
  class GraphError extends Error {
    constructor(public status: number) {
      super(`Graph ${status}`);
    }
  }
  return { graphFetch: vi.fn(), graphFetchAll: vi.fn(), GraphError };
});

vi.mock("./graph", () => ({ graphFetch, graphFetchAll, GraphError }));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, SP_ECNS_LIST_ID: "ecn-list" };
});

import { __resetEcnsForTests, createEcn, ecnDistributionAvailable, listEcns, updateEcnFields } from "./ecns";

const ROW = { id: "7", fields: { Title: "x", field_2: "260100", Distribution: ["Sales", "Quality Manager"] } };

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body);
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  __resetEcnsForTests();
});

describe("reading", () => {
  it("asks for the three distribution columns, and maps them in the form's order", async () => {
    graphFetchAll.mockResolvedValueOnce([ROW]);
    const [ecn] = await listEcns();
    const url = graphFetchAll.mock.calls[0][0] as string;
    expect(url).toContain("Distribution,DistributedTo,DistributedAt");
    expect(ecn.distribution).toEqual(["Quality Manager", "Sales"]);
    expect(ecn.distributedAt).toBeNull();
  });

  it("falls back to a read without them on a 400, and remembers", async () => {
    graphFetchAll.mockRejectedValueOnce(new GraphError(400)).mockResolvedValue([{ id: "7", fields: { Title: "x" } }]);
    const ecns = await listEcns();
    expect(ecns).toHaveLength(1);
    expect(graphFetchAll.mock.calls[1][0]).not.toContain("Distribution");
    expect(ecnDistributionAvailable()).toBe(false);
    await listEcns();
    // Straight to the slim read — the doomed request isn't repeated.
    expect(graphFetchAll).toHaveBeenCalledTimes(3);
    expect(graphFetchAll.mock.calls[2][0]).not.toContain("Distribution");
  });

  it("does NOT fall back on anything but a 400 — a throttle must not read as 'no distribution'", async () => {
    graphFetchAll.mockRejectedValueOnce(new GraphError(429));
    await expect(listEcns()).rejects.toThrow("Graph 429");
    expect(graphFetchAll).toHaveBeenCalledTimes(1);
    expect(ecnDistributionAvailable()).toBe(true);
  });
});

describe("writing", () => {
  it("annotates Distribution on a create", async () => {
    graphFetch.mockResolvedValueOnce({ id: "7" }).mockResolvedValueOnce(ROW);
    await createEcn({ title: "x", logNo: "260100", projectLookupId: null, values: {}, distribution: ["Sales"] });
    const fields = bodyOf(graphFetch.mock.calls[0]).fields as Record<string, unknown>;
    expect(fields.Distribution).toEqual(["Sales"]);
    expect(fields["Distribution@odata.type"]).toBe("Collection(Edm.String)");
  });

  it("annotates Distribution on a PATCH, an empty list included (that's how it clears)", async () => {
    graphFetch.mockResolvedValueOnce(undefined).mockResolvedValueOnce(ROW);
    await updateEcnFields(7, { Distribution: [] });
    const body = bodyOf(graphFetch.mock.calls[0]);
    expect(body.Distribution).toEqual([]);
    expect(body["Distribution@odata.type"]).toBe("Collection(Edm.String)");
  });

  it("leaves the ticks off a create when the list hasn't got the column — the ECN is still raised", async () => {
    graphFetchAll.mockRejectedValueOnce(new GraphError(400)).mockResolvedValue([]);
    await listEcns();
    graphFetch.mockResolvedValueOnce({ id: "7" }).mockRejectedValueOnce(new GraphError(400)).mockResolvedValueOnce(ROW);
    await createEcn({ title: "x", logNo: "260100", projectLookupId: null, values: {}, distribution: ["Sales"] });
    const fields = bodyOf(graphFetch.mock.calls[0]).fields as Record<string, unknown>;
    expect(fields).not.toHaveProperty("Distribution");
  });

  it("refuses to write a distribution column the list hasn't got, naming the script", async () => {
    graphFetchAll.mockRejectedValueOnce(new GraphError(400)).mockResolvedValue([]);
    await listEcns();
    await expect(updateEcnFields(7, { DistributedTo: "a@example.com" })).rejects.toThrow(
      /create-ecn-distribution\.ps1/,
    );
    expect(graphFetch).not.toHaveBeenCalled();
  });
});
