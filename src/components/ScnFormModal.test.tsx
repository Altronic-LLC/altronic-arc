import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetScnMockStore, listScns } from "@/api/scns";
import { ScnFormModal } from "./ScnFormModal";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

beforeEach(() => {
  __resetScnMockStore();
  localStorage.clear();
});

async function renderForm() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const result = renderWithProviders(<ScnFormModal onClose={onClose} onCreated={onCreated} />, {
    route: "/supply-chain/scns",
  });
  const dialog = await screen.findByRole("dialog", { name: "New SCN" });
  return { ...result, onClose, onCreated, dialog };
}

const THIS_YEAR = new Date().getFullYear();

describe("ScnFormModal", () => {
  it("previews the SCN# it will be assigned — the next global sequence under this year", async () => {
    await renderForm();
    // The mock list tops out at 2026-0148, so the next is 0149 whatever the year.
    expect(await screen.findByText(`SCN# will be ${THIS_YEAR}-0149`)).toBeInTheDocument();
  });

  it("labels the fields by what the list calls them, not the internal column names", async () => {
    const { dialog } = await renderForm();
    expect(within(dialog).getByText("Product")).toBeInTheDocument(); // not "Progress"
    expect(within(dialog).getByText("Category")).toBeInTheDocument(); // not "Priority"
    expect(within(dialog).getByText("Old Number")).toBeInTheDocument(); // not "PartsEffected"
    expect(within(dialog).queryByText(/progress|priority|partseffected/i)).toBeNull();
  });

  it("offers Approved / Denied as pills with NO Not set — the column refuses a blank", async () => {
    const { dialog } = await renderForm();
    const group = within(dialog).getByRole("radiogroup", { name: "Approval Status" });
    expect(within(group).getByRole("radio", { name: "Approved" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Denied" })).toBeInTheDocument();
    expect(within(group).queryByRole("radio", { name: /not set/i })).toBeNull();
  });

  it("requires Product, Description and Approval Status, in that order", async () => {
    const { dialog, onCreated } = await renderForm();
    const save = within(dialog).getByRole("button", { name: "Raise SCN" });

    await userEvent.click(save);
    expect(await within(dialog).findByText("Product is required.")).toBeInTheDocument();

    await userEvent.type(within(dialog).getByPlaceholderText("e.g. DD-40NTS"), "DD-40NTS");
    await userEvent.click(save);
    expect(await within(dialog).findByText("Description is required.")).toBeInTheDocument();

    await userEvent.type(within(dialog).getByPlaceholderText(/what the notice is about/i), "LCD is EOL.");
    await userEvent.click(save);
    expect(await within(dialog).findByText(/Approval Status is required/)).toBeInTheDocument();

    expect(onCreated).not.toHaveBeenCalled();
  });

  it("raises the SCN, closes, and hands the new id on", async () => {
    const { dialog, onClose, onCreated } = await renderForm();
    await userEvent.type(within(dialog).getByPlaceholderText("e.g. DD-40NTS"), "NGI-1000");
    await userEvent.type(within(dialog).getByPlaceholderText(/what the notice is about/i), "Supplier EOL on the display.");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Approved" }));
    await userEvent.type(within(dialog).getByPlaceholderText("One part number per line"), "791950-16");
    await userEvent.click(within(dialog).getByRole("button", { name: "Raise SCN" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalled();

    const created = (await listScns()).find((s) => s.product === "NGI-1000");
    expect(created).toBeDefined();
    expect(created!.id).toBe(onCreated.mock.calls[0][0]);
    expect(created!.scnNumber).toBe(`${THIS_YEAR}-0149`);
    expect(created!.year).toBe(String(THIS_YEAR));
    expect(created!.status).toBe("WIP"); // never asked for; defaults
    expect(created!.approvalStatus).toBe("Approved");
    expect(created!.values.description).toBe("Supplier EOL on the display.");
    expect(created!.values.oldNumber).toBe("791950-16");
  });

  it("keeps a half-written SCN as a draft and announces it on return", async () => {
    const first = await renderForm();
    await userEvent.type(within(first.dialog).getByPlaceholderText("e.g. DD-40NTS"), "Draft product");
    first.unmount();

    const second = await renderForm();
    expect(within(second.dialog).getByText(/Draft restored from earlier/)).toBeInTheDocument();
    expect(within(second.dialog).getByPlaceholderText("e.g. DD-40NTS")).toHaveValue("Draft product");

    await userEvent.click(within(second.dialog).getByRole("button", { name: "Discard" }));
    expect(within(second.dialog).getByPlaceholderText("e.g. DD-40NTS")).toHaveValue("");
    expect(within(second.dialog).queryByText(/Draft restored/)).toBeNull();
  });

  it("forgets the draft once the SCN is raised", async () => {
    const first = await renderForm();
    await userEvent.type(within(first.dialog).getByPlaceholderText("e.g. DD-40NTS"), "Gone after save");
    await userEvent.type(within(first.dialog).getByPlaceholderText(/what the notice is about/i), "x");
    await userEvent.click(within(first.dialog).getByRole("radio", { name: "Denied" }));
    await userEvent.click(within(first.dialog).getByRole("button", { name: "Raise SCN" }));
    await waitFor(() => expect(first.onCreated).toHaveBeenCalled());
    first.unmount();

    const second = await renderForm();
    expect(within(second.dialog).queryByText(/Draft restored/)).toBeNull();
    expect(within(second.dialog).getByPlaceholderText("e.g. DD-40NTS")).toHaveValue("");
  });

  it("closes on Escape", async () => {
    const { onClose } = await renderForm();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("says the status starts as WIP and that people are added as watchers", async () => {
    const { dialog } = await renderForm();
    expect(within(dialog).getByText("WIP")).toBeInTheDocument();
    expect(within(dialog).getByText(/added as watchers/)).toBeInTheDocument();
  });
});
