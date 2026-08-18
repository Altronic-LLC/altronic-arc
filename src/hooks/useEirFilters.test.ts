import { describe, it, expect } from "vitest";
import { EIR_FILTER_PARAM_KEYS, eirFilterSearch } from "./useEirFilters";

describe("eirFilterSearch", () => {
  it("carries every EIR filter param across a view switch", () => {
    const out = eirFilterSearch(
      "?q=relay&project=10,20&reporter=ray%40a.com&engineer=sarah%40a.com&view=at-risk",
    );
    const params = new URLSearchParams(out);
    expect(params.get("q")).toBe("relay");
    expect(params.get("project")).toBe("10,20");
    expect(params.get("reporter")).toBe("ray@a.com");
    expect(params.get("engineer")).toBe("sarah@a.com");
    expect(params.get("view")).toBe("at-risk");
  });

  it("returns an empty string when nothing is filtered", () => {
    expect(eirFilterSearch("")).toBe("");
    expect(eirFilterSearch("?something=else")).toBe("");
  });

  // The board's columns ARE the statuses, so carrying `status=Closed` over
  // from the list would leave four empty columns — which reads as broken
  // rather than filtered. Same call the task switcher makes.
  it("leaves the status pill behind", () => {
    expect(eirFilterSearch("?status=Closed")).toBe("");
    expect(new URLSearchParams(eirFilterSearch("?q=relay&status=Closed")).has("status")).toBe(
      false,
    );
    expect(EIR_FILTER_PARAM_KEYS).not.toContain("status");
  });

  it("drops params that aren't set rather than emitting empty ones", () => {
    const params = new URLSearchParams(eirFilterSearch("?q=relay"));
    expect([...params.keys()]).toEqual(["q"]);
  });
});
