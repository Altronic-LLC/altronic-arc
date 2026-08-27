import { describe, it, expect } from "vitest";
import {
  createQuickLink,
  deleteQuickLink,
  listQuickLinks,
  setQuickLinkOrder,
  updateQuickLink,
} from "./quickLinks";

// =============================================================================
// Quick Links — admin-managed external-link buttons above a Dashboard
// department's cards. Mock-mode behaviour; the real-mode request shapes
// (Title/Url/Department/SortOrder) are straightforward enough (plain string
// and number fields, no lookups or person columns) not to need a forced-real
// test the way person columns or hyperlink columns do elsewhere in ARC.
// =============================================================================

describe("Quick Links API", () => {
  it("lists sorted by department (Dashboard order), then order, then id", async () => {
    const links = await listQuickLinks();
    const engineeringIndex = links.findIndex((l) => l.department === "Engineering");
    const panelsIndex = links.findIndex((l) => l.department === "Panels");
    expect(engineeringIndex).toBeGreaterThanOrEqual(0);
    expect(engineeringIndex).toBeLessThan(panelsIndex);

    // Within Engineering, order is ascending.
    const engineeringLinks = links.filter((l) => l.department === "Engineering");
    for (let i = 1; i < engineeringLinks.length; i++) {
      expect(engineeringLinks[i].order).toBeGreaterThanOrEqual(engineeringLinks[i - 1].order);
    }
  });

  it("creates one, department and order included", async () => {
    const created = await createQuickLink({
      label: "New Vendor Portal",
      url: "https://vendor.example.com",
      department: "Supply Chain",
      order: 99,
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.label).toBe("New Vendor Portal");
    expect(created.department).toBe("Supply Chain");
    expect(created.order).toBe(99);

    const all = await listQuickLinks();
    expect(all.some((l) => l.id === created.id)).toBe(true);
  });

  it("updates label/url/department without touching order", async () => {
    const created = await createQuickLink({
      label: "Old Name",
      url: "https://old.example.com",
      department: "Operations",
      order: 5,
    });
    const updated = await updateQuickLink(created.id, {
      label: "New Name",
      url: "https://new.example.com",
      department: "Operations",
    });
    expect(updated.label).toBe("New Name");
    expect(updated.url).toBe("https://new.example.com");
    expect(updated.order).toBe(5);
  });

  it("moves a link's order independently of its other fields", async () => {
    const created = await createQuickLink({
      label: "Reorder Me",
      url: "https://reorder.example.com",
      department: "Coils",
      order: 1,
    });
    const moved = await setQuickLinkOrder(created.id, 7);
    expect(moved.order).toBe(7);
    expect(moved.label).toBe("Reorder Me");
  });

  it("deletes one", async () => {
    const created = await createQuickLink({
      label: "Temporary",
      url: "https://temp.example.com",
      department: "Quality Control",
      order: 1,
    });
    await deleteQuickLink(created.id);
    const all = await listQuickLinks();
    expect(all.some((l) => l.id === created.id)).toBe(false);
  });

  it("rejects an update to a link that isn't there", async () => {
    await expect(
      updateQuickLink(999_999, { label: "x", url: "https://x.com", department: "Engineering" }),
    ).rejects.toThrow();
  });
});
