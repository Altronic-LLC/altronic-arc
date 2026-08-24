import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// The SharePoint side of Open Orders, asserted at the REQUEST level with
// USE_MOCK forced off — the mock branch is what hides this class of bug.
//
// Three things here are load-bearing and invisible from a rendered page:
//
//  1. **conflictBehavior on a FOLDER must not be `replace`.** On a file that
//     means overwrite, which is what the workbooks want. On a folder it means
//     replace the folder — potentially taking its contents with it, so
//     re-running a week could delete the customer files already in it.
//  2. **The path is addressed per-segment-encoded**, because the folder names
//     contain spaces.
//  3. **A download falls back to an unselected read**, because
//     @microsoft.graph.downloadUrl is an instance annotation and a $select'd
//     response is not something to bet a download on.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll: vi.fn(async () => []),
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  // Force the REAL branch.
  return { ...actual, USE_MOCK: false };
});

import {
  OPEN_ORDERS_PATH,
  RAW_UPLOADS_FOLDER,
  downloadOpenOrdersFile,
  ensureRawUploadsFolder,
  ensureWeekFolder,
  listMasterReports,
  listWeeks,
  uploadOpenOrdersFile,
  uploadRawExtract,
  weekOfFromName,
} from "./openOrdersFiles";

beforeEach(() => {
  graphFetch.mockReset();
  graphFetch.mockResolvedValue({ id: "1", name: "x", value: [] });
});

/** The (path, init) of the nth graphFetch call. */
function call(n = 0): { path: string; init: RequestInit } {
  const [path, init] = graphFetch.mock.calls[n] ?? [];
  return { path: String(path ?? ""), init: (init ?? {}) as RequestInit };
}

function bodyOf(n = 0): Record<string, unknown> {
  const raw = call(n).init.body;
  return typeof raw === "string" ? JSON.parse(raw) : {};
}

describe("the folder path", () => {
  it("is the one derived from the OneDrive sync mapping", () => {
    expect(OPEN_ORDERS_PATH).toBe("General/Order Management/OPEN ORDERS");
  });

  // The folder names contain spaces; unencoded they break the request, and
  // encoding the whole path would eat the separating slashes.
  it("percent-encodes each segment but keeps the slashes", async () => {
    await listMasterReports();
    expect(call().path).toContain("General/Order%20Management/OPEN%20ORDERS");
    expect(call().path).not.toContain("General%2FOrder");
  });

  it("reads the drive of the Sales site", async () => {
    await listMasterReports();
    expect(call().path).toMatch(/^\/sites\/[^/]+\/drive\/root:/);
  });
});

describe("creating the week folder", () => {
  // THE ONE THAT MATTERS. `replace` on a folder can take the folder's contents
  // with it, so a re-run would delete the week's customer files.
  it("never uses conflictBehavior replace on a folder", async () => {
    await ensureWeekFolder(new Date("2026-08-19T12:00:00Z"));
    expect(bodyOf()["@microsoft.graph.conflictBehavior"]).not.toBe("replace");
    expect(bodyOf()["@microsoft.graph.conflictBehavior"]).toBe("fail");
  });

  it("names the folder after the Monday of that week", async () => {
    // A Wednesday.
    await ensureWeekFolder(new Date("2026-08-19T12:00:00Z"));
    expect(bodyOf().name).toBe("Week of 2026-08-17");
    expect(bodyOf().folder).toEqual({});
  });

  // Idempotent without `replace`: an existing folder is the desired end state.
  it("treats an existing folder as success", async () => {
    graphFetch.mockRejectedValueOnce(new Error("Graph 409 nameAlreadyExists"));
    await expect(ensureWeekFolder(new Date("2026-08-19T12:00:00Z"))).resolves.toBe(
      "Week of 2026-08-17",
    );
  });

  // A permission failure must NOT be swallowed as "already there" — that would
  // send the run on to upload files that then all fail.
  it("rethrows anything that isn't a name conflict", async () => {
    graphFetch.mockRejectedValueOnce(new Error("Graph 403 accessDenied"));
    await expect(ensureWeekFolder(new Date("2026-08-19T12:00:00Z"))).rejects.toThrow(/403/);
  });

  it("creates RAW UPLOADS the same careful way", async () => {
    await ensureRawUploadsFolder();
    expect(bodyOf().name).toBe(RAW_UPLOADS_FOLDER);
    expect(bodyOf()["@microsoft.graph.conflictBehavior"]).toBe("fail");
  });
});

describe("uploading a generated workbook", () => {
  const body = new ArrayBuffer(64);

  // On a FILE, replace is right: re-running a week refreshes that week's
  // workbook rather than leaving "…(1).xlsx" beside it, which nobody could
  // tell apart.
  it("replaces the file, so a re-run refreshes rather than duplicates", async () => {
    await uploadOpenOrdersFile({ filename: "master.xlsx", body });
    expect(call().path).toContain("@microsoft.graph.conflictBehavior=replace");
    expect(call().init.method).toBe("PUT");
  });

  it("sends the xlsx content type, overriding the JSON default", async () => {
    await uploadOpenOrdersFile({ filename: "master.xlsx", body });
    const headers = call().init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("puts a master at the root and a customer file in its week folder", async () => {
    await uploadOpenOrdersFile({ filename: "master.xlsx", body });
    expect(call().path).toContain("OPEN%20ORDERS/master.xlsx");

    graphFetch.mockClear();
    await uploadOpenOrdersFile({
      folder: "Week of 2026-08-17",
      filename: "Acme_Open_Orders_2026-08-21.xlsx",
      body,
    });
    expect(call().path).toContain("Week%20of%202026-08-17/Acme_Open_Orders_2026-08-21.xlsx");
  });

  it("refuses a body over the single-request limit rather than failing mid-PUT", async () => {
    await expect(
      uploadOpenOrdersFile({ filename: "huge.xlsx", body: new ArrayBuffer(5 * 1024 * 1024) }),
    ).rejects.toThrow(/single-request limit/);
    expect(graphFetch).not.toHaveBeenCalled();
  });

  // Two extracts pulled on the same day are two different sets of facts, so
  // the raw file is renamed rather than overwritten.
  it("renames a clashing raw extract instead of replacing it", async () => {
    await uploadRawExtract("OOR 8-21-2026.xlsx", new ArrayBuffer(32));
    const put = graphFetch.mock.calls.find((c) => String(c[0]).includes("RAW%20UPLOADS/OOR"));
    expect(String(put?.[0])).toContain("@microsoft.graph.conflictBehavior=rename");
  });
});

describe("downloading", () => {
  it("falls back to an unselected read when the selected one carries no link", async () => {
    graphFetch
      .mockResolvedValueOnce({ id: "1", name: "x" }) // $select'd, no annotation
      .mockResolvedValueOnce({ id: "1", name: "x", "@microsoft.graph.downloadUrl": "https://dl/x" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("bytes", { status: 200 }));
    try {
      await downloadOpenOrdersFile("item-1");
      expect(graphFetch).toHaveBeenCalledTimes(2);
      // The second read is deliberately WITHOUT $select.
      expect(call(1).path).not.toContain("$select");
      expect(fetchSpy).toHaveBeenCalledWith("https://dl/x");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("says so plainly when there is genuinely no link", async () => {
    graphFetch.mockResolvedValue({ id: "1", name: "x" });
    await expect(downloadOpenOrdersFile("item-1")).rejects.toThrow(/no download link/);
  });

  it("reports a failed download with its status", async () => {
    graphFetch.mockResolvedValue({
      id: "1",
      name: "x",
      "@microsoft.graph.downloadUrl": "https://dl/x",
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 404 }));
    try {
      await expect(downloadOpenOrdersFile("item-1")).rejects.toThrow(/404/);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("listing", () => {
  it("keeps folders out of the report lists", async () => {
    graphFetch.mockResolvedValue({
      value: [
        { id: "1", name: "RAW UPLOADS", folder: { childCount: 0 } },
        { id: "2", name: "Week of 2026-08-17", folder: { childCount: 8 } },
        { id: "3", name: "Altronic_Open_Orders_Dashboard_2026-08-21.xlsx", size: 1, file: {} },
      ],
    });
    const masters = await listMasterReports();
    expect(masters.map((f) => f.name)).toEqual([
      "Altronic_Open_Orders_Dashboard_2026-08-21.xlsx",
    ]);
  });

  it("lists the weeks newest first, and never RAW UPLOADS as a week", async () => {
    graphFetch.mockResolvedValue({
      value: [
        { id: "1", name: "Week of 2026-08-10", folder: { childCount: 7 } },
        { id: "2", name: "RAW UPLOADS", folder: { childCount: 3 } },
        { id: "3", name: "Week of 2026-08-17", folder: { childCount: 8 } },
      ],
    });
    const weeks = await listWeeks();
    expect(weeks.map((w) => w.name)).toEqual(["Week of 2026-08-17", "Week of 2026-08-10"]);
  });
});

describe("weekOfFromName", () => {
  it("reads the date out of the folder name", () => {
    expect(weekOfFromName("Week of 2026-08-17")).toEqual(new Date(Date.UTC(2026, 7, 17, 12)));
  });

  it("is null for a folder somebody named by hand", () => {
    expect(weekOfFromName("old stuff")).toBeNull();
  });
});
