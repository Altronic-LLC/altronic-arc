import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { AttachmentsSection } from "./AttachmentsSection";

// USE_MOCK is true under Vitest. api/attachments.ts seeds a reserved-image
// attachment (Reserved_ImageAttachment_...) for supplier id 25 — the file
// behind Suppliers List's Logo column (see SupplierLogo.tsx). It must never
// show up here: showing it invites deleting it through this generic UI,
// which would break the Logo column's reference.

describe("AttachmentsSection", () => {
  it("hides a SharePoint Image column's reserved backing attachment", async () => {
    renderWithProviders(<AttachmentsSection parent="supplier" itemId={25} />);
    await waitFor(() => expect(screen.queryByText(/loading attachments/i)).not.toBeInTheDocument());
    expect(screen.queryByText(/Reserved_ImageAttachment_/)).not.toBeInTheDocument();
    expect(screen.getByText(/no attachments yet/i)).toBeInTheDocument();
  });

  it("shows a real attachment normally", async () => {
    renderWithProviders(<AttachmentsSection parent="supplier" itemId={29} />);
    await waitFor(() => expect(screen.queryByText(/loading attachments/i)).not.toBeInTheDocument());
    expect(screen.getByText(/no attachments yet/i)).toBeInTheDocument();
  });
});
