import { describe, it, expect } from "vitest";
import { fetchAttachmentBlob, isReservedImageAttachment, listAttachments } from "./attachments";

describe("isReservedImageAttachment", () => {
  it("recognises a SharePoint Image column's hidden backing file", () => {
    expect(isReservedImageAttachment("Reserved_ImageAttachment_[4]_[Logo][32]_[abc][1]_[6].jpg")).toBe(
      true,
    );
  });

  it("leaves an ordinary attachment alone", () => {
    expect(isReservedImageAttachment("quote.pdf")).toBe(false);
  });
});

describe("fetchAttachmentBlob", () => {
  it("fetches the mock-mode data: URI directly, no auth needed", async () => {
    const [logo] = await listAttachments("supplier", 25);
    expect(logo.fileName).toBe("Reserved_ImageAttachment_demo_arrow.png");
    const blob = await fetchAttachmentBlob(logo.downloadUrl);
    expect(blob.size).toBeGreaterThan(0);
  });
});
