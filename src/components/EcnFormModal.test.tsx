import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { EcnFormModal } from "./EcnFormModal";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

async function renderForm(onCreated = vi.fn(), onClose = vi.fn()) {
  renderWithProviders(<EcnFormModal onClose={onClose} onCreated={onCreated} />, {
    route: "/engineering/ecns",
    routePattern: "/engineering/ecns",
  });
  await screen.findByRole("dialog", { name: /new ecn/i });
  return { onCreated, onClose };
}

describe("EcnFormModal", () => {
  it("asks for a title", async () => {
    await renderForm();
    await userEvent.type(screen.getByLabelText(/^Log#/), "260099");
    await userEvent.click(screen.getByRole("button", { name: /raise ecn/i }));
    expect(await screen.findByText("Title is required.")).toBeInTheDocument();
  });

  // The number comes off the ECN paperwork — nothing generates it, so an
  // empty one has to be caught here.
  it("asks for a Log#", async () => {
    await renderForm();
    await userEvent.type(screen.getByLabelText(/^Title/), "PCB ASSEMBLY");
    await userEvent.click(screen.getByRole("button", { name: /raise ecn/i }));
    expect(await screen.findByText("Log# is required.")).toBeInTheDocument();
  });

  it("refuses a number another ECN already has", async () => {
    await renderForm();
    await userEvent.type(screen.getByLabelText(/^Title/), "PCB ASSEMBLY");
    await userEvent.type(screen.getByLabelText(/^Log#/), "260062");
    await userEvent.click(screen.getByRole("button", { name: /raise ecn/i }));
    expect(
      await screen.findByText(/Log# 260062 is already used by another ECN/i),
    ).toBeInTheDocument();
  });

  it("shows where the numbering is up to", async () => {
    await renderForm();
    await waitFor(() =>
      expect(screen.getByText(/Latest on the list is 260062/)).toBeInTheDocument(),
    );
  });

  it("raises the ECN and hands back its id", async () => {
    const { onCreated, onClose } = await renderForm();
    await userEvent.type(screen.getByLabelText(/^Title/), "SPARK PLUG, 591011");
    await userEvent.type(screen.getByLabelText(/^Log#/), "260101");
    await userEvent.type(
      screen.getByLabelText(/Final Assembly Part Numbers/),
      "591011",
    );
    await userEvent.click(screen.getByRole("button", { name: /raise ecn/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(typeof onCreated.mock.calls[0][0]).toBe("number");
  });

  it("ticks a boolean column", async () => {
    await renderForm();
    const returns = screen.getByLabelText(/Field Returns Impacted/);
    await userEvent.click(returns);
    expect(returns).toBeChecked();
  });

  // Sign-off is filled in later, on the notice itself.
  it("leaves the sign-off fields off the create form", async () => {
    await renderForm();
    expect(screen.queryByLabelText(/Engineering Comments/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Sign-off status/)).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const { onClose } = await renderForm();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
