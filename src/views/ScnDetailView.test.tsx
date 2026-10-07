import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetScnMockStore } from "@/api/scns";
import type { Person, Scn, ScnPatch } from "@/types/task";
import { ScnDetailView } from "./ScnDetailView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

vi.mock("@/hooks/useAttachments", () => ({
  useAttachments: () => ({ data: [], isLoading: false, error: null }),
  useUploadAttachment: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDeleteAttachment: () => ({ mutate: vi.fn(), isPending: false }),
  // The comment composer's upload adapter. A mock missing it throws
  // "No export is defined" as soon as a view that wires it renders.
  useCommentFileUpload: () => vi.fn(async () => ({ name: "f.png", webUrl: "u" })),
}));

/**
 * Record what the view asks the API to write, then let the real mock branch
 * run so the screen updates. The PATCH shape is the thing under test: the
 * modal must hand back only the keys that changed, and a checklist tick must
 * send the whole array.
 */
const writes = vi.hoisted(() => ({
  patches: [] as Array<{ id: number; changes: ScnPatch }>,
  watchers: [] as Array<{ id: number; people: Person[] }>,
  assigned: [] as Array<{ id: number; people: Person[] }>,
}));
vi.mock("@/api/scns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/scns")>();
  return {
    ...actual,
    updateScnFields: (id: number, changes: ScnPatch, previous: Scn) => {
      writes.patches.push({ id, changes });
      return actual.updateScnFields(id, changes, previous);
    },
    setScnWatchers: (id: number, people: Person[]) => {
      writes.watchers.push({ id, people });
      return actual.setScnWatchers(id, people);
    },
    setScnAssigned: (id: number, people: Person[]) => {
      writes.assigned.push({ id, people });
      return actual.setScnAssigned(id, people);
    },
  };
});

beforeEach(() => {
  __resetScnMockStore();
  writes.patches.length = 0;
  writes.watchers.length = 0;
  writes.assigned.length = 0;
});

async function renderScn(id = 1) {
  const result = renderWithProviders(<ScnDetailView />, {
    route: `/supply-chain/scn/${id}`,
    routePattern: "/supply-chain/scn/:id",
  });
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  return result;
}

/** The card for one section. */
function section(name: string): HTMLElement {
  return screen.getByRole("heading", { name, level: 2 }).closest("section") as HTMLElement;
}

describe("ScnDetailView — the page", () => {
  it("leads with the SCN# and product, and the three chips", async () => {
    await renderScn();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("2026-0148 — DD-40NTS");
    const header = heading.parentElement as HTMLElement;
    expect(within(header).getByText("WIP")).toBeInTheDocument();
    expect(within(header).getByText("Approved")).toBeInTheDocument();
    expect(within(header).getByText("OBS")).toBeInTheDocument();
  });

  it("links to the SCN Documents library", async () => {
    await renderScn();
    expect(screen.getByRole("link", { name: /^Documents$/ })).toHaveAttribute(
      "href",
      "/supply-chain/scns/documents",
    );
  });

  it("lays the notice out as the four descriptor cards, each with one Edit button", async () => {
    await renderScn();
    for (const name of ["Notice", "Parts", "Review", "Outcome"]) {
      expect(screen.getByRole("heading", { name, level: 2 })).toBeInTheDocument();
      // Exactly one Edit affordance per card — no per-field editors. (The
      // comment thread below has its own Edit on the signed-in user's
      // comment, which is why this is scoped to the card.)
      expect(within(section(name)).getAllByRole("button", { name: /^Edit/ })).toHaveLength(1);
      expect(within(section(name)).getByRole("button", { name: `Edit ${name}` })).toBeInTheDocument();
    }
  });

  it("shows each field under the label the list uses, not its internal column name", async () => {
    await renderScn();
    const notice = section("Notice");
    expect(within(notice).getByText("Product")).toBeInTheDocument();
    expect(within(notice).getByText("Category")).toBeInTheDocument();
    expect(within(notice).getByText("Multiple")).toBeInTheDocument(); // Customer
    const parts = section("Parts");
    expect(within(parts).getByText("Old Number")).toBeInTheDocument();
    expect(within(parts).getByText(/791080-1/)).toBeInTheDocument();
    expect(screen.queryByText(/PartsEffected|Progress|Priority/)).toBeNull();
  });

  it("renders the Planner link read-only, opening in a new tab", async () => {
    await renderScn();
    const link = within(section("Outcome")).getByRole("link", { name: /DD-40NTS obsolescence plan/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("tasks.office.com"));
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("formats a date-only column as a date, and says Not set for an empty one", async () => {
    await renderScn(3);
    const outcome = section("Outcome");
    expect(within(outcome).getByText("LTS Expires").parentElement).toHaveTextContent(/2027/);
    const review = section("Review");
    expect(within(review).getByText("Fixture Review").parentElement).toHaveTextContent("Not set");
  });

  it("says who raised it and when", async () => {
    await renderScn();
    expect(screen.getByText("Raised by").parentElement).toHaveTextContent("Ray White");
  });

  it("says so plainly when the SCN doesn't exist", async () => {
    renderWithProviders(<ScnDetailView />, {
      route: "/supply-chain/scn/999999",
      routePattern: "/supply-chain/scn/:id",
    });
    await waitFor(() => expect(screen.getByText(/doesn't exist/i)).toBeInTheDocument());
  });

  it("has no delete control", async () => {
    await renderScn();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});

describe("ScnDetailView — the card Edit modal", () => {
  it("saves ONLY the keys that changed", async () => {
    await renderScn();
    await userEvent.click(screen.getByRole("button", { name: "Edit Notice" }));
    const dialog = await screen.findByRole("dialog", { name: /edit notice/i });
    const customer = within(dialog).getByRole("textbox", { name: "Customer" });
    await userEvent.clear(customer);
    await userEvent.type(customer, "Caterpillar");
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(writes.patches).toHaveLength(1));
    expect(writes.patches[0]).toEqual({ id: 1, changes: { customer: "Caterpillar" } });
    await waitFor(() =>
      expect(within(section("Notice")).getByText("Caterpillar")).toBeInTheDocument(),
    );
  });

  it("leaves the record alone when cancelled", async () => {
    await renderScn();
    await userEvent.click(screen.getByRole("button", { name: "Edit Parts" }));
    const dialog = await screen.findByRole("dialog", { name: /edit parts/i });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "ECN" }), "260001");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(writes.patches).toHaveLength(0);
    expect(within(section("Parts")).queryByText("260001")).toBeNull();
  });

  it("offers the Category as a dropdown and the Product as text, under their labels", async () => {
    await renderScn();
    await userEvent.click(screen.getByRole("button", { name: "Edit Notice" }));
    const dialog = await screen.findByRole("dialog", { name: /edit notice/i });
    expect(within(dialog).getByRole("textbox", { name: "Product" })).toHaveValue("DD-40NTS");
    // Four categories — past the pill limit, so a searchable dropdown.
    expect(within(dialog).getByRole("button", { name: "Category" })).toBeInTheDocument();
  });

  it("never offers the read-only Task List or the checklists in the modal", async () => {
    await renderScn();
    await userEvent.click(screen.getByRole("button", { name: "Edit Outcome" }));
    const outcome = await screen.findByRole("dialog", { name: /edit outcome/i });
    expect(within(outcome).queryByText("Task List")).toBeNull();
    expect(within(outcome).getByRole("textbox", { name: "Notes" })).toBeInTheDocument();
    await userEvent.click(within(outcome).getByRole("button", { name: "Cancel" }));

    await userEvent.click(screen.getByRole("button", { name: "Edit Review" }));
    const review = await screen.findByRole("dialog", { name: /edit review/i });
    expect(within(review).queryByText("Preliminary Reviews")).toBeNull();
    expect(within(review).getByRole("textbox", { name: "Sign-off status" })).toBeInTheDocument();
  });

  it("writes a date picked in the modal as a Date on the patch", async () => {
    await renderScn();
    await userEvent.click(screen.getByRole("button", { name: "Edit Outcome" }));
    const dialog = await screen.findByRole("dialog", { name: /edit outcome/i });
    // Type into Final Disposition too, so the date isn't the only change and
    // the two kinds travel together in one patch.
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Final Disposition" }), "LTB agreed");
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(writes.patches).toHaveLength(1));
    expect(writes.patches[0].changes).toEqual({ finalDisposition: "LTB agreed" });
  });
});

describe("ScnDetailView — the review checklists", () => {
  it("renders every option as a box, ticked or not, with a progress count", async () => {
    await renderScn();
    const review = section("Review");
    expect(within(review).getByRole("checkbox", { name: "Master List Reviewed" })).toBeChecked();
    expect(within(review).getByRole("checkbox", { name: "Price List Reviewed" })).not.toBeChecked();
    expect(within(review).getByText("1/4")).toBeInTheDocument();
    // Three checklists, 12 boxes.
    expect(within(review).getAllByRole("checkbox")).toHaveLength(12);
  });

  it("ticks a box in place and writes the WHOLE array, in the column's own order", async () => {
    await renderScn();
    const review = section("Review");
    await userEvent.click(within(review).getByRole("checkbox", { name: "Price List Reviewed" }));
    await waitFor(() => expect(writes.patches).toHaveLength(1));
    expect(writes.patches[0]).toEqual({
      id: 1,
      changes: { preliminaryReviews: ["Master List Reviewed", "Price List Reviewed"] },
    });
    await waitFor(() =>
      expect(within(section("Review")).getByRole("checkbox", { name: "Price List Reviewed" })).toBeChecked(),
    );
    expect(within(section("Review")).getByText("2/4")).toBeInTheDocument();
  });

  it("unticks the same way, sending what is left", async () => {
    await renderScn();
    await userEvent.click(within(section("Review")).getByRole("checkbox", { name: "Master List Reviewed" }));
    await waitFor(() => expect(writes.patches).toHaveLength(1));
    expect(writes.patches[0].changes).toEqual({ preliminaryReviews: [] });
  });
});

describe("ScnDetailView — the sidebar", () => {
  it("changes the status immediately from the picker", async () => {
    await renderScn();
    await userEvent.click(screen.getByRole("button", { name: "SCN Status" }));
    await userEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "On Hold" }));
    await waitFor(() => expect(writes.patches).toHaveLength(1));
    expect(writes.patches[0]).toEqual({ id: 1, changes: { status: "On Hold" } });
  });

  it("changes the approval from the pills, with no Not set option", async () => {
    await renderScn();
    const group = screen.getByRole("radiogroup", { name: "Approval Status" });
    expect(within(group).queryByRole("radio", { name: /not set/i })).toBeNull();
    await userEvent.click(within(group).getByRole("radio", { name: "Denied" }));
    await waitFor(() => expect(writes.patches).toHaveLength(1));
    expect(writes.patches[0]).toEqual({ id: 1, changes: { approvalStatus: "Denied" } });
  });

  it("unwatches and watches the signed-in user with the one button", async () => {
    // SCN 1: Ray already watches.
    await renderScn();
    await userEvent.click(screen.getByRole("button", { name: "Unwatch" }));
    await waitFor(() => expect(writes.watchers).toHaveLength(1));
    expect(writes.watchers[0].id).toBe(1);
    expect(writes.watchers[0].people.map((p) => p.email)).not.toContain("ray.white@altronic-llc.com");
    expect(writes.watchers[0].people.map((p) => p.email)).toContain("sarah.shaffer@altronic-llc.com");
    await waitFor(() => expect(screen.getByRole("button", { name: "Watch" })).toBeInTheDocument());
  });

  it("starts out as Watch on an SCN nobody is watching", async () => {
    // SCN 7 has no watchers.
    await renderScn(7);
    await userEvent.click(screen.getByRole("button", { name: "Watch" }));
    await waitFor(() => expect(writes.watchers).toHaveLength(1));
    expect(writes.watchers[0].people.map((p) => p.email)).toEqual(["ray.white@altronic-llc.com"]);
  });

  it("assigns somebody from the picker, sending the whole next list", async () => {
    // SCN 6 is assigned to nobody.
    await renderScn(6);
    await userEvent.click(screen.getByText("Nobody assigned").closest("button")!);
    await userEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", { name: "Sarah Shaffer" }),
    );
    await waitFor(() => expect(writes.assigned).toHaveLength(1));
    expect(writes.assigned[0].id).toBe(6);
    expect(writes.assigned[0].people.map((p) => p.displayName)).toEqual(["Sarah Shaffer"]);
  });
});

describe("ScnDetailView — comments and attachments", () => {
  it("offers the comment thread", async () => {
    await renderScn();
    expect(screen.getByRole("heading", { name: "Comments", level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/Master list reviewed — 14 active customers/)).toBeInTheDocument();
  });

  it("posts a comment", async () => {
    await renderScn();
    await userEvent.type(screen.getByPlaceholderText(/comment/i), "LTB quantities confirmed.");
    await userEvent.click(screen.getByRole("button", { name: /post|send|comment/i }));
    await waitFor(() =>
      expect(screen.getByText("LTB quantities confirmed.")).toBeInTheDocument(),
    );
  });

  it("offers an attachments card", async () => {
    await renderScn();
    expect(screen.getByText("Attachments")).toBeInTheDocument();
  });
});
