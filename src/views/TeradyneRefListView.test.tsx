import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { TeradyneRefListView } from "./TeradyneRefListView";

// USE_MOCK is true under Vitest — this renders against the mock reference lists.

beforeEach(() => {
  vi.restoreAllMocks();
});

async function renderKind(kind: string) {
  const result = renderWithProviders(<TeradyneRefListView />, {
    route: `/operations/teradyne/${kind}`,
    routePattern: "/operations/teradyne/:kind",
  });
  await waitFor(() =>
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument(),
  );
  return result;
}

describe("TeradyneRefListView — employees", () => {
  it("lists employees with their clock number and work center", async () => {
    await renderKind("employees");
    expect(screen.getByRole("heading", { name: "Teradyne Employees" })).toBeInTheDocument();
    expect(await screen.findByText("Dave Anderson")).toBeInTheDocument();
    expect(screen.getByText(/Clock #312 · COAT/)).toBeInTheDocument();
  });

  it("takes first + last name on add, since the display name is derived", async () => {
    await renderKind("employees");
    await userEvent.type(screen.getByLabelText(/first name/i), "Nia");
    await userEvent.type(screen.getByLabelText(/last name/i), "Patel");
    await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(await screen.findByText("Nia Patel")).toBeInTheDocument();
  });

  it("renames a row in place", async () => {
    await renderKind("employees");
    await userEvent.click(await screen.findByRole("button", { name: /edit Dave Anderson/i }));
    const first = screen.getByPlaceholderText("First");
    await userEvent.clear(first);
    await userEvent.type(first, "David");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText("David Anderson")).toBeInTheDocument();
  });

  it("abandons an edit on Escape", async () => {
    await renderKind("employees");
    await userEvent.click(await screen.findByRole("button", { name: /edit Sandy Bindas/i }));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByPlaceholderText("First")).not.toBeInTheDocument());
    expect(screen.getByText("Sandy Bindas")).toBeInTheDocument();
  });
});

describe("TeradyneRefListView — products and remarks", () => {
  it("shows a product's test station", async () => {
    await renderKind("products");
    expect(screen.getByRole("heading", { name: "Teradyne Products" })).toBeInTheDocument();
    expect(await screen.findByText("Moris Power Supply")).toBeInTheDocument();
    expect(screen.getAllByText("Spea").length).toBeGreaterThan(0);
  });

  it("adds a remark from a single field", async () => {
    await renderKind("remarks");
    await userEvent.type(screen.getByLabelText(/^remark$/i), "Tombstoned part");
    await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(await screen.findByText("Tombstoned part")).toBeInTheDocument();
  });

  it("keeps Add disabled until something is typed", async () => {
    await renderKind("remarks");
    expect(screen.getByRole("button", { name: /^add$/i })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/^remark$/i), "x");
    expect(screen.getByRole("button", { name: /^add$/i })).toBeEnabled();
  });
});

describe("TeradyneRefListView — delete guard", () => {
  it("keeps delete disabled until the log has loaded, so usage can be trusted", async () => {
    await renderKind("remarks");
    const btn = await screen.findByRole("button", { name: /delete Cold joint/i });
    // Before the log resolves the row looks unused — the button must not be
    // clickable on that basis.
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringMatching(/checking whether/i));
    // Once the log lands, an genuinely unused row becomes deletable.
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it("disables delete for a row the log still references, and says why", async () => {
    await renderKind("remarks");
    // "Wrong board" is used by two entries in the mock log.
    const btn = await screen.findByRole("button", { name: /delete Wrong board/i });
    await waitFor(() =>
      expect(btn).toHaveAttribute("title", expect.stringMatching(/used by 2 log entries/i)),
    );
    expect(btn).toBeDisabled();
  });

  it("allows deleting an unused row, after confirming", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderKind("remarks");
    const created = "Only Here Briefly";
    await userEvent.type(screen.getByLabelText(/^remark$/i), created);
    await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await screen.findByText(created);

    const btn = screen.getByRole("button", { name: new RegExp(`delete ${created}`, "i") });
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(created)).not.toBeInTheDocument());
  });

  it("labels usage counts so it's clear what's safe to remove", async () => {
    // Remarks is the list with both states in the fixture: "Wrong board" is on
    // two entries, "Cold joint" is on none.
    await renderKind("remarks");
    expect(await screen.findByText("Wrong board")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByText(/^\d+ (entry|entries)$/).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("unused").length).toBeGreaterThan(0);
  });
});

describe("TeradyneRefListView — routing", () => {
  it("redirects an unknown list kind back to the log instead of erroring", async () => {
    renderWithProviders(<TeradyneRefListView />, {
      route: "/operations/teradyne/not-a-list",
      routePattern: "/operations/teradyne/:kind",
    });
    // Navigate renders nothing itself; the point is it doesn't throw or show a list.
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /teradyne/i })).not.toBeInTheDocument(),
    );
  });

  it("cross-links to the log and the other two lists", async () => {
    await renderKind("products");
    expect(screen.getByRole("link", { name: /teradyne log/i })).toHaveAttribute(
      "href",
      "/operations/teradyne",
    );
    expect(screen.getByRole("link", { name: /teradyne employees/i })).toHaveAttribute(
      "href",
      "/operations/teradyne/employees",
    );
    expect(screen.getByRole("link", { name: /teradyne remarks/i })).toHaveAttribute(
      "href",
      "/operations/teradyne/remarks",
    );
  });
});
