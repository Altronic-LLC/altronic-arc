import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetPartsRolesMockStore } from "@/api/partsRoles";
import {
  __resetComponentDescriptionOptionsMockStore,
  listComponentDescriptionOptions,
} from "@/api/componentDescriptionOptions";
import type { PartsRoleEntry } from "@/types/task";

vi.mock("@/components/Toast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/Toast")>();
  return { ...actual, pushToast: vi.fn() };
});

import { PartDescriptionOptionsView } from "./PartDescriptionOptionsView";

const demoWith = (roles: PartsRoleEntry["roles"]): PartsRoleEntry[] => [
  { id: 1, email: "demo.user@altronic-llc.com", displayName: "Demo User", roles, note: "" },
];

/** An input, once the roles list has loaded and it's enabled. */
async function ready(label: string) {
  const input = await screen.findByLabelText(label);
  await waitFor(() => expect(input).toBeEnabled());
  return input;
}

const descriptions = () => screen.getByRole("region", { name: "Descriptions" });
const silCategories = () => screen.getByRole("region", { name: /SIL categories/ });

beforeEach(() => {
  __resetComponentDescriptionOptionsMockStore();
  __resetPartsRolesMockStore(demoWith(["sap admin"]));
});

describe("PartDescriptionOptionsView", () => {
  it("lists the descriptions with their types, and the SIL categories", async () => {
    renderWithProviders(<PartDescriptionOptionsView />);
    expect(await within(await screen.findByRole("region", { name: "Descriptions" })).findByText("Capacitor")).toBeInTheDocument();
    expect(within(descriptions()).getByText("Ceramic")).toBeInTheDocument();
    expect(within(descriptions()).getAllByText("No types — saves as the description alone.").length).toBeGreaterThan(0);
    expect(within(silCategories()).getByText("SIL CAT 1")).toBeInTheDocument();
  });

  it("adds a description, then a type under it", async () => {
    renderWithProviders(<PartDescriptionOptionsView />);
    await userEvent.type(await ready("New description"), "Fuse");
    await userEvent.click(screen.getByRole("button", { name: "Add description" }));
    await userEvent.type(await screen.findByLabelText("New type for Fuse"), "Glass");
    await userEvent.click(within(screen.getByLabelText("New type for Fuse").closest("form")!).getByRole("button", { name: "Add" }));
    await waitFor(async () =>
      expect((await listComponentDescriptionOptions()).find((o) => o.name === "Fuse")?.types).toEqual(["Glass"]),
    );
  });

  it("refuses a duplicate, and says so", async () => {
    renderWithProviders(<PartDescriptionOptionsView />);
    await userEvent.type(await ready("New SIL category"), "sil cat 2 -");
    await userEvent.click(screen.getByRole("button", { name: "Add SIL category" }));
    expect(await screen.findByText('"SIL CAT 2" is already on the list.')).toBeInTheDocument();
  });

  it("removes a type, and a whole description after asking", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<PartDescriptionOptionsView />);
    await ready("New description");
    await userEvent.click(await screen.findByRole("button", { name: "Remove type Wirewound from Resistor" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove Relay" }));
    await waitFor(async () => {
      const rows = await listComponentDescriptionOptions();
      expect(rows.find((o) => o.name === "Resistor")?.types).not.toContain("Wirewound");
      expect(rows.some((o) => o.name === "Relay")).toBe(false);
    });
  });

  it("is read-only, with the reason, for somebody who isn't the SAP admin or a reviewing engineer", async () => {
    __resetPartsRolesMockStore(demoWith(["hco editor"]));
    renderWithProviders(<PartDescriptionOptionsView />);
    expect(await screen.findByText(/Only the SAP admin and the reviewing engineers can change the description lists/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Relay" })).toBeDisabled();
    expect(screen.getByLabelText("New description")).toBeDisabled();
    expect(screen.queryByLabelText("New type for Resistor")).not.toBeInTheDocument();
  });
});
