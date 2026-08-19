import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FieldEditModal, type EditableFieldSpec } from "./FieldEditModal";

const FIELDS: EditableFieldSpec[] = [
  { key: "vendor", label: "Vendor", kind: "text" },
  { key: "notes", label: "Notes", kind: "multiline" },
  { key: "where", label: "Where Used", kind: "richText" },
  { key: "returns", label: "Field Returns Impacted", kind: "boolean" },
  { key: "flag", label: "Inspection Flag", kind: "choice", choices: ["Yes", "Pending"] },
  {
    key: "stock",
    label: "In House Stock",
    kind: "suggest",
    suggestions: ["Engineering - Do NOT modify stock"],
  },
];

function open(values: Record<string, string> = {}, onSave = vi.fn(), onClose = vi.fn()) {
  render(
    <FieldEditModal
      title="Edit Purchasing"
      fields={FIELDS}
      values={values}
      onClose={onClose}
      onSave={onSave}
    />,
  );
  return { onSave, onClose };
}

describe("FieldEditModal", () => {
  it("renders a control per field kind", async () => {
    open();
    const dialog = screen.getByRole("dialog", { name: "Edit Purchasing" });
    expect(within(dialog).getByRole("textbox", { name: "Vendor" })).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Notes" })).toBeInTheDocument();
    expect(within(dialog).getByRole("radiogroup", { name: "Field Returns Impacted" })).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "In House Stock" })).toBeInTheDocument();
  });

  // Only what moved is written. On Gray Market that's load-bearing: several
  // stored choice values have drifted outside their column's choice list, and
  // re-sending one makes SharePoint reject the whole PATCH.
  it("hands back only the fields that changed", async () => {
    const { onSave } = open({ vendor: "Mouser", notes: "leave me" });

    const vendor = screen.getByRole("textbox", { name: "Vendor" });
    await userEvent.clear(vendor);
    await userEvent.type(vendor, "Digi-Key");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledWith({ vendor: "Digi-Key" });
  });

  it("counts the pending changes as you go", async () => {
    open({ vendor: "Mouser" });
    expect(screen.getByText("No changes yet")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: "Vendor" }), "!");
    expect(screen.getByText("1 field changed")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: "Notes" }), "hi");
    expect(screen.getByText("2 fields changed")).toBeInTheDocument();
  });

  it("saves nothing, and doesn't call onSave, when nothing moved", async () => {
    const { onSave, onClose } = open({ vendor: "Mouser" });
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a boolean as a labelled Yes / No and returns Yes", async () => {
    const { onSave } = open({ returns: "" });
    const group = screen.getByRole("radiogroup", { name: "Field Returns Impacted" });
    expect(within(group).getByRole("radio", { name: "No" })).toBeChecked();

    await userEvent.click(within(group).getByRole("radio", { name: "Yes" }));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(onSave).toHaveBeenCalledWith({ returns: "Yes" });
  });

  it("turns a Yes back off as an empty value", async () => {
    const { onSave } = open({ returns: "Yes" });
    const group = screen.getByRole("radiogroup", { name: "Field Returns Impacted" });
    await userEvent.click(within(group).getByRole("radio", { name: "No" }));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(onSave).toHaveBeenCalledWith({ returns: "" });
  });

  it("picks a choice", async () => {
    const { onSave } = open({ flag: "" });
    await userEvent.click(screen.getByRole("button", { name: /inspection flag/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Pending" }));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(onSave).toHaveBeenCalledWith({ flag: "Pending" });
  });

  it("discards edits on Cancel", async () => {
    const { onSave, onClose } = open({ vendor: "Mouser" });
    await userEvent.type(screen.getByRole("textbox", { name: "Vendor" }), "!!");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const { onClose } = open();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  // The list behind the page refetches on a cadence of its own; re-seeding the
  // drafts from it would wipe whatever is half-typed.
  it("keeps what's typed when the underlying values change", async () => {
    const { rerender } = render(
      <FieldEditModal
        title="Edit Purchasing"
        fields={FIELDS}
        values={{ vendor: "Mouser" }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const vendor = screen.getByRole("textbox", { name: "Vendor" });
    await userEvent.clear(vendor);
    await userEvent.type(vendor, "Half-typed");

    rerender(
      <FieldEditModal
        title="Edit Purchasing"
        fields={FIELDS}
        values={{ vendor: "Something else from a refetch" }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Vendor" })).toHaveValue("Half-typed");
  });
});
