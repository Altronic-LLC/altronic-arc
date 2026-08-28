import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MaintenanceTaskRow } from "./MaintenanceTaskRow";
import { TECH, day, makeTask } from "@/test/maintenanceFixtures";

const NOW = new Date("2026-08-27T15:00:00Z");

describe("MaintenanceTaskRow", () => {
  it("leads with the WO number, title and status", () => {
    render(
      <MaintenanceTaskRow
        task={makeTask({ id: 1, woNumber: "WO-2026-0007", title: "Compressor tripping" })}
        onOpen={() => {}}
        now={NOW}
      />,
    );
    expect(screen.getByText("WO-2026-0007")).toBeInTheDocument();
    expect(screen.getByText("Compressor tripping")).toBeInTheDocument();
    expect(screen.getByText("Backlog")).toBeInTheDocument();
  });

  it("opens the work order when clicked", async () => {
    const onOpen = vi.fn();
    render(<MaintenanceTaskRow task={makeTask({ id: 42 })} onOpen={onOpen} now={NOW} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith(42);
  });

  // A maintenance list is read to find what is LATE. Burying that at the end
  // of a metadata row makes the reader scan for the one thing the screen
  // exists to surface, so an overdue row puts it above the title.
  it("puts the overdue label above the title, in bold", () => {
    const { container } = render(
      <MaintenanceTaskRow
        task={makeTask({ id: 1, title: "Compressor tripping", dueDate: day(-3, NOW) })}
        onOpen={() => {}}
        now={NOW}
      />,
    );
    const late = screen.getByText("3 days late");
    expect(late).toHaveClass("font-semibold");

    const title = screen.getByText("Compressor tripping");
    // Node.DOCUMENT_POSITION_FOLLOWING — the title comes AFTER the due label.
    expect(late.compareDocumentPosition(title) & 4).toBeTruthy();
    expect(container.firstElementChild?.className).toContain("border-cooper-red/40");
  });

  it("keeps an on-track due date down with the other metadata", () => {
    render(
      <MaintenanceTaskRow
        task={makeTask({ id: 1, title: "Oil change", dueDate: day(4, NOW) })}
        onOpen={() => {}}
        now={NOW}
      />,
    );
    const due = screen.getByText("Due in 4 days");
    const title = screen.getByText("Oil change");
    expect(title.compareDocumentPosition(due) & 4).toBeTruthy();
  });

  // A finished job whose due date went past is not outstanding work.
  it("does not shout about a closed work order's old due date", () => {
    render(
      <MaintenanceTaskRow
        task={makeTask({ id: 1, status: "Complete", dueDate: day(-40, NOW) })}
        onOpen={() => {}}
        now={NOW}
      />,
    );
    expect(screen.getByText("40 days late")).toBeInTheDocument();
    expect(document.querySelector(".border-cooper-red\\/40")).toBeNull();
  });

  // The Power Automate flow owns this column — it is shown, never offered as
  // a control.
  it("shows DueStatus as a plain chip with no picker", () => {
    render(
      <MaintenanceTaskRow task={makeTask({ id: 1, dueStatus: "Late" })} onOpen={() => {}} now={NOW} />,
    );
    const chip = screen.getByText("Late");
    expect(chip.tagName).toBe("SPAN");
    expect(chip).toHaveAttribute("title", expect.stringMatching(/never writes/i));
  });

  it("names the asset, or says there isn't one", () => {
    const { rerender } = render(
      <MaintenanceTaskRow
        task={makeTask({ id: 1, equipment: { lookupId: 3, title: "40 HP COMPRESSOR" } })}
        onOpen={() => {}}
        now={NOW}
      />,
    );
    expect(screen.getByText("40 HP COMPRESSOR")).toBeInTheDocument();
    rerender(<MaintenanceTaskRow task={makeTask({ id: 1 })} onOpen={() => {}} now={NOW} />);
    expect(screen.getByText("No asset")).toBeInTheDocument();
  });

  // A title-less lookup must not render as blank — an asset that IS set has
  // to look set (lib/maintenanceShared.ts's "User #46" rule, applied to a row).
  it("falls back to the asset id when the lookup has no title yet", () => {
    render(
      <MaintenanceTaskRow
        task={makeTask({ id: 1, equipment: { lookupId: 3, title: "" } })}
        onOpen={() => {}}
        now={NOW}
      />,
    );
    expect(screen.getByText("Asset #3")).toBeInTheDocument();
  });

  it("says who it is assigned to, or that nobody has it", () => {
    const { rerender } = render(
      <MaintenanceTaskRow task={makeTask({ id: 1, assigned: TECH })} onOpen={() => {}} now={NOW} />,
    );
    expect(screen.getByText(/David Bulkley/)).toBeInTheDocument();
    rerender(<MaintenanceTaskRow task={makeTask({ id: 1 })} onOpen={() => {}} now={NOW} />);
    expect(screen.getByText(/Unassigned/)).toBeInTheDocument();
  });

  it("shows the newest comment, and says so when there are none", () => {
    const { rerender } = render(
      <MaintenanceTaskRow
        task={makeTask({
          id: 1,
          comments: [
            {
              timestamp: new Date("2026-08-26T12:00:00Z"),
              authorName: "Alyssa Garrett",
              authorEmail: "alyssa.garrett@altronic-llc.com",
              bodyHtml: "<p>Tripped twice this shift.</p>",
              attachments: [],
            },
          ],
        })}
        onOpen={() => {}}
        now={NOW}
      />,
    );
    expect(screen.getByText("Tripped twice this shift.")).toBeInTheDocument();
    rerender(<MaintenanceTaskRow task={makeTask({ id: 1 })} onOpen={() => {}} now={NOW} />);
    expect(screen.getByText("No comments yet")).toBeInTheDocument();
  });

  it("falls back to the item id when there is no WO number", () => {
    render(<MaintenanceTaskRow task={makeTask({ id: 7, woNumber: "" })} onOpen={() => {}} now={NOW} />);
    expect(screen.getByText("#7")).toBeInTheDocument();
  });
});
