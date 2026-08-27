import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// =============================================================================
// Downloading a file goes through the authenticated `_api/…/$value` fetch
// (fetchAttachmentBlob), never a bare `<a href={downloadUrl} download>` —
// that plain link silently does nothing on a device with no lingering
// SharePoint session cookie, which is the ordinary case on a phone (Ray,
// 2026-08-27: "I need the ability to download attachments from CSA listing
// especially on mobile"). See the doc comment on handleDownload.
// =============================================================================

const ATTACHMENT = {
  fileName: "certificate.pdf",
  downloadUrl: "https://coopermachineryservices.sharepoint.com/sites/x/certificate.pdf",
  serverRelativeUrl: "/sites/x/certificate.pdf",
};

vi.mock("@/hooks/useAttachments", () => ({
  useAttachments: () => ({ data: [ATTACHMENT], isLoading: false, error: null }),
  useUploadAttachment: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDeleteAttachment: () => ({ mutate: vi.fn(), isPending: false }),
}));

const fetchAttachmentBlob = vi.hoisted(() => vi.fn());
const pushToast = vi.hoisted(() => vi.fn());

vi.mock("@/api/attachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/attachments")>();
  return { ...actual, fetchAttachmentBlob };
});

vi.mock("./Toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./Toast")>()),
  pushToast,
}));

import { AttachmentsSection } from "./AttachmentsSection";

let clickSpy: ReturnType<typeof vi.fn>;
let createObjectURLSpy: ReturnType<typeof vi.fn>;
let revokeObjectURLSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchAttachmentBlob.mockReset();
  pushToast.mockClear();
  clickSpy = vi.fn();
  HTMLAnchorElement.prototype.click = clickSpy as unknown as () => void;
  createObjectURLSpy = vi.fn(() => "blob:mock-url");
  revokeObjectURLSpy = vi.fn();
  URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURLSpy as unknown as typeof URL.revokeObjectURL;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AttachmentsSection — downloading a file", () => {
  it("fetches the file through the authenticated endpoint, not the bare downloadUrl", async () => {
    fetchAttachmentBlob.mockResolvedValue(new Blob(["pdf bytes"]));
    renderWithProviders(<AttachmentsSection parent="csaListing" itemId={1} />);

    await userEvent.click(screen.getByRole("button", { name: /download certificate\.pdf/i }));

    await waitFor(() => expect(fetchAttachmentBlob).toHaveBeenCalledWith("csaListing", 1, "certificate.pdf"));
  });

  it("triggers a save via a same-origin blob URL, never the raw SharePoint link", async () => {
    fetchAttachmentBlob.mockResolvedValue(new Blob(["pdf bytes"]));
    renderWithProviders(<AttachmentsSection parent="csaListing" itemId={1} />);

    await userEvent.click(screen.getByRole("button", { name: /download certificate\.pdf/i }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(createObjectURLSpy).toHaveBeenCalled();
  });

  it("also downloads from clicking the filename itself", async () => {
    fetchAttachmentBlob.mockResolvedValue(new Blob(["pdf bytes"]));
    renderWithProviders(<AttachmentsSection parent="csaListing" itemId={1} />);

    await userEvent.click(screen.getByRole("button", { name: "certificate.pdf" }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
  });

  it("shows a spinner while the fetch is in flight", async () => {
    let resolve!: (b: Blob) => void;
    fetchAttachmentBlob.mockReturnValue(new Promise((r) => (resolve = r)));
    renderWithProviders(<AttachmentsSection parent="csaListing" itemId={1} />);

    const button = screen.getByRole("button", { name: /download certificate\.pdf/i });
    await userEvent.click(button);
    expect(button).toBeDisabled();

    resolve(new Blob(["x"]));
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("toasts an error rather than failing silently", async () => {
    fetchAttachmentBlob.mockRejectedValue(new Error("network down"));
    renderWithProviders(<AttachmentsSection parent="csaListing" itemId={1} />);

    await userEvent.click(screen.getByRole("button", { name: /download certificate\.pdf/i }));

    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Couldn\'t download "certificate.pdf". network down'),
        }),
      ),
    );
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
