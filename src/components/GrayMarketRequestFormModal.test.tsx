import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// =============================================================================
// BusinessIT#8 (Katie Fleming) — Part Manufacturer is REQUIRED on a new
// request. It's a create-only rule: requests raised before the column existed
// are blank, so the card editor doesn't demand it.
// =============================================================================

const mocks = vi.hoisted(() => ({
  create: { mutateAsync: vi.fn(async () => ({ id: 42 })), isPending: false },
}));

vi.mock("@/hooks/useGrayMarketRequests", () => ({
  useCreateGrayMarketRequest: () => mocks.create,
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 }),
}));
vi.mock("@/hooks/useDirectory", () => ({ useDirectoryPeople: () => [] }));

import { GrayMarketRequestFormModal } from "./GrayMarketRequestFormModal";
import { missingRequiredOnCreate } from "@/lib/grayMarketFields";

beforeEach(() => {
  mocks.create.mutateAsync.mockClear();
});

describe("GrayMarketRequestFormModal — Part Manufacturer", () => {
  it("marks Part Manufacturer required, in the Request section", () => {
    renderWithProviders(<GrayMarketRequestFormModal onClose={() => {}} />);
    const label = screen.getByText("Part Manufacturer");
    expect(label.querySelector(".text-cooper-red")?.textContent).toBe("*");
  });

  it("refuses to submit without it, and says why", async () => {
    renderWithProviders(<GrayMarketRequestFormModal onClose={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/altronic assembly number/i), "791950-08");
    await userEvent.click(screen.getByRole("button", { name: /log request/i }));
    expect(await screen.findByText("Part Manufacturer is required.")).toBeInTheDocument();
    expect(mocks.create.mutateAsync).not.toHaveBeenCalled();
  });

  it("treats whitespace as blank", async () => {
    renderWithProviders(<GrayMarketRequestFormModal onClose={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/altronic assembly number/i), "791950-08");
    await userEvent.type(screen.getByLabelText(/part manufacturer/i), "   ");
    await userEvent.click(screen.getByRole("button", { name: /log request/i }));
    expect(await screen.findByText("Part Manufacturer is required.")).toBeInTheDocument();
    expect(mocks.create.mutateAsync).not.toHaveBeenCalled();
  });

  it("sends the manufacturer with the request", async () => {
    const onCreated = vi.fn();
    renderWithProviders(<GrayMarketRequestFormModal onClose={() => {}} onCreated={onCreated} />);
    await userEvent.type(screen.getByPlaceholderText(/altronic assembly number/i), "791950-08");
    await userEvent.type(screen.getByLabelText(/part manufacturer/i), "Infineon");
    await userEvent.click(screen.getByRole("button", { name: /log request/i }));
    expect(mocks.create.mutateAsync).toHaveBeenCalledTimes(1);
    const [input] = mocks.create.mutateAsync.mock.calls[0] as unknown as [
      { values: Record<string, string> },
    ];
    expect(input.values.partManufacturer).toBe("Infineon");
    expect(onCreated).toHaveBeenCalledWith(42);
  });
});

describe("missingRequiredOnCreate", () => {
  it("names each blank required field", () => {
    expect(missingRequiredOnCreate({})).toEqual(["Part Manufacturer"]);
    expect(missingRequiredOnCreate({ partManufacturer: " " })).toEqual(["Part Manufacturer"]);
    expect(missingRequiredOnCreate({ partManufacturer: "TI" })).toEqual([]);
  });
});
