import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { CsaListingsView } from "./CsaListingsView";

// USE_MOCK is true under Vitest, so this renders against the mock register.
// The mock user is a bootstrap admin, so admin is the default; the non-admin
// suite overrides the hook.

const adminAccess = vi.hoisted(() => ({ isAdmin: true, isResolving: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => adminAccess,
  useIsAdmin: () => adminAccess.isAdmin,
}));

beforeEach(() => {
  vi.restoreAllMocks();
  adminAccess.isAdmin = true;
  adminAccess.isResolving = false;
});

async function renderView(route = "/csa-listings") {
  const result = renderWithProviders(<CsaListingsView />, { route });
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  return result;
}

describe("CsaListingsView", () => {
  it("lists certification files with product and date", async () => {
    await renderView();
    expect(screen.getByRole("heading", { name: /csa listings/i })).toBeInTheDocument();
    expect(screen.getByText("LR 41862-3")).toBeInTheDocument();
    expect(screen.getByText("DSG-1201 Ignition System")).toBeInTheDocument();
  });

  it("labels the identifier column File Number, since Title is repurposed", async () => {
    await renderView();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toContain("File Number");
    expect(headers).not.toContain("Title");
  });

  it("shows the legacy CSA id next to the file number", async () => {
    await renderView();
    const row = screen.getByText("LR 41862-3").closest("tr")!;
    expect(within(row).getByText("#118")).toBeInTheDocument();
  });

  it("clamps a multi-line field to its first line and counts the rest", async () => {
    await renderView();
    const row = screen.getByText("LR 41862-3").closest("tr")!;
    // Also Cover has two lines in the fixture.
    expect(within(row).getByText("DSG-1201-A")).toBeInTheDocument();
    expect(within(row).getAllByText(/\+\d+ more/).length).toBeGreaterThan(0);
  });

  it("marks which listings have files attached", async () => {
    await renderView();
    // The marker is a BUTTON now, not a static icon — it used to carry
    // aria-label "Has attachments" and do nothing when clicked. See the
    // "reaching the certificates" suite below.
    expect(
      screen.getAllByRole("button", { name: /open attachments for/i }).length,
    ).toBeGreaterThan(0);
  });

  it("searches the long fields, where part numbers actually live", async () => {
    await renderView();
    const search = screen.getByPlaceholderText(/file number, product, part number/i);

    // 691201-5 appears only inside "Part No Included", which the table clamps.
    await userEvent.type(search, "691201-5");
    await waitFor(() => expect(screen.getByText(/showing 1 of 4/i)).toBeInTheDocument());
    expect(screen.getByText("LR 41862-3")).toBeInTheDocument();
  });

  it("says so when a search matches nothing", async () => {
    await renderView();
    await userEvent.type(
      screen.getByPlaceholderText(/file number, product, part number/i),
      "zzzznothing",
    );
    await waitFor(() =>
      expect(screen.getByText(/no listings match that search/i)).toBeInTheDocument(),
    );
  });

  it("keeps the search in the URL so a lookup is shareable", async () => {
    await renderView("/csa-listings?q=SAVES");
    expect(screen.getByText(/showing 1 of 4/i)).toBeInTheDocument();
    expect(screen.getByText("SAVES Annunciator")).toBeInTheDocument();
  });
});

describe("CsaListingsView — admin-gated writes", () => {
  it("offers an admin the new / edit / delete controls", async () => {
    await renderView();
    expect(screen.getByRole("button", { name: /new/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^edit /i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^delete /i }).length).toBeGreaterThan(0);
  });

  it("hides every write control from a non-admin, and explains why", async () => {
    adminAccess.isAdmin = false;
    await renderView();

    expect(screen.queryByRole("button", { name: /new/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit /i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete /i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).not.toContain("Actions");
    expect(screen.getByText(/limited to admins/i)).toBeInTheDocument();
  });

  it("still lets a non-admin search — reading is open", async () => {
    adminAccess.isAdmin = false;
    await renderView();
    await userEvent.type(
      screen.getByPlaceholderText(/file number, product, part number/i),
      "SAVES",
    );
    await waitFor(() => expect(screen.getByText(/showing 1 of 4/i)).toBeInTheDocument());
  });

  it("holds the explanation back while admin status is resolving", async () => {
    adminAccess.isAdmin = false;
    adminAccess.isResolving = true;
    await renderView();
    expect(screen.queryByText(/limited to admins/i)).not.toBeInTheDocument();
  });

  it("asks before deleting and honours a decline", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderView();
    await userEvent.click(screen.getByRole("button", { name: /^delete LR 41862-3/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByText(/showing 4 of 4/i)).toBeInTheDocument();
  });
});

describe("CsaListingsView — the form", () => {
  it("opens a blank form, and points attachments at the save-first flow", async () => {
    await renderView();
    await userEvent.click(screen.getByRole("button", { name: /new/i }));

    expect(await screen.findByText(/new csa listing/i)).toBeInTheDocument();
    // Nothing to attach a file to until the item exists.
    expect(screen.getByText(/save the listing first/i)).toBeInTheDocument();
  });

  it("requires a file number, since it's the identifier", async () => {
    await renderView();
    await userEvent.click(screen.getByRole("button", { name: /new/i }));
    await userEvent.click(await screen.findByRole("button", { name: /add listing/i }));
    expect(await screen.findByText(/file number is required/i)).toBeInTheDocument();
  });

  it("opens an edit form pre-filled, with attachments available", async () => {
    await renderView();
    await userEvent.click(screen.getByRole("button", { name: /^edit LR 41862-3/i }));

    expect(await screen.findByText(/edit csa listing/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("LR 41862-3")).toBeInTheDocument();
    expect(screen.getByDisplayValue("DSG-1201 Ignition System")).toBeInTheDocument();
    // The attachments panel replaces the "save first" note once the item exists.
    expect(screen.queryByText(/save the listing first/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /attachments/i })).toBeInTheDocument();
  });
});

// =============================================================================
// Reaching the certificates.
//
// The paperclip column was a static ICON — it said a certificate existed and
// gave you no way to open it. The files were only reachable inside the Edit
// modal, which is admin-only, so for everyone else the attachment was visible
// and unreachable (Ray, 2026-09-16: "clicking attachment in CSA listings does
// not work, users need to be able to access them").
//
// Reading a certificate is what the register is FOR, so the modal is open to
// anyone signed in; only adding and removing stay admin-only, via
// `AttachmentsSection`'s `readOnly` prop.
// =============================================================================
describe("CsaListingsView — reaching the certificates", () => {
  it("makes the paperclip a BUTTON, not a static icon", async () => {
    await renderView();
    expect(
      screen.getAllByRole("button", { name: /open attachments for/i }).length,
    ).toBeGreaterThan(0);
  });

  it("offers no button on a listing with no attachments", async () => {
    await renderView();
    // Two of the four fixtures have none; the others must not gain a button.
    const buttons = screen.getAllByRole("button", { name: /open attachments for/i });
    const withAttachments = 2;
    expect(buttons).toHaveLength(withAttachments);
  });

  it("opens the attachments for a NON-ADMIN — the whole point", async () => {
    adminAccess.isAdmin = false;
    const user = userEvent.setup();
    await renderView();

    await user.click(screen.getAllByRole("button", { name: /open attachments for/i })[0]);

    const dialog = await screen.findByRole("dialog", { name: /attachments for/i });
    expect(dialog).toBeInTheDocument();
  });

  it("gives a non-admin NO way to add or remove a file", async () => {
    adminAccess.isAdmin = false;
    const user = userEvent.setup();
    await renderView();

    await user.click(screen.getAllByRole("button", { name: /open attachments for/i })[0]);
    const dialog = await screen.findByRole("dialog", { name: /attachments for/i });

    expect(within(dialog).queryByRole("button", { name: /add file/i })).toBeNull();
    await waitFor(() =>
      expect(within(dialog).queryByRole("button", { name: /^remove /i })).toBeNull(),
    );
  });

  it("lets an ADMIN add a file from the register", async () => {
    adminAccess.isAdmin = true;
    const user = userEvent.setup();
    await renderView();

    await user.click(screen.getAllByRole("button", { name: /open attachments for/i })[0]);
    const dialog = await screen.findByRole("dialog", { name: /attachments for/i });

    expect(within(dialog).getByRole("button", { name: /add file/i })).toBeInTheDocument();
  });

  it("closes again", async () => {
    const user = userEvent.setup();
    await renderView();

    await user.click(screen.getAllByRole("button", { name: /open attachments for/i })[0]);
    const dialog = await screen.findByRole("dialog", { name: /attachments for/i });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /attachments for/i })).toBeNull(),
    );
  });
});
