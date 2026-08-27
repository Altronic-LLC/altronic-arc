import { describe, it, expect } from "vitest";
import type { GraphListItem } from "@/types/task";
import {
  buildCostImpactNoticeCreateFields,
  compareCostImpactNotices,
  costImpactNoticeLabel,
  toCostImpactNotice,
} from "./costImpactNoticeMapper";

// Column names and stored shapes come from the live list —
// scripts/cost-impact-portal-schema.json, captured 2026-08-27.

function item(fields: Record<string, unknown>, extra: Partial<GraphListItem> = {}): GraphListItem {
  return { id: "3", fields, ...extra } as unknown as GraphListItem;
}

describe("toCostImpactNotice", () => {
  it("decodes the real column shapes", () => {
    const n = toCostImpactNotice(
      item({
        Title: "DATA LOGGING MODULE",
        Supplier: "Redlion",
        SAPNumber: "1000-5110-00                    ",
        OldPartNumber: "615240",
        OriginalCost: "604.50",
        NewCost: "1026.35",
        Delta_x0020_Cost: "421.85",
        TimeofImpact: "Near Future (<6 mo)",
        Panels: "No",
        WhereUsed: "<div>usage</div>",
        Year_x0020_Issued: "2022",
        Attachments: true,
      }),
    );
    expect(n.title).toBe("DATA LOGGING MODULE");
    expect(n.supplier).toBe("Redlion");
    // SAP Number carries trailing padding on some real rows.
    expect(n.sapNumber).toBe("1000-5110-00");
    expect(n.originalCost).toBe("604.50");
    expect(n.newCost).toBe("1026.35");
    expect(n.deltaCost).toBe(421.85);
    expect(n.timeOfImpact).toBe("Near Future (<6 mo)");
    expect(n.usedOnPanels).toBe("No");
    expect(n.whereUsed).toBe("<div>usage</div>");
    expect(n.yearIssued).toBe("2022");
    expect(n.hasAttachments).toBe(true);
  });

  it("reads the item-level createdBy as the submitter — the list has no requester column", () => {
    const n = toCostImpactNotice(
      item(
        {},
        {
          createdBy: {
            user: { displayName: "Mark Balent", email: "mark.balent@altronic-llc.com" },
          },
        } as unknown as Partial<GraphListItem>,
      ),
    );
    expect(n.submittedBy).toEqual({ displayName: "Mark Balent", email: "mark.balent@altronic-llc.com" });
  });

  it("treats an unrecognised choice value as unset rather than throwing", () => {
    const n = toCostImpactNotice(item({ TimeofImpact: "Whenever", Panels: "Maybe" }));
    expect(n.timeOfImpact).toBeNull();
    expect(n.usedOnPanels).toBeNull();
  });

  it("returns null for a Delta Cost that hasn't computed yet", () => {
    const n = toCostImpactNotice(item({ Delta_x0020_Cost: "" }));
    expect(n.deltaCost).toBeNull();
  });
});

describe("buildCostImpactNoticeCreateFields", () => {
  const REQUIRED = {
    title: "DATA LOGGING MODULE",
    supplier: "",
    sapNumber: "",
    oldPartNumber: "",
    mpn: "",
    originalCost: "604.50",
    newCost: "1026.35",
    timeOfImpact: "Immediate" as const,
    usedOnPanels: null,
    whereUsed: "Used on the WCD-20.",
    eau: "",
    bpReference: "",
    notes: "",
  };

  it("always sends the four required columns", () => {
    const fields = buildCostImpactNoticeCreateFields(REQUIRED);
    expect(fields.Title).toBe("DATA LOGGING MODULE");
    expect(fields.OriginalCost).toBe("604.50");
    expect(fields.NewCost).toBe("1026.35");
    expect(fields.TimeofImpact).toBe("Immediate");
    expect(fields.WhereUsed).toContain("Used on the WCD-20.");
  });

  it("omits blank optional columns rather than sending empty strings", () => {
    const fields = buildCostImpactNoticeCreateFields(REQUIRED);
    expect(fields).not.toHaveProperty("Supplier");
    expect(fields).not.toHaveProperty("SAPNumber");
    expect(fields).not.toHaveProperty("Panels");
    expect(fields).not.toHaveProperty("Comments");
  });

  it("includes optional columns once they're filled in", () => {
    const fields = buildCostImpactNoticeCreateFields({
      ...REQUIRED,
      supplier: "Redlion",
      usedOnPanels: "Yes",
      notes: "Chip shortage.",
    });
    expect(fields.Supplier).toBe("Redlion");
    expect(fields.Panels).toBe("Yes");
    expect(fields.Comments).toBe("Chip shortage.");
  });
});

describe("costImpactNoticeLabel", () => {
  it("pairs the title with the SAP number when both are known", () => {
    const n = toCostImpactNotice(item({ Title: "DATA LOGGING MODULE", SAPNumber: "1000-5110-00" }));
    expect(costImpactNoticeLabel(n)).toBe("DATA LOGGING MODULE (1000-5110-00)");
  });

  it("falls back to whatever is known, then the id", () => {
    expect(costImpactNoticeLabel(toCostImpactNotice(item({ Title: "X" })))).toBe("X");
    const bare = toCostImpactNotice(item({}));
    expect(costImpactNoticeLabel(bare)).toBe(`Cost Impact Notice #${bare.id}`);
  });
});

describe("compareCostImpactNotices", () => {
  it("sorts newest first", () => {
    const older = toCostImpactNotice(item({}, { id: "1" }));
    older.createdAt = new Date(2022, 0, 1);
    const newer = toCostImpactNotice(item({}, { id: "2" }));
    newer.createdAt = new Date(2026, 0, 1);
    expect([older, newer].sort(compareCostImpactNotices)).toEqual([newer, older]);
  });
});
