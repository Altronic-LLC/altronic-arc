import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { ListView, readStatusParam, statusParamFor } from "./ListView";

// =============================================================================
// The task List's status pill lives in `?status=` (Altronic-LLC/BusinessIT#12),
// so a saved filter can carry it. Absent = Active (the default); `ALL` = the
// pill switched off; a status = that status.
// =============================================================================

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

function Loc() {
  return <div data-testid="loc">{useLocation().search}</div>;
}

const status = () => new URLSearchParams(screen.getByTestId("loc").textContent ?? "").get("status");

describe("status in the URL", () => {
  it("reads and writes the three shapes", () => {
    expect(readStatusParam(null)).toBe("ALL_ACTIVE");
    expect(readStatusParam("nonsense")).toBe("ALL_ACTIVE");
    expect(readStatusParam("ALL")).toBeNull();
    expect(readStatusParam("Blocked")).toBe("Blocked");
    expect(statusParamFor("ALL_ACTIVE")).toBeNull();
    expect(statusParamFor(null)).toBe("ALL");
    expect(statusParamFor("Blocked")).toBe("Blocked");
  });

  it("a pill click writes ?status=, and the default leaves it out", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <ListView />
        <Loc />
      </>,
      {
        route: "/list?assigned=",
        seedQueryData: [
          { key: ["tasks", "list"], data: [] },
          { key: ["projects"], data: [] },
        ],
      },
    );
    expect(status()).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Blocked/ }));
    expect(status()).toBe("Blocked");
    await user.click(screen.getByRole("button", { name: /^Blocked/ }));
    expect(status()).toBe("ALL");
    await user.click(screen.getByRole("button", { name: /^Active/ }));
    expect(status()).toBeNull();
  });
});
