import { describe, expect, it } from "vitest";
import {
  applySavedQuery,
  defaultFilter,
  isBareSearch,
  matchingSavedFilter,
  MAX_SAVED_FILTERS,
  parseSavedFilterStore,
  removeFilter,
  renameFilter,
  restoreFilter,
  saveFilter,
  savedQueryNeedsMe,
  setDefaultFilter,
  toSavedQuery,
  type SavedFilter,
  type SavedFilterSpec,
} from "./savedFilters";

const spec: SavedFilterSpec = {
  list: "tasks",
  keys: ["q", "project", "assigned", "createdBy", "status"],
  personKeys: ["assigned", "createdBy"],
  defaults: { status: "ALL_ACTIVE" },
};

const ME = ["tim.webster@altronic-llc.com", "twebster@example.com"];
let n = 0;
const id = () => `id${++n}`;

function f(name: string, query: string, isDefault = false): SavedFilter {
  return { id: `f-${name}`, name, query, isDefault };
}

describe("toSavedQuery", () => {
  it("keeps only the list's keys, in the list's order", () => {
    expect(toSavedQuery("?status=Blocked&scope=all&q=harness&project=5", spec, ME)).toBe(
      "q=harness&project=5&status=Blocked",
    );
  });

  it("saves the signed-in user's own address as @me, whichever spelling", () => {
    expect(
      toSavedQuery("assigned=Tim.Webster%40altronic-llc.com,sarah%40x.com&createdBy=twebster%40example.com", spec, ME),
    ).toBe("assigned=%40me%2Csarah%40x.com&createdBy=%40me");
  });

  it("keeps an empty assigned= (Anyone) and drops a default status", () => {
    expect(toSavedQuery("assigned=&status=ALL_ACTIVE", spec, ME)).toBe("assigned=");
  });

  it("leaves out excluded keys when given a narrower set", () => {
    expect(toSavedQuery("q=a&status=Blocked", spec, ME, ["q", "project", "assigned", "createdBy"])).toBe("q=a");
  });
});

describe("applySavedQuery", () => {
  it("replaces every list key, keeps other params, and puts @me back as the mailbox", () => {
    const next = applySavedQuery("scope=all&q=old&status=Blocked", "assigned=%40me&project=5", spec, "me@x.com");
    expect(next?.get("scope")).toBe("all");
    expect(next?.get("q")).toBeNull();
    expect(next?.get("status")).toBeNull();
    expect(next?.get("assigned")).toBe("me@x.com");
    expect(next?.get("project")).toBe("5");
  });

  it("waits (null) when the filter names @me and nobody is known yet", () => {
    expect(savedQueryNeedsMe("assigned=%40me", spec)).toBe(true);
    expect(applySavedQuery("", "assigned=%40me", spec, null)).toBeNull();
    expect(applySavedQuery("", "project=5", spec, null)?.get("project")).toBe("5");
  });

  it("applies an empty assigned= as Anyone", () => {
    expect(applySavedQuery("assigned=me@x.com", "assigned=", spec, "me@x.com")?.get("assigned")).toBe("");
  });
});

describe("isBareSearch", () => {
  it("is bare with none of the list's keys, even with other params", () => {
    expect(isBareSearch("", spec)).toBe(true);
    expect(isBareSearch("scope=all", spec)).toBe(true);
    expect(isBareSearch("assigned=", spec)).toBe(false);
    expect(isBareSearch("status=Blocked", spec)).toBe(false);
  });
});

describe("matchingSavedFilter", () => {
  const saved = [f("Mine", "assigned=%40me"), f("Blocked", "assigned=&status=Blocked")];

  it("finds the saved filter on screen, @me included", () => {
    expect(matchingSavedFilter(saved, "assigned=tim.webster%40altronic-llc.com", spec, ME)?.name).toBe("Mine");
    expect(matchingSavedFilter(saved, "assigned=&status=Blocked&scope=all", spec, ME)?.name).toBe("Blocked");
    expect(matchingSavedFilter(saved, "assigned=&status=Complete", spec, ME)).toBeNull();
  });

  it("compares only the given keys (the board ignores status)", () => {
    const board = ["q", "project", "assigned", "createdBy"];
    expect(matchingSavedFilter(saved, "assigned=", spec, ME, board)?.name).toBe("Blocked");
  });
});

describe("saving, renaming, deleting", () => {
  it("adds a new filter, and the same name in any case replaces it in place", () => {
    const a = saveFilter([], "  My   open ", "q=a", id);
    expect(a.ok && a.filter.name).toBe("My open");
    if (!a.ok) throw new Error();
    const withDefault = setDefaultFilter(a.filters, a.filter.id);
    const b = saveFilter(withDefault, "MY OPEN", "q=b", id);
    expect(b.ok && b.replaced).toBe(true);
    if (!b.ok) throw new Error();
    expect(b.filters).toHaveLength(1);
    expect(b.filters[0]).toMatchObject({ name: "MY OPEN", query: "q=b", isDefault: true });
  });

  it("refuses a blank name, and a new one past the limit", () => {
    expect(saveFilter([], "   ", "", id)).toEqual({ ok: false, reason: "empty-name" });
    const full = Array.from({ length: MAX_SAVED_FILTERS }, (_, i) => f(`F${i}`, ""));
    expect(saveFilter(full, "One more", "", id)).toEqual({ ok: false, reason: "full" });
    // Replacing one is still allowed when full.
    expect(saveFilter(full, "f3", "q=x", id).ok).toBe(true);
  });

  it("renames, refusing another filter's name", () => {
    const list = [f("A", ""), f("B", "")];
    expect(renameFilter(list, "f-A", "b")).toEqual({ ok: false, reason: "duplicate-name" });
    const r = renameFilter(list, "f-A", "a"); // its own name, new case
    expect(r.ok && r.filters[0].name).toBe("a");
  });

  it("restores a deleted filter where it was, not as a second default", () => {
    const list = [f("A", ""), f("B", "", true), f("C", "")];
    const removed = removeFilter(list, "f-B");
    expect(restoreFilter(removed, list[1], 1).map((x) => x.name)).toEqual(["A", "B", "C"]);
    const otherDefault = setDefaultFilter(removed, "f-C");
    expect(restoreFilter(otherDefault, list[1], 1).find((x) => x.name === "B")?.isDefault).toBe(false);
  });

  it("keeps one default per list, and clears it with null", () => {
    const list = setDefaultFilter([f("A", ""), f("B", "")], "f-B");
    expect(defaultFilter(list)?.name).toBe("B");
    expect(defaultFilter(setDefaultFilter(list, "f-A"))?.name).toBe("A");
    expect(defaultFilter(setDefaultFilter(list, null))).toBeNull();
  });
});

describe("parseSavedFilterStore", () => {
  it("reads good entries and drops the rest", () => {
    const store = parseSavedFilterStore({
      version: 1,
      lists: {
        tasks: [
          { id: "1", name: "Mine", query: "?assigned=%40me", isDefault: true },
          { id: "2", name: "mine", query: "", isDefault: false }, // duplicate name
          { id: "3", name: "Other", query: "", isDefault: true }, // second default
          { id: "1", name: "Same id", query: "" },
          { name: "No id", query: "" },
          "junk",
        ],
        eirs: "nope",
      },
    });
    expect(store.tasks).toEqual([
      { id: "1", name: "Mine", query: "assigned=%40me", isDefault: true },
      { id: "3", name: "Other", query: "", isDefault: false },
    ]);
    expect(store.eirs).toEqual([]);
  });

  it("is empty for anything that isn't a store", () => {
    expect(parseSavedFilterStore(null)).toEqual({ tasks: [], eirs: [] });
    expect(parseSavedFilterStore([1, 2])).toEqual({ tasks: [], eirs: [] });
  });
});
