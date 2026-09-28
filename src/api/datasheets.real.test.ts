import { beforeEach, describe, expect, it, vi } from "vitest";

// Datasheet lookup in REAL mode — the drive path, and what counts as "none".

const graphFetch = vi.hoisted(() => vi.fn());
const FakeGraphError = vi.hoisted(
  () =>
    class GraphError extends Error {
      constructor(public status: number) {
        super(`Graph ${status}`);
      }
    },
);

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll: vi.fn(),
  GraphError: FakeGraphError,
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, SITES: { ...actual.SITES, engineering: "engineering-site" } };
});

import { DatasheetExistsError, findDatasheet, uploadDatasheet } from "./datasheets";

// A BLOCK body, not `() => graphFetch.mockReset()`: mockReset returns the mock,
// and Vitest runs a function returned from beforeEach as the test's CLEANUP —
// calling the mock after the test, which then throws whatever the test set up.
beforeEach(() => {
  graphFetch.mockReset();
});

describe("findDatasheet (real mode)", () => {
  it("asks for <part #>.pdf in General/Datasheets on the Engineering site's library", async () => {
    graphFetch.mockResolvedValue({ name: "601110.pdf", webUrl: "https://sp/601110.pdf", size: 10, file: {} });
    const sheet = await findDatasheet("601110");
    expect(graphFetch.mock.calls[0][0]).toBe(
      "/sites/engineering-site/drive/root:/General/Datasheets/601110.pdf?$select=name,webUrl,size,file",
    );
    expect(sheet).toEqual({ name: "601110.pdf", webUrl: "https://sp/601110.pdf", size: 10 });
  });

  it("encodes a part number that isn't plain digits", async () => {
    graphFetch.mockResolvedValue({ name: "x", webUrl: "u", file: {} });
    await findDatasheet("601427 HT#2");
    expect(graphFetch.mock.calls[0][0]).toContain("/General/Datasheets/601427%20HT%232.pdf?");
  });

  it("reads a 404 as no datasheet", async () => {
    graphFetch.mockRejectedValue(new FakeGraphError(404));
    expect(await findDatasheet("722633")).toBeNull();
  });

  it("doesn't count a FOLDER of that name as a datasheet", async () => {
    graphFetch.mockResolvedValue({ name: "601110.pdf", webUrl: "u", folder: {} });
    expect(await findDatasheet("601110")).toBeNull();
  });

  it("lets a refusal through, so 'couldn't look' never reads as 'there is none'", async () => {
    graphFetch.mockRejectedValue(new FakeGraphError(403));
    await expect(findDatasheet("601110")).rejects.toThrow();
  });

  it("doesn't ask for a blank part number", async () => {
    expect(await findDatasheet("  ")).toBeNull();
    expect(graphFetch).not.toHaveBeenCalled();
  });
});

describe("uploadDatasheet (real mode)", () => {
  const pdf = (bytes = 4) => new File([new Uint8Array(bytes)], "anything.pdf", { type: "application/pdf" });

  it("PUTs the file as <part #>.pdf in General/Datasheets, refusing to overwrite", async () => {
    graphFetch.mockResolvedValue({ id: "x", name: "604613.pdf", webUrl: "https://sp/604613.pdf", size: 4 });
    const sheet = await uploadDatasheet("604613", pdf());
    const [path, init] = graphFetch.mock.calls[0];
    expect(path).toBe(
      "/sites/engineering-site/drive/root:/General/Datasheets/604613.pdf:/content?@microsoft.graph.conflictBehavior=fail",
    );
    expect(init.method).toBe("PUT");
    expect(sheet).toEqual({ name: "604613.pdf", webUrl: "https://sp/604613.pdf", size: 4 });
  });

  it("names the file after the part number, not whatever the PDF was called", async () => {
    graphFetch.mockResolvedValue({ id: "x", name: "701711.pdf", webUrl: "u" });
    await uploadDatasheet(" 701711 ", new File(["%PDF"], "EPCOS B82789C0.pdf", { type: "application/pdf" }));
    expect(graphFetch.mock.calls[0][0]).toContain("/General/Datasheets/701711.pdf:/content");
  });

  it("reports a name that's already taken as DatasheetExistsError, not a raw 409", async () => {
    graphFetch.mockRejectedValue(new FakeGraphError(409));
    await expect(uploadDatasheet("601110", pdf())).rejects.toBeInstanceOf(DatasheetExistsError);
  });

  it("lets any other failure through as itself", async () => {
    graphFetch.mockRejectedValue(new FakeGraphError(403));
    await expect(uploadDatasheet("601110", pdf())).rejects.toBeInstanceOf(FakeGraphError);
  });

  it("refuses a non-PDF without sending anything", async () => {
    await expect(uploadDatasheet("601110", new File(["x"], "x.png", { type: "image/png" }))).rejects.toThrow(/isn't a PDF/);
    expect(graphFetch).not.toHaveBeenCalled();
  });

  it("uses an upload session over 4 MB — still with conflictBehavior fail", async () => {
    const big = pdf(4 * 1024 * 1024 + 1);
    graphFetch.mockResolvedValue({ uploadUrl: "https://upload.example/session" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "x", name: "601110.pdf", webUrl: "u", size: big.size }), { status: 201 }),
    );
    try {
      await uploadDatasheet("601110", big);
      const [path, init] = graphFetch.mock.calls[0];
      expect(path).toBe("/sites/engineering-site/drive/root:/General/Datasheets/601110.pdf:/createUploadSession");
      expect(JSON.parse(init.body)).toEqual({ item: { "@microsoft.graph.conflictBehavior": "fail" } });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
