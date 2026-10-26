import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// =============================================================================
// Next free needs EVERY number on BOTH lists. The Component List (~3,900 rows)
// usually arrives seconds before the Part List (~14,000), and the form used to
// fill in a Part List number as soon as EITHER had loaded — working from the
// components alone, it offered list 604's first number as if 604 were empty.
// Here the Part List read is held open until the test lets it go.
// =============================================================================

const releasePartList = vi.hoisted(() => ({ release: () => {} }));
vi.mock("@/api/altronicParts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/altronicParts")>();
  return {
    ...actual,
    listAltronicParts: async () => {
      await new Promise<void>((resolve) => {
        releasePartList.release = resolve;
      });
      return actual.listAltronicParts();
    },
  };
});

import { renderWithProviders } from "@/test/render";
import { __resetPartsRolesMockStore } from "@/api/partsRoles";
import { __resetAltronicPartsMockStore } from "@/api/altronicParts";
import { __resetAltronicComponentsMockStore } from "@/api/altronicComponents";
import { PartFormModal } from "./PartFormModal";

beforeEach(() => {
  localStorage.clear();
  __resetPartsRolesMockStore();
  __resetAltronicPartsMockStore();
  __resetAltronicComponentsMockStore();
});

describe("PartFormModal — Next free waits for both lists", () => {
  it("leaves the number blank and says why until the Part List has loaded", async () => {
    renderWithProviders(<PartFormModal prefix="604" onClose={() => {}} />);
    expect(await screen.findByText("Loading the parts lists to find the next free number…")).toBeInTheDocument();
    // Give the Component List time to arrive: still nothing filled in.
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByLabelText("Altronic Part #")).toHaveValue("");

    await userEvent.click(screen.getByRole("button", { name: /Next free/ }));
    expect(screen.getByText(/still loading — Next free needs every number/)).toBeInTheDocument();
    expect(screen.getByLabelText("Altronic Part #")).toHaveValue("");

    await act(async () => releasePartList.release());
    // Mock list 604 holds 604596 and 604612.
    await waitFor(() => expect(screen.getByLabelText("Altronic Part #")).toHaveValue("604613"));
    expect(screen.queryByText("Loading the parts lists to find the next free number…")).not.toBeInTheDocument();
  });
});
