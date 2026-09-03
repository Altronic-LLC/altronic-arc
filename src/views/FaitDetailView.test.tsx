import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { FaitDetailView } from "./FaitDetailView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

// The test harness doesn't mount ToastContainer, so a real pushToast call
// goes nowhere visible — mocked so the "initiator can't be removed" refusal
// message can actually be asserted on.
const toastMessages = vi.hoisted(() => [] as string[]);
vi.mock("@/components/Toast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/Toast")>();
  return {
    ...actual,
    pushToast: (input: { message: string }) => {
      toastMessages.push(input.message);
      return "toast-id";
    },
  };
});

const uploadFaitAttachment = vi.hoisted(() =>
  vi.fn(async (file: File) => ({
    fileName: file.name,
    downloadUrl: `https://example.sharepoint.com/attachments/${file.name}`,
    serverRelativeUrl: `/attachments/${file.name}`,
  })),
);

vi.mock("@/hooks/useAttachments", () => ({
  useAttachments: () => ({ data: [], isLoading: false, error: null }),
  useUploadAttachment: () => ({
    mutate: vi.fn(),
    mutateAsync: uploadFaitAttachment,
    isPending: false,
    error: null,
  }),
  useDeleteAttachment: () => ({ mutate: vi.fn(), isPending: false }),
}));

async function renderFait(id = 2) {
  const result = renderWithProviders(<FaitDetailView />, {
    route: `/supply-chain/fait/${id}`,
    routePattern: "/supply-chain/fait/:id",
  });
  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument(),
  );
  return result;
}

describe("FaitDetailView", () => {
  it("heads the page with the part, not the empty title", async () => {
    await renderFait();
    expect(screen.getByRole("heading", { name: "710213", level: 1 })).toBeInTheDocument();
    // Twice: the subtitle under the heading, and the Description field on
    // the Part card.
    expect(screen.getAllByText(/CASTING, ENCLOSURE WCD-10/).length).toBeGreaterThan(0);
  });

  it("lays the workflow out as one card per stage", async () => {
    await renderFait();
    for (const s of ["Part", "Request", "Inspection", "Results", "Sign-off"]) {
      expect(screen.getByRole("heading", { name: s, level: 2 })).toBeInTheDocument();
    }
  });

  it("gives each card one Edit button and no inline editors", async () => {
    await renderFait();
    for (const s of ["Part", "Request", "Inspection", "Results", "Sign-off"]) {
      expect(screen.getByRole("button", { name: `Edit ${s}` })).toBeInTheDocument();
    }
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  // Nineteen Yes/No columns — spelled out when reading, pills when editing.
  it("spells a Yes/No column out rather than showing a tick", async () => {
    await renderFait();
    const card = screen
      .getByRole("heading", { name: "Request", level: 2 })
      .closest("section") as HTMLElement;
    const row = within(card).getByText("New Supplier Qualification").parentElement as HTMLElement;
    expect(within(row).getByText("Yes")).toBeInTheDocument();
  });

  it("edits a Yes/No column from the card's modal", async () => {
    await renderFait();
    await userEvent.click(screen.getByRole("button", { name: "Edit Request" }));

    const dialog = await screen.findByRole("dialog", { name: /edit request/i });
    const group = within(dialog).getByRole("radiogroup", { name: "New Part" });
    await userEvent.click(within(group).getByRole("radio", { name: "Yes" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      const card = screen
        .getByRole("heading", { name: "Request", level: 2 })
        .closest("section") as HTMLElement;
      const row = within(card).getByText("New Part").parentElement as HTMLElement;
      expect(within(row).getByText("Yes")).toBeInTheDocument();
    });
  });

  it("edits a text field from the card's modal", async () => {
    await renderFait();
    await userEvent.click(screen.getByRole("button", { name: "Edit Part" }));

    const dialog = await screen.findByRole("dialog", { name: /edit part/i });
    const input = within(dialog).getByRole("textbox", { name: "Supplier Name" });
    await userEvent.clear(input);
    await userEvent.type(input, "NEW CASTING CO");
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getAllByText(/NEW CASTING CO/).length).toBeGreaterThan(0));
  });

  // Ray, 2026-08-27: "cannot change status". The page had no status control —
  // only a read-only chip, plus a copy buried in a "Details" edit modal behind
  // an unlabelled pencil. It's a live sidebar picker now, like every other
  // workflow record in ARC, and there is no Details modal to find.
  it("moves the status from the sidebar picker, with no modal to open", async () => {
    await renderFait();
    expect(screen.queryByRole("button", { name: "Edit Details" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Status/ }));
    await userEvent.click(await screen.findByRole("option", { name: "This is with ENG" }));

    await waitFor(() =>
      expect(screen.getAllByText("This is with ENG").length).toBeGreaterThan(0),
    );
  });

  it("re-points the project from the sidebar picker", async () => {
    await renderFait();
    await userEvent.click(screen.getByRole("button", { name: /^Project/ }));
    const option = (await screen.findAllByRole("option"))[1];
    const name = option.textContent ?? "";
    await userEvent.click(option);

    await waitFor(() => expect(screen.getAllByText(name).length).toBeGreaterThan(0));
  });

  it("shows the three sign-offs", async () => {
    await renderFait();
    const sidebar = screen.getByText("Sign-offs").closest("div")?.parentElement as HTMLElement;
    for (const who of ["SQE", "Eng", "KAM"]) {
      expect(within(sidebar).getByText(who)).toBeInTheDocument();
    }
  });

  it("carries the comment thread and watchers", async () => {
    await renderFait();
    expect(screen.getByText(/Dimensional check is done/)).toBeInTheDocument();
    expect(screen.getByText("Watchers")).toBeInTheDocument();
  });

  describe("the initiator always watches their own FAIT", () => {
    // Fixture 1: initiator Sarah Shaffer, watchers = [Sarah] (the sole
    // watcher, so removing her would leave the FAIT with nobody watching).
    // Reported by Ray, 2026-09-03: "confirm the initiator is always on the
    // watchers list" — the picker used to let anyone uncheck them with no
    // guard at all.
    it("refuses to uncheck the initiator from the Watchers picker", async () => {
      toastMessages.length = 0;
      await renderFait(1);
      await userEvent.click(screen.getByRole("button", { name: "Remove Sarah Shaffer" }));

      expect(
        toastMessages.some((m) => /initiator always watches their own FAIT/i.test(m)),
      ).toBe(true);
      // Still there — the toggle was refused, not silently ignored.
      expect(screen.getByRole("button", { name: "Remove Sarah Shaffer" })).toBeInTheDocument();
    });

    it("still allows removing someone who ISN'T the initiator", async () => {
      // Fixture 2 has an assigned engineer already a watcher alongside the
      // initiator — removing them (not the initiator) should go through
      // normally, proving the guard is scoped to the initiator only.
      toastMessages.length = 0;
      await renderFait(2);
      const removeButtons = screen.getAllByRole("button", { name: /^Remove /i });
      const nonInitiatorRemove = removeButtons.find(
        (b) => !b.getAttribute("aria-label")?.includes("Sarah Shaffer"),
      );
      expect(nonInitiatorRemove).toBeDefined();
      await userEvent.click(nonInitiatorRemove!);

      expect(toastMessages.some((m) => /initiator always watches their own FAIT/i.test(m))).toBe(
        false,
      );
    });
  });

  it("takes attachments", async () => {
    await renderFait();
    expect(screen.getByRole("heading", { name: /attachments/i })).toBeInTheDocument();
  });

  // Ray, 2026-08-27: "we cannot figure out how to assign an engineer" — there
  // was no picker at all before this; it was a bare read-only "Not set".
  // Scoped by the picker's own accessible name rather than by walking up the
  // DOM from its label: the two are the same control, and a test that finds it
  // by shape breaks on any layout change without saying anything about
  // behaviour.
  it("assigns an engineer from the sidebar picker", async () => {
    await renderFait(1); // assignedEngineer: null in the fixture
    const picker = screen.getByRole("button", { name: /^Assigned Engineer/ });
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole("option", { name: "Sarah Shaffer" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^Assigned Engineer/ }),
      ).toHaveTextContent("Sarah Shaffer"),
    );
  });

  it("assigns a KAM from the sidebar picker", async () => {
    await renderFait(1); // kam: null in the fixture
    await userEvent.click(screen.getByRole("button", { name: /^KAM/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Ray White" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^KAM/ })).toHaveTextContent("Ray White"),
    );
  });

  // The candidate pool is the directory plus whoever is on a loaded FAIT, and
  // a person column can hold somebody in neither — a leaver, or an account
  // whose mailbox differs from the address the directory lists. The picker has
  // to still show them, or an assignment that IS set reads as "Not set" and
  // the next person to touch it overwrites it silently.
  it("keeps showing an assigned person who isn't among the candidates", async () => {
    await renderFait(2); // fixture 2 carries an assigned engineer
    const picker = screen.getByRole("button", { name: /^Assigned Engineer/ });
    expect(picker).not.toHaveTextContent(/not set/i);
  });

  // Ray, 2026-08-27: "how to hide/remove the KAM signoff when it is not
  // required" — fixture 4 has no KAM assigned and no KAM sign-off data, so
  // the KAM sign-off chip and the Sign-off card's KAM fields both hide.
  describe("when no KAM is needed (fixture 4: no KAM, no KAM sign-off data)", () => {
    it("hides the KAM chip from Sign-offs", async () => {
      await renderFait(4);
      const sidebar = screen.getByText("Sign-offs").closest("div")?.parentElement as HTMLElement;
      expect(within(sidebar).getByText("SQE")).toBeInTheDocument();
      expect(within(sidebar).getByText("Eng")).toBeInTheDocument();
      expect(within(sidebar).queryByText("KAM")).not.toBeInTheDocument();
    });

    it("says no KAM is needed under the picker", async () => {
      await renderFait(4);
      expect(screen.getByText(/no kam needed/i)).toBeInTheDocument();
    });

    it("leaves the KAM fields out of the Sign-off card and its Edit modal", async () => {
      await renderFait(4);
      const card = screen
        .getByRole("heading", { name: "Sign-off", level: 2 })
        .closest("section") as HTMLElement;
      expect(within(card).queryByText("KAM Sign Off")).not.toBeInTheDocument();

      await userEvent.click(within(card).getByRole("button", { name: "Edit Sign-off" }));
      const dialog = await screen.findByRole("dialog", { name: /edit sign-off/i });
      expect(within(dialog).queryByText("KAM Sign Off")).not.toBeInTheDocument();
      expect(within(dialog).getByText("Eng Sign Off")).toBeInTheDocument();
    });
  });

  // Fixture 2 already carries a KAM and sign-off data — the hide rule must
  // never swallow real, pre-existing sign-off data.
  describe("when a KAM sign-off already exists (fixture 2)", () => {
    it("keeps showing the KAM fields on the Sign-off card", async () => {
      await renderFait(2);
      const card = screen
        .getByRole("heading", { name: "Sign-off", level: 2 })
        .closest("section") as HTMLElement;
      expect(within(card).getByText("KAM Sign Off")).toBeInTheDocument();
    });
  });

  it("says so when the FAIT doesn't exist", async () => {
    renderWithProviders(<FaitDetailView />, {
      route: "/supply-chain/fait/999999",
      routePattern: "/supply-chain/fait/:id",
    });
    await waitFor(() =>
      expect(screen.getByText(/that fait doesn't exist/i)).toBeInTheDocument(),
    );
  });
});
