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
import { UNASSIGNED_FILTER_KEY } from "@/lib/maintenanceFilters";

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
      "?q=bearing&equipment=3,8&assigned=david.bulkley@altronic-llc.com&category=Preventive&dept=SMT";
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
      "/operations/maintenance?q=bearing&equipment=3,8&assigned=DAVID@x.com&category=Preventive,Safety&dept=SMT",
    );
    const [filters] = result.current.filters;
    expect(filters.search).toBe("bearing");
    expect(filters.equipmentIds).toEqual([3, 8]);
    expect(filters.assignedEmails).toEqual(["david@x.com"]);
    expect(filters.categories).toEqual(["Preventive", "Safety"]);
    expect(filters.departments).toEqual(["SMT"]);
  });

  // A maintenance backlog is a SHARED queue — "what needs doing", not "what is
  // mine". A list that silently hid three quarters of the work would be
  // reported as broken, exactly as the EIR list was.
  it("opens completely unfiltered — no assigned-to-me default", () => {
    const { result } = renderFilters();
    const [filters] = result.current.filters;
    expect(filters).toEqual({
      search: "",
      equipmentIds: [],
      assignedEmails: [],
      categories: [],
      departments: [],
    });
    expect(result.current.location.search).toBe("");
  });

  it("writes a change back to the URL", () => {
    const { result } = renderFilters();
    act(() => {
      result.current.filters[1]({
        search: "oil",
        equipmentIds: [8],
        assignedEmails: [UNASSIGNED_FILTER_KEY],
        categories: ["Oil Change"],
        departments: ["SMT"],
      });
    });
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get("q")).toBe("oil");
    expect(params.get("equipment")).toBe("8");
    expect(params.get("assigned")).toBe(UNASSIGNED_FILTER_KEY);
    expect(params.get("category")).toBe("Oil Change");
    expect(params.get("dept")).toBe("SMT");
  });

  it("deletes a param when its filter is cleared, rather than parking it empty", () => {
    const { result } = renderFilters("/operations/maintenance?q=oil&dept=SMT");
    act(() => {
      result.current.filters[1]({
        search: "",
        equipmentIds: [],
        assignedEmails: [],
        categories: [],
        departments: [],
      });
    });
    expect(result.current.location.search).toBe("");
  });

  it("leaves unrelated params (the status pill) alone", () => {
    const { result } = renderFilters("/operations/maintenance?status=Started");
    act(() => {
      result.current.filters[1]({
        search: "pump",
        equipmentIds: [],
        assignedEmails: [],
        categories: [],
        departments: [],
      });
    });
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get("status")).toBe("Started");
    expect(params.get("q")).toBe("pump");
  });

  it("ignores a non-numeric equipment id rather than producing NaN", () => {
    const { result } = renderFilters("/operations/maintenance?equipment=3,abc,8");
    expect(result.current.filters[0].equipmentIds).toEqual([3, 8]);
  });
});
