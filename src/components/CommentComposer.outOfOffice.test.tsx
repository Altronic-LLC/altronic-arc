import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentComposer } from "./CommentComposer";
import { __resetMailTipsCache } from "@/api/mailTips";
import type { Person } from "@/types/task";

// =============================================================================
// The comment box says who is out of office BEFORE Send (BusinessIT#4). Demo
// mode: api/mailTips.ts answers that the synthetic Marcus Webb is always away
// and everyone else isn't, so this runs the real hook and lookup.
// =============================================================================

const MARCUS: Person = { displayName: "Marcus Webb", email: "marcus.webb@altronic-llc.com", lookupId: 7 };
const SARAH: Person = { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com", lookupId: 8 };

function setup(props: { notifies?: Person[] } = {}) {
  const user = userEvent.setup();
  render(
    <CommentComposer onSubmit={vi.fn().mockResolvedValue(undefined)} mentionablePeople={[MARCUS, SARAH]} {...props} />,
  );
  return { user, textarea: screen.getByRole("textbox") };
}

const note = () => screen.queryByRole("status", { name: "Out of office" });

async function mention(user: ReturnType<typeof userEvent.setup>, textarea: HTMLElement, name: string) {
  await user.type(textarea, `@${name.split(" ")[0]}`);
  await user.click(await screen.findByRole("option", { name: new RegExp(name) }));
}

beforeEach(() => {
  __resetMailTipsCache();
});

describe("CommentComposer — out of office before Send", () => {
  it("shows a mentioned person's automatic reply as soon as they're picked", async () => {
    const { user, textarea } = setup();
    await mention(user, textarea, "Marcus Webb");
    expect(await screen.findByText("Marcus Webb is out of office")).toBeInTheDocument();
    expect(note()).toHaveTextContent(/out of the office this week/);
  });

  it("says nothing for somebody who isn't away", async () => {
    const { user, textarea } = setup();
    await mention(user, textarea, "Sarah Shaffer");
    await user.type(textarea, "thanks");
    expect(note()).toBeNull();
  });

  it("drops the note when the mention is deleted from the text", async () => {
    const { user, textarea } = setup();
    await mention(user, textarea, "Marcus Webb");
    await screen.findByText("Marcus Webb is out of office");
    await user.clear(textarea);
    await user.type(textarea, "never mind");
    expect(note()).toBeNull();
  });

  it("checks a WATCHER only once something is written", async () => {
    const { user, textarea } = setup({ notifies: [MARCUS, SARAH] });
    // Opening the page asks nothing and shows nothing — given long enough
    // that a lookup, had one started, would have answered.
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(note()).toBeNull();
    await user.type(textarea, "Update on the BOM");
    expect(await screen.findByText("Marcus Webb is out of office")).toBeInTheDocument();
  });
});
