import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { SupplierContactFormModal } from "./SupplierContactFormModal";
import { MOCK_SUPPLIERS } from "@/data/srmMockData";

// =============================================================================
// The supplier on a new contact is PICKABLE (Ray, 2026-09-09).
//
// It used to be a fixed prop taken from whichever supplier detail page opened
// the modal, so a contact keyed to the wrong supplier could only be re-pointed
// by editing the row in SharePoint — and a contact with no supplier at all is
// invisible on every screen, since they are all scoped by that lookup.
// =============================================================================

const created = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("@/hooks/useSupplierContacts", () => ({
  useCreateSupplierContact: () => ({
    mutateAsync: async (input: Record<string, unknown>) => {
      created.push(input);
      return { id: 1, ...input };
    },
    isPending: false,
  }),
}));

function renderModal(supplierId = MOCK_SUPPLIERS[0].id) {
  return renderWithProviders(
    <SupplierContactFormModal supplierId={supplierId} onClose={() => {}} />,
    { seedQueryData: [{ key: ["suppliers"], data: MOCK_SUPPLIERS }] },
  );
}

beforeEach(() => {
  created.length = 0;
});

describe("SupplierContactFormModal", () => {
  it("prefills the supplier it was opened from", async () => {
    renderModal();
    // The detail page is still the only way in, so the common case must cost
    // no extra clicks.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Supplier" })).toHaveTextContent(
        MOCK_SUPPLIERS[0].title,
      ),
    );
  });

  it("sends the prefilled supplier as a NUMBER, the shape the lookup takes", async () => {
    renderModal();
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "a@b.com");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].supplierId).toBe(MOCK_SUPPLIERS[0].id);
    expect(typeof created[0].supplierId).toBe("number");
  });

  it("re-points the contact to another supplier", async () => {
    renderModal();
    await userEvent.click(screen.getByRole("button", { name: "Supplier" }));

    // The panel portals to document.body, so scope to the open listbox rather
    // than the field's own subtree.
    const listbox = await screen.findByRole("listbox");
    const other = MOCK_SUPPLIERS[1];
    await userEvent.click(within(listbox).getByRole("option", { name: other.title }));

    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "a@b.com");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].supplierId).toBe(other.id);
  });

  it("refuses a contact with no supplier, and says why", async () => {
    // Passing 0 stands in for "opened with nothing chosen" — the state a
    // future non-detail-page entry point would start in.
    renderModal(0);
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "a@b.com");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    // Scoped to the message, not just "pick a supplier" — the picker's own
    // placeholder reads that too, so a bare text match hits both.
    expect(await screen.findByText(/won't show up anywhere/i)).toBeInTheDocument();
    expect(created).toHaveLength(0);
  });

  it("still requires a name or an email", async () => {
    renderModal();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText(/at least a name or an email/i)).toBeInTheDocument();
    expect(created).toHaveLength(0);
  });
});
