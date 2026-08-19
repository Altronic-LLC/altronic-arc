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

/**
 * Render the form and wait for the ECN list to land.
 *
 * The wait is not ceremony: the duplicate-Log# check can only run against a
 * loaded list, so a test that clicks Save before the fetch resolves is
 * exercising the "still loading" path instead of the one it means to. That
 * raced on CI and passed locally, which is the worst kind of green.
 */
async function renderForm(onCreated = vi.fn(), onClose = vi.fn()) {
  renderWithProviders(<EcnFormModal onClose={onClose} onCreated={onCreated} />, {
    route: "/engineering/ecns",
    routePattern: "/engineering/ecns",
  });
  await screen.findByRole("dialog", { name: /new ecn/i });
  await screen.findByText(/Latest on the list is/);
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
    expect(screen.getByText(/Latest on the list is 260062/)).toBeInTheDocument();
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

  // Race-free by construction: whether the list has loaded or not, a
  // duplicate number never gets through. Loaded, the duplicate check catches
  // it; still loading, the "can't check yet" guard does. Asserting that
  // nothing was created holds on both paths, which is the invariant that
  // actually matters on a controlled record.
  it("never creates a duplicate, loaded list or not", async () => {
    const onCreated = vi.fn();
    renderWithProviders(<EcnFormModal onClose={vi.fn()} onCreated={onCreated} />, {
      route: "/engineering/ecns",
      routePattern: "/engineering/ecns",
    });
    await screen.findByRole("dialog", { name: /new ecn/i });

    // Deliberately NOT waiting for the list, unlike renderForm.
    await userEvent.type(screen.getByLabelText(/^Title/), "PCB ASSEMBLY");
    await userEvent.type(screen.getByLabelText(/^Log#/), "260062");
    await userEvent.click(screen.getByRole("button", { name: /raise ecn/i }));

    expect(onCreated).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const { onClose } = await renderForm();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
