import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// The Departments menu once the Parts List is switched live. Its own file
// because Header builds the menu when the module loads, so the switch has to
// be on before the import. The "not live" case is in Header.access.test.tsx.

vi.mock("@/api/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/config")>();
  return { ...actual, PARTS_LIST_LIVE: true };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 0 }),
}));

import { Header } from "./Header";

describe("Departments menu — the Parts List once it's live", () => {
  it("is a link to /engineering/parts", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Header />);
    await user.click(screen.getAllByRole("button", { name: /Departments|Depts/ })[0]);
    // The menu's links carry role="menuitem".
    expect(screen.getByRole("menuitem", { name: /Parts List/ })).toHaveAttribute("href", "/engineering/parts");
  });
});
