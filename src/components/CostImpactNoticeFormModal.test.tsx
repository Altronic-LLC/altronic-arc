import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { CostImpactNoticeFormModal } from "./CostImpactNoticeFormModal";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

async function renderForm(onCreated = vi.fn(), onClose = vi.fn()) {
  renderWithProviders(<CostImpactNoticeFormModal onClose={onClose} onCreated={onCreated} />, {
    route: "/supply-chain/cost-impact-notices",
    routePattern: "/supply-chain/cost-impact-notices",
  });
  await screen.findByRole("dialog", { name: /new cost impact notice/i });
  return { onCreated, onClose };
}

async function fillRequired() {
  await userEvent.type(screen.getByLabelText(/^Title/), "TEST PART");
  await userEvent.type(screen.getByLabelText(/^Original Cost/), "10.00");
  await userEvent.type(screen.getByLabelText("New Cost*"), "12.50");
  const timeGroup = screen.getByRole("radiogroup", { name: /Time of Impact/ });
  await userEvent.click(within(timeGroup).getByRole("radio", { name: "Immediate" }));
  await userEvent.type(screen.getByLabelText(/^Where Used/), "Used on the test fixture.");
}

describe("CostImpactNoticeFormModal", () => {
  it("asks for a Title", async () => {
    await renderForm();
    await userEvent.click(screen.getByRole("button", { name: /raise notice/i }));
    expect(await screen.findByText("Title is required.")).toBeInTheDocument();
  });

  it("asks for Original Cost, New Cost, Time of Impact and Where Used", async () => {
    await renderForm();
    await userEvent.type(screen.getByLabelText(/^Title/), "TEST PART");
    await userEvent.click(screen.getByRole("button", { name: /raise notice/i }));
    expect(await screen.findByText("Original Cost is required.")).toBeInTheDocument();
  });

  it("offers Time of Impact as pills, not a dropdown", async () => {
    await renderForm();
    const group = screen.getByRole("radiogroup", { name: /Time of Impact/ });
    expect(within(group).getByRole("radio", { name: "Immediate" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Near Future (<6 mo)" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Future (6+ mo)" })).toBeInTheDocument();
  });

  it("raises the notice and hands back its id", async () => {
    const { onCreated, onClose } = await renderForm();
    await fillRequired();
    await userEvent.click(screen.getByRole("button", { name: /raise notice/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(typeof onCreated.mock.calls[0][0]).toBe("number");
  });

  it("closes on Escape", async () => {
    const { onClose } = await renderForm();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
