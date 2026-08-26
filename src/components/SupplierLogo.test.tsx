import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { SupplierLogo } from "./SupplierLogo";

// USE_MOCK is true under Vitest. api/attachments.ts seeds a reserved-image
// attachment for supplier id 25, matching MOCK_SUPPLIERS' fixture logo.

describe("SupplierLogo", () => {
  it("renders the fallback icon when the supplier has no logo", () => {
    renderWithProviders(<SupplierLogo supplierId={29} logo={null} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("resolves the reserved attachment and renders it as an image", async () => {
    renderWithProviders(
      <SupplierLogo
        supplierId={25}
        logo={{ fileName: "Reserved_ImageAttachment_demo_arrow.png", originalImageName: "arrow-logo.png" }}
      />,
    );
    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    expect(screen.getByRole("img")).toHaveAttribute("alt", "arrow-logo.png");
  });

  it("falls back to the icon when the named attachment isn't found", async () => {
    renderWithProviders(
      <SupplierLogo supplierId={25} logo={{ fileName: "nope.png", originalImageName: "" }} />,
    );
    // Give the (mock) fetch a tick to resolve before asserting the negative.
    await waitFor(() => expect(screen.queryByRole("img")).not.toBeInTheDocument());
  });
});
