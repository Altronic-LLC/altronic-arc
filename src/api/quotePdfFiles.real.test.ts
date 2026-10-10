import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Saving quote PDFs at the REQUEST level, USE_MOCK forced off — the mock
// branch reads its own store and would pass whatever URL the real one built.
//
//  - every URL is on the PMO site's DEFAULT drive;
//  - the IC Quotes folder is resolved by path and the file written under its
//    item id, so ARC never creates the folder by accident;
//  - the upload uses `rename`, never `replace`;
//  - a 404 on the folder is an error naming the path.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const uploadToDriveTarget = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => {
  class GraphError extends Error {
    constructor(
      public status: number,
      public statusText: string,
      public body: string,
      public url: string,
    ) {
      super(`Graph ${status} ${statusText} at ${url}: ${body}`);
    }
  }
  return { graphFetch, graphFetchAll, GraphError };
});

vi.mock("./projectFiles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./projectFiles")>();
  return { ...actual, uploadToDriveTarget };
});

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false };
});

import { GraphError } from "./graph";
import { SITES } from "./config";
import { listQuotePdfs, saveQuotePdf } from "./quotePdfFiles";

const DRIVE = `/sites/${SITES.pmo}/drive`;
const FOLDER = `${DRIVE}/root:/General/IC%20Quotes:`;

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  uploadToDriveTarget.mockReset();
});

describe("saveQuotePdf (real mode)", () => {
  it("resolves the IC Quotes folder on the PMO drive, then uploads under its id with rename", async () => {
    graphFetch.mockResolvedValue({ id: "FOLDER1", name: "IC Quotes", folder: {} });
    uploadToDriveTarget.mockResolvedValue({
      id: "f",
      name: "IQ-COO-0042-R1 1.pdf",
      webUrl: "https://sp/IC Quotes/IQ-COO-0042-R1 1.pdf",
    });

    const saved = await saveQuotePdf(new Blob(["%PDF"]), "IQ-COO-0042-R1.pdf");

    expect(String(graphFetch.mock.calls[0][0]).startsWith(`${FOLDER}?`)).toBe(true);
    const [target, file, opts] = uploadToDriveTarget.mock.calls[0];
    expect(target).toBe(`${DRIVE}/items/FOLDER1:/IQ-COO-0042-R1.pdf:`);
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("IQ-COO-0042-R1.pdf");
    expect((file as File).type).toBe("application/pdf");
    expect(opts).toMatchObject({ conflict: "rename" });
    expect(JSON.stringify(uploadToDriveTarget.mock.calls)).not.toMatch(/replace/);
    // The name Graph actually landed it under is what comes back.
    expect(saved).toEqual({
      name: "IQ-COO-0042-R1 1.pdf",
      webUrl: "https://sp/IC Quotes/IQ-COO-0042-R1 1.pdf",
    });
  });

  it("never PUTs by full path (which would create a missing folder)", async () => {
    graphFetch.mockResolvedValue({ id: "FOLDER1" });
    uploadToDriveTarget.mockResolvedValue({ id: "f", name: "x.pdf", webUrl: "" });
    await saveQuotePdf(new Blob(["%PDF"]), "x.pdf");
    expect(String(uploadToDriveTarget.mock.calls[0][0])).not.toContain("root:");
  });

  it("refuses with the folder path when the folder is missing, and uploads nothing", async () => {
    graphFetch.mockRejectedValue(new GraphError(404, "Not Found", "itemNotFound", FOLDER));
    await expect(saveQuotePdf(new Blob(["%PDF"]), "x.pdf")).rejects.toThrow(/General\/IC Quotes/);
    expect(uploadToDriveTarget).not.toHaveBeenCalled();
  });

  it("passes any other failure through unchanged", async () => {
    graphFetch.mockRejectedValue(new GraphError(403, "Forbidden", "accessDenied", FOLDER));
    await expect(saveQuotePdf(new Blob(["%PDF"]), "x.pdf")).rejects.toThrow(/403/);
  });
});

describe("listQuotePdfs (real mode)", () => {
  it("lists the IC Quotes folder's children, files for that quote only, newest first", async () => {
    graphFetchAll.mockResolvedValue([
      { id: "1", name: "IQ-COO-0042-R1.pdf", webUrl: "u1", size: 10, lastModifiedDateTime: "2026-10-01T10:00:00Z", file: {} },
      { id: "2", name: "IQ-ABC-0001-R1.pdf", webUrl: "u2", size: 11, lastModifiedDateTime: "2026-10-05T10:00:00Z", file: {} },
      { id: "3", name: "IQ-COO-0042-R2.pdf", webUrl: "u3", size: 12, lastModifiedDateTime: "2026-10-08T10:00:00Z", file: {}, "@microsoft.graph.downloadUrl": "dl3" },
      { id: "4", name: "IQ-COO-0042 old", webUrl: "u4", folder: { childCount: 2 } },
    ]);
    const files = await listQuotePdfs("IQ-COO-0042");
    expect(String(graphFetchAll.mock.calls[0][0]).startsWith(`${FOLDER}/children?`)).toBe(true);
    expect(files).toEqual([
      { name: "IQ-COO-0042-R2.pdf", webUrl: "u3", size: 12, modifiedAt: "2026-10-08T10:00:00Z", downloadUrl: "dl3" },
      { name: "IQ-COO-0042-R1.pdf", webUrl: "u1", size: 10, modifiedAt: "2026-10-01T10:00:00Z", downloadUrl: undefined },
    ]);
  });

  it("a missing folder is an error naming the path", async () => {
    graphFetchAll.mockRejectedValue(new GraphError(404, "Not Found", "itemNotFound", FOLDER));
    await expect(listQuotePdfs("IQ-COO-0042")).rejects.toThrow(/General\/IC Quotes/);
  });
});
