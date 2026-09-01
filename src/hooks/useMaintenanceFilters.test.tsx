import { describe, expect, it } from "vitest";
import { act } from "react";
import { renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import {
  MAINTENANCE_FILTER_PARAM_KEYS,
  maintenanceFilterSearch,
  useMaintenanceFilters,
} from "./useMaintenanceFilters";
import { EMPTY_MAINTENANCE_FILTERS, UNASSIGNED_FILTER_KEY } from "@/lib/maintenanceFilters";

function wrapperFor(route: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>;
  };
}

function renderFilters(route = "/operations/maintenance") {
  return renderHook(
    () => ({ filters: useMaintenanceFilters(), location: useLocation() }),
    { wrapper: wrapperFor(route) },
  );
}

describe("maintenanceFilterSearch", () => {
  it("carries every filter param across the List ⇄ Board switch", () => {
    const search =
      "?q=bearing&equipment=3,8&assigned=david.bulkley@altronic-llc.com&category=Preventive&dept=SMT&type=scheduled";
    const out = new URLSearchParams(maintenanceFilterSearch(search));
    for (const key of MAINTENANCE_FILTER_PARAM_KEYS) {
      expect(out.get(key)).not.toBeNull();
    }
  });

  // On the board the COLUMNS are the statuses, so carrying `status=Complete`
  // across leaves six empty columns, which reads as broken.
  it("leaves the status pill behind", () => {
    expect(maintenanceFilterSearch("?q=oil&status=Complete")).toBe("?q=oil");
  });

  it("returns an empty string when nothing is set", () => {
    expect(maintenanceFilterSearch("")).toBe("");
    expect(maintenanceFilterSearch("?status=Started")).toBe("");
  });

  // Unlike the task list's `assigned=`, an empty value here carries no
  // information — there is no default-to-me for it to suppress.
  it("drops a present-but-empty param", () => {
    expect(maintenanceFilterSearch("?q=&assigned=")).toBe("");
  });
});

describe("useMaintenanceFilters", () => {
  it("reads every axis out of the URL", () => {
    const { result } = renderFilters(
      "/operations/maintenance?q=bearing&equipment=3,8&assigned=DAVID@x.com&category=Preventive,Safety&dept=SMT&type=one-off",
    );
    const [filters] = result.current.filters;
    expect(filters.search).toBe("bearing");
    expect(filters.equipmentIds).toEqual([3, 8]);
    expect(filters.assignedEmails).toEqual(["david@x.com"]);
    expect(filters.categories).toEqual(["Preventive", "Safety"]);
    expect(filters.departments).toEqual(["SMT"]);
    expect(filters.type).toBe("one-off");
  });

  // A maintenance backlog is a SHARED queue — "what needs doing", not "what is
  // mine". A list that silently hid three quarters of the work would be
  // reported as broken, exactly as the EIR list was.
  it("opens completely unfiltered — no assigned-to-me default", () => {
    const { result } = renderFilters();
    const [filters] = result.current.filters;
    expect(filters).toEqual(EMPTY_MAINTENANCE_FILTERS);
    expect(result.current.location.search).toBe("");
  });

  it("writes a change back to the URL", () => {
    const { result } = renderFilters();
    act(() => {
      result.current.filters[1]({
        ...EMPTY_MAINTENANCE_FILTERS,
        search: "oil",
        equipmentIds: [8],
        assignedEmails: [UNASSIGNED_FILTER_KEY],
        categories: ["Oil Change"],
        departments: ["SMT"],
        type: "scheduled",
      });
    });
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get("q")).toBe("oil");
    expect(params.get("equipment")).toBe("8");
    expect(params.get("assigned")).toBe(UNASSIGNED_FILTER_KEY);
    expect(params.get("category")).toBe("Oil Change");
    expect(params.get("dept")).toBe("SMT");
    expect(params.get("type")).toBe("scheduled");
  });

  it("deletes a param when its filter is cleared, rather than parking it empty", () => {
    const { result } = renderFilters("/operations/maintenance?q=oil&dept=SMT");
    act(() => {
      result.current.filters[1]({ ...EMPTY_MAINTENANCE_FILTERS });
    });
    expect(result.current.location.search).toBe("");
  });

  it("leaves unrelated params (the status pill) alone", () => {
    const { result } = renderFilters("/operations/maintenance?status=Started");
    act(() => {
      result.current.filters[1]({ ...EMPTY_MAINTENANCE_FILTERS, search: "pump" });
    });
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get("status")).toBe("Started");
    expect(params.get("q")).toBe("pump");
  });

  // Both is the DEFAULT and must never appear in the URL: a link carrying
  // `type=both` would make a bookmark taken after this change behave
  // differently from one taken before it, for no gain.
  describe("the Type axis", () => {
    it("defaults to Both, with no param", () => {
      const { result } = renderFilters();
      expect(result.current.filters[0].type).toBe("");
      expect(result.current.location.search).toBe("");
    });

    it("writes scheduled and one-off, and DELETES the key for Both", () => {
      const { result } = renderFilters();
      act(() => {
        result.current.filters[1]({ ...EMPTY_MAINTENANCE_FILTERS, type: "one-off" });
      });
      expect(new URLSearchParams(result.current.location.search).get("type")).toBe("one-off");

      act(() => {
        result.current.filters[1]({ ...EMPTY_MAINTENANCE_FILTERS, type: "" });
      });
      expect(result.current.location.search).toBe("");
    });

    // A hand-edited link, a typo, or the `type=both` somebody would
    // reasonably guess at: all read as Both rather than filtering nothing
    // while no pill looks selected.
    it("reads an unrecognised value as Both", () => {
      for (const raw of ["both", "BOTH", "scheduld", "1"]) {
        const { result } = renderFilters(`/operations/maintenance?type=${raw}`);
        expect(result.current.filters[0].type).toBe("");
      }
    });

    it("carries across the List ⇄ Board switch", () => {
      expect(maintenanceFilterSearch("?type=scheduled")).toBe("?type=scheduled");
    });

    // ONE value, same spelling as the calendar's — deliberately not the
    // comma-separated shape `assigned` and `equipment` grew.
    it("is a single value, not a list", () => {
      const { result } = renderFilters("/operations/maintenance?type=scheduled,one-off");
      expect(result.current.filters[0].type).toBe("");
    });
  });

  it("ignores a non-numeric equipment id rather than producing NaN", () => {
    const { result } = renderFilters("/operations/maintenance?equipment=3,abc,8");
    expect(result.current.filters[0].equipmentIds).toEqual([3, 8]);
  });
});
