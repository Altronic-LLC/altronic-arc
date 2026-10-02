import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_EIRS } from "@/data/mockData";

// A comment that is ONLY an attachment (no text) must notify the same people
// as a text comment (Ray, 2026-10-02). Driven through the real view +
// composer; the email's wording is pinned in api/email.attachmentOnly.test.ts.

vi.mock("@/api/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/email")>()),
  notifyMentions: vi.fn(() => Promise.resolve({ sent: [], failed: [] })),
  notifyChangeEmails: vi.fn(() => Promise.resolve({ sent: [], failed: [] })),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

import { notifyMentions } from "@/api/email";
import { EirDetailView } from "./EirDetailView";

const EIR = MOCK_EIRS.find((e) => e.assignedEngineers.length > 0 && e.watchers.length > 0)!;

beforeEach(() => vi.mocked(notifyMentions).mockClear());

async function renderEir() {
  renderWithProviders(<EirDetailView />, { route: `/eir/${EIR.id}`, routePattern: "/eir/:id" });
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
}

/** The COMPOSER's file input — the Attachments card above it has one too. */
function composerFileInput(): HTMLInputElement {
  const attach = screen.getAllByRole("button", { name: /^attach$/i }).at(-1)!;
  return attach.parentElement!.querySelector<HTMLInputElement>('input[type="file"]')!;
}

describe("EirDetailView — comment notifications", () => {
  it("an attachment-only comment emails the watchers and the assigned engineer", async () => {
    const user = userEvent.setup();
    await renderEir();
    await user.upload(composerFileInput(), new File(["png"], "shot.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(notifyMentions).toHaveBeenCalledTimes(1));
    const emails = vi.mocked(notifyMentions).mock.calls[0][0].recipients.map((r) => r.email);
    for (const p of [...EIR.watchers, ...EIR.assignedEngineers]) {
      if (p.email && p.email !== "demo.user@altronic-llc.com") expect(emails).toContain(p.email);
    }
  });

  it("a text comment does too (control)", async () => {
    const user = userEvent.setup();
    await renderEir();
    await user.type(screen.getByPlaceholderText(/write a comment/i), "hello");
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(notifyMentions).toHaveBeenCalledTimes(1));
  });
});
