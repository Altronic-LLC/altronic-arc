import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_ECNS } from "@/data/ecnMockData";
import { EcnFormModal } from "./EcnFormModal";

// =============================================================================
// The duplicate-Log# check, with the list's arrival under this test's control.
//
// SharePoint doesn't enforce a unique Log#, so this check is the only thing
// standing between two notices carrying the same number on a controlled
// record — and it can only run against a loaded list. The first version had no
// guard and the test had no wait, so "has the fetch landed yet?" decided the
// result: green on a fast machine, red on CI, and in production a fast-typing
// user could have saved a duplicate.
//
// Driving the fetch with a promise WE resolve makes "before the list lands"
// an actual assertable moment rather than a race.
// =============================================================================

const listEcns = vi.hoisted(() => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { fn: vi.fn(() => promise), resolve };
});

vi.mock("@/api/ecns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/ecns")>();
  return { ...actual, listEcns: listEcns.fn };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

describe("EcnFormModal — before the ECN list has loaded", () => {
  it("says it can't check the number yet, rather than saving a duplicate", async () => {
    const onCreated = vi.fn();
    renderWithProviders(<EcnFormModal onClose={vi.fn()} onCreated={onCreated} />, {
      route: "/engineering/ecns",
      routePattern: "/engineering/ecns",
    });
    await screen.findByRole("dialog", { name: /new ecn/i });

    // The list is still in flight — nothing has resolved it yet.
    expect(screen.queryByText(/Latest on the list is/)).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^Title/), "PCB ASSEMBLY, WCD-20");
    await userEvent.type(screen.getByLabelText(/^Log#/), "260062");
    await userEvent.click(screen.getByRole("button", { name: /raise ecn/i }));

    expect(
      await screen.findByText(/Still checking the existing Log#s/i),
    ).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();

    // Once the list lands, the same click catches the duplicate properly.
    listEcns.resolve(MOCK_ECNS);
    await waitFor(() =>
      expect(screen.getByText(/Latest on the list is 260062/)).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: /raise ecn/i }));
    expect(
      await screen.findByText(/Log# 260062 is already used by another ECN/i),
    ).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
