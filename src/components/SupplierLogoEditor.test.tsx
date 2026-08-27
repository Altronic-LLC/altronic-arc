import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { Supplier } from "@/types/task";
import { SupplierLogoEditor } from "./SupplierLogoEditor";
import { pushToast } from "./Toast";

vi.mock("./Toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./Toast")>()),
  pushToast: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// A supplier id that exists in the mock store — MOCK_SUPPLIERS' id 25 (see
// srmMockData.ts) — so an actual upload mutation has a real row to patch.
function supplier(overrides: Partial<Supplier> = {}): Supplier {
  return { id: 25, logo: null, ...overrides } as Supplier;
}

describe("SupplierLogoEditor", () => {
  it("offers 'Add logo' when there's none yet, and uploads a picked image", async () => {
    renderWithProviders(<SupplierLogoEditor supplier={supplier()} />);
    expect(screen.getByRole("button", { name: "Add logo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();

    const file = new File(["bytes"], "logo.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Add logo"), file);

    await waitFor(() => expect(screen.getByText(/uploading/i)).toBeInTheDocument());
  });

  it("offers 'Change' and 'Remove' once a logo exists", () => {
    renderWithProviders(
      <SupplierLogoEditor
        supplier={supplier({ logo: { fileName: "Reserved_ImageAttachment_x.png", originalImageName: "x.png" } })}
      />,
    );
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  // userEvent.upload() filters against the input's `accept="image/*"` and
  // silently drops a non-matching file with no change event — exactly the
  // browser behaviour this validation is a backstop for on browsers/OSes
  // that don't enforce `accept`. Drive the change event directly so the
  // component's own guard is what's under test, not the browser's.
  it("rejects a non-image file without uploading", () => {
    renderWithProviders(<SupplierLogoEditor supplier={supplier()} />);
    const file = new File(["not an image"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Add logo"), { target: { files: [file] } });

    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/image file/i) }),
    );
    expect(screen.queryByText(/uploading/i)).not.toBeInTheDocument();
  });

  it("rejects an oversized file without uploading", () => {
    renderWithProviders(<SupplierLogoEditor supplier={supplier()} />);
    const big = new File([new Uint8Array(6 * 1024 * 1024)], "huge.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Add logo"), { target: { files: [big] } });

    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/too large/i) }),
    );
    expect(screen.queryByText(/uploading/i)).not.toBeInTheDocument();
  });
});
