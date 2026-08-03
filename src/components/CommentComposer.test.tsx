import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentComposer } from "./CommentComposer";
import { MENTION_CANDIDATE_LIMIT } from "@/lib/mentions";
import type { Person } from "@/types/task";

// jsdom doesn't implement scrollIntoView. The composer optional-calls it, so
// the component works without this — but the "highlight scrolls into view"
// test needs something to spy on.
const scrollIntoView = vi.fn();
let originalScrollIntoView: unknown;
beforeAll(() => {
  originalScrollIntoView = (Element.prototype as unknown as Record<string, unknown>)
    .scrollIntoView;
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterAll(() => {
  (Element.prototype as unknown as Record<string, unknown>).scrollIntoView =
    originalScrollIntoView;
});

/**
 * `count` people who all share the first name "Mike" — the reported bug:
 * Altronic has several, and the old hard cap of 6 made the later ones
 * unreachable with no sign that they existed.
 */
function manyMikes(count: number): Person[] {
  return Array.from({ length: count }, (_, i) => ({
    displayName: `Mike Surname${String(i + 1).padStart(2, "0")}`,
    email: `mike${i + 1}@altronic-llc.com`,
    lookupId: 1000 + i,
  }));
}

function setup(people: Person[], onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const user = userEvent.setup();
  render(<CommentComposer onSubmit={onSubmit} mentionablePeople={people} />);
  return { user, onSubmit, textarea: screen.getByRole("textbox") };
}

const listbox = () => screen.getByRole("listbox", { name: /mention someone/i });

describe("CommentComposer — mention picker opens", () => {
  it("shows the picker when the user types @", async () => {
    const { user, textarea } = setup(manyMikes(3));
    await user.type(textarea, "@");
    expect(listbox()).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("filters the list as the user keeps typing", async () => {
    const { user, textarea } = setup([
      { displayName: "Mike Adams", email: "ma@x.com", lookupId: 1 },
      { displayName: "Sarah Shaffer", email: "ss@x.com", lookupId: 2 },
    ]);
    await user.type(textarea, "@sha");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Sarah Shaffer/ })).toBeInTheDocument();
  });

  it("closes the picker on Escape", async () => {
    const { user, textarea } = setup(manyMikes(3));
    await user.type(textarea, "@");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("CommentComposer — every match for a common name is reachable", () => {
  // REGRESSION: this is the reported bug. With the old `matches.slice(0, 6)`
  // cap, the 7th..20th Mike were never rendered, so the person you wanted
  // simply wasn't offered.
  it("renders all 20 people sharing a first name, not just the first six", async () => {
    const { user, textarea } = setup(manyMikes(20));
    await user.type(textarea, "@Mike");
    expect(screen.getAllByRole("option")).toHaveLength(20);
    expect(screen.getByRole("option", { name: /Mike Surname20/ })).toBeInTheDocument();
  });

  it("lets the user pick the 20th match", async () => {
    const { user, textarea, onSubmit } = setup(manyMikes(20));
    await user.type(textarea, "@Mike");
    await user.click(screen.getByRole("option", { name: /Mike Surname20/ }));
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.stringContaining('data-email="mike20@altronic-llc.com"'),
      [],
    );
  });

  it("scrolls to reach them — the popup is a bounded scroll area", async () => {
    const { user, textarea } = setup(manyMikes(20));
    await user.type(textarea, "@Mike");
    const popup = listbox();
    expect(popup.className).toContain("overflow-y-auto");
    // Tall enough to clip a row so the list visibly continues past the edge,
    // rather than looking like the whole set.
    expect(popup.className).toContain("max-h-72");
  });
});

describe("CommentComposer — the render bound is visible, never silent", () => {
  it("tells the user how many matches are hidden when the cap bites", async () => {
    const total = MENTION_CANDIDATE_LIMIT + 12;
    const { user, textarea } = setup(manyMikes(total));
    await user.type(textarea, "@Mike");
    expect(screen.getAllByRole("option")).toHaveLength(MENTION_CANDIDATE_LIMIT);
    expect(
      within(listbox()).getByText(
        new RegExp(`Showing ${MENTION_CANDIDATE_LIMIT} of ${total} matches`),
      ),
    ).toBeInTheDocument();
    expect(within(listbox()).getByText(/keep typing to narrow/i)).toBeInTheDocument();
  });

  it("shows no hint when every match is on screen", async () => {
    const { user, textarea } = setup(manyMikes(20));
    await user.type(textarea, "@Mike");
    expect(within(listbox()).queryByText(/keep typing to narrow/i)).not.toBeInTheDocument();
  });

  it("drops the hint again once the query narrows under the cap", async () => {
    const { user, textarea } = setup(manyMikes(MENTION_CANDIDATE_LIMIT + 12));
    // A bare "@" matches everyone, so the cap bites and must be announced.
    await user.type(textarea, "@");
    expect(within(listbox()).getByText(/keep typing to narrow/i)).toBeInTheDocument();
    // The query is a single token (a space closes the picker), so narrowing
    // means typing the surname — which the substring filter matches.
    await user.type(textarea, "Surname01");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(within(listbox()).queryByText(/keep typing to narrow/i)).not.toBeInTheDocument();
  });
});

describe("CommentComposer — keyboard navigation covers the whole list", () => {
  it("arrows past the visible rows and picks the 10th match with Enter", async () => {
    const { user, textarea, onSubmit } = setup(manyMikes(20));
    await user.type(textarea, "@Mike");
    // Start on index 0; nine ArrowDowns lands on index 9 = Mike Surname10.
    await user.keyboard("{ArrowDown>9/}");
    expect(screen.getByRole("option", { name: /Mike Surname10/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.stringContaining('data-email="mike10@altronic-llc.com"'),
      [],
    );
  });

  it("wraps from the last match back to the first", async () => {
    const { user, textarea } = setup(manyMikes(20));
    await user.type(textarea, "@Mike");
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("option", { name: /Mike Surname20/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /Mike Surname01/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("scrolls the highlighted option into view as you arrow down", async () => {
    const { user, textarea } = setup(manyMikes(20));
    await user.type(textarea, "@Mike");
    scrollIntoView.mockClear();
    await user.keyboard("{ArrowDown>12/}");
    expect(scrollIntoView).toHaveBeenCalled();
    // Called on the highlighted row (index 12 = Mike Surname13), not the popup.
    const lastCallTarget = scrollIntoView.mock.instances.at(-1) as HTMLElement;
    expect(lastCallTarget).toHaveTextContent("Mike Surname13");
  });

  it("Tab also accepts the highlighted match", async () => {
    const { user, textarea, onSubmit } = setup(manyMikes(20));
    await user.type(textarea, "@Mike");
    await user.keyboard("{ArrowDown>6/}");
    await user.keyboard("{Tab}");
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.stringContaining('data-email="mike7@altronic-llc.com"'),
      [],
    );
  });
});
