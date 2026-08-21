import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { SharePointUnavailableError } from "@/api/sharepoint";

// =============================================================================
// "Attachments unavailable" has two very different causes and used to give one
// answer: ask an admin. When the real cause is the reader's own expired MFA,
// that sends them to raise a ticket for something they can fix in ten seconds
// (Ray, 2026-08-20 — AADSTS50078 on the ECN attachments card).
// =============================================================================

const refreshSharePointAccess = vi.hoisted(() => vi.fn(async () => undefined));
const useAttachments = vi.hoisted(() => vi.fn());

vi.mock("@/api/sharepoint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/sharepoint")>();
  return { ...actual, refreshSharePointAccess };
});

vi.mock("@/hooks/useAttachments", () => ({
  useAttachments,
  useUploadAttachment: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDeleteAttachment: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AttachmentsSection } from "./AttachmentsSection";

function withError(error: unknown, refetch = vi.fn()) {
  useAttachments.mockReturnValue({ data: [], isLoading: false, error, refetch });
  renderWithProviders(<AttachmentsSection parent="ecn" itemId={1} />, {
    route: "/engineering/ecn/1",
    routePattern: "/engineering/ecn/:id",
  });
  return refetch;
}

beforeEach(() => {
  refreshSharePointAccess.mockClear();
});

describe("when the reader's own session expired", () => {
  const mfaError = new SharePointUnavailableError(
    "Your multi-factor authentication has expired for this resource. Sign in again and approve the prompt on your phone. (AADSTS50078)",
    "reauth",
  );

  it("says it's the session, and doesn't mention an admin", () => {
    withError(mfaError);
    expect(screen.getByText(/multi-factor authentication has expired/i)).toBeInTheDocument();
    expect(screen.queryByText(/an admin grants/i)).not.toBeInTheDocument();
  });

  it("offers a way to fix it, and reloads once it's done", async () => {
    const refetch = withError(mfaError);
    await userEvent.click(screen.getByRole("button", { name: /sign in again/i }));

    await waitFor(() => expect(refreshSharePointAccess).toHaveBeenCalled());
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it("says so when the sign-in doesn't complete, rather than looking stuck", async () => {
    refreshSharePointAccess.mockRejectedValueOnce(new Error("Popup was blocked"));
    withError(mfaError);
    await userEvent.click(screen.getByRole("button", { name: /sign in again/i }));
    expect(await screen.findByText(/Popup was blocked/)).toBeInTheDocument();
  });
});

describe("when the app really is missing the grant", () => {
  it("keeps the admin instructions, and offers no sign-in button", () => {
    withError(
      new SharePointUnavailableError(
        "Attachments need an additional SharePoint REST scope that an admin hasn't granted yet.",
        "consent",
      ),
    );
    expect(screen.getByText(/an admin grants/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign in again/i })).not.toBeInTheDocument();
  });

  // A plain failure is not evidence of either cause; it must not grow a
  // sign-in button that can't help.
  it("treats an unrecognised error as the admin case", () => {
    withError(new Error("Failed to fetch"));
    expect(screen.queryByRole("button", { name: /sign in again/i })).not.toBeInTheDocument();
  });
});
