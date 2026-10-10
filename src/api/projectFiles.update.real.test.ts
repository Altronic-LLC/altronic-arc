import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// updateProjectFolder at the REQUEST level, USE_MOCK off (BusinessIT#25). The
// mock branch reads its own store and would pass whatever the real one sent, so
// each case pins a request shape: the rename is a PATCH with conflictBehavior
// fail, the tag is a PATCH of the discovered LookupId column, and only what
// changed is sent.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());

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
  return { graphFetch, graphFetchAll: vi.fn(), GraphError };
});

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false };
});

import { GraphError } from "./graph";
import { updateProjectFolder } from "./projectFiles";

type Init = { method?: string; body?: string } | undefined;

const siblings = {
  value: [
    {
      id: "f1",
      name: "0017-AMP-5000 Refesh",
      webUrl: "u1",
      folder: {},
      listItem: { fields: { ProjectReferenceLookupId: "501" } },
    },
    {
      id: "f2",
      name: "0021-CleanBurn",
      webUrl: "u2",
      folder: {},
      listItem: { fields: { ProjectReferenceLookupId: "502" } },
    },
    { id: "fm", name: "Miscellaneous", webUrl: "um", folder: {}, listItem: { fields: {} } },
  ],
};

beforeEach(() => {
  graphFetch.mockReset();
  graphFetch.mockImplementation(async (url: string, init: Init) => {
    if (!init?.method) return siblings;
    if (url.endsWith("/listItem/fields")) return {};
    return { id: "f1", name: "0017-AMP-5000 Refresh", webUrl: "u1", folder: {} };
  });
});

const patches = () =>
  graphFetch.mock.calls.filter((call) => (call[1] as Init)?.method === "PATCH");

describe("updateProjectFolder (real mode)", () => {
  it("renames with conflictBehavior fail and sends nothing else", async () => {
    const out = await updateProjectFolder("f1", { name: "0017-AMP-5000 Refresh" });
    expect(patches()).toHaveLength(1);
    const [url, init] = patches()[0];
    expect(url).toMatch(/\/drive\/items\/f1$/);
    expect(JSON.parse(init.body)).toEqual({
      name: "0017-AMP-5000 Refresh",
      "@microsoft.graph.conflictBehavior": "fail",
    });
    expect(out.name).toBe("0017-AMP-5000 Refresh");
    expect(out.projectLookupId).toBe(501);
  });

  it("re-tags by patching the discovered LookupId column", async () => {
    const out = await updateProjectFolder("f1", { projectLookupId: 777 });
    expect(patches()).toHaveLength(1);
    const [url, init] = patches()[0];
    expect(url).toMatch(/\/drive\/items\/f1\/listItem\/fields$/);
    expect(JSON.parse(init.body)).toEqual({ ProjectReferenceLookupId: 777 });
    expect(out.projectLookupId).toBe(777);
  });

  it("sends nothing for a tag that is already that project", async () => {
    await updateProjectFolder("f1", { projectLookupId: 501 });
    expect(patches()).toHaveLength(0);
  });

  it("refuses a project another folder already carries, before writing", async () => {
    await expect(updateProjectFolder("f1", { projectLookupId: 502 })).rejects.toThrow(
      'That project already has a folder — "0021-CleanBurn".',
    );
    expect(patches()).toHaveLength(0);
  });

  it("refuses to edit the Miscellaneous folder", async () => {
    await expect(updateProjectFolder("fm", { name: "Other" })).rejects.toThrow(/Miscellaneous/);
    expect(patches()).toHaveLength(0);
  });

  it("turns a 409 into a sentence naming the taken name", async () => {
    graphFetch.mockImplementation(async (_u: string, init: Init) => {
      if (!init?.method) return siblings;
      throw new GraphError(409, "Conflict", "nameAlreadyExists", "u");
    });
    await expect(updateProjectFolder("f1", { name: "0021-CleanBurn" })).rejects.toThrow(
      'A folder called "0021-CleanBurn" already exists.',
    );
  });

  it("says the rename landed when the tag write then fails", async () => {
    graphFetch.mockImplementation(async (url: string, init: Init) => {
      if (!init?.method) return siblings;
      if (url.endsWith("/listItem/fields")) throw new Error("Graph 400");
      return { id: "f1", name: "Fixed", webUrl: "u1", folder: {} };
    });
    await expect(
      updateProjectFolder("f1", { name: "Fixed", projectLookupId: 777 }),
    ).rejects.toThrow(/Renamed the folder to "Fixed", but couldn't change its Project Reference/);
  });

  it("refuses a blank name and an illegal character before any request", async () => {
    await expect(updateProjectFolder("f1", { name: "  " })).rejects.toThrow(/required/);
    await expect(updateProjectFolder("f1", { name: "a/b" })).rejects.toThrow(/can't contain/);
    expect(graphFetch).not.toHaveBeenCalled();
  });
});
