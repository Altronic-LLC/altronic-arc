import { describe, expect, it } from "vitest";
import { buildHarnessPartRequestEmails, classifyHarnessPartRequest } from "./harnessPartRequest";
import type { HarnessPartNumber } from "@/types/task";

const parts: HarnessPartNumber[] = [
  { lookupId: 1, title: "593027-15", description: "Live part", active: true, note: "" },
  { lookupId: 2, title: "593030-18", description: "Old harness", active: false, note: "" },
];
const actor = { displayName: "Floor Operator", email: "operator@example.com" };
const lead = { displayName: "Harness Lead", email: "lead@example.com" };

describe("classifyHarnessPartRequest", () => {
  it("tells new, retired and already-listed apart, ignoring case and spaces", () => {
    expect(classifyHarnessPartRequest("999001-1", parts)).toEqual({ kind: "new" });
    expect(classifyHarnessPartRequest(" 593030-18 ", parts)).toMatchObject({ kind: "retired" });
    expect(classifyHarnessPartRequest("593027-15", parts)).toMatchObject({ kind: "active" });
  });
});

describe("buildHarnessPartRequestEmails", () => {
  it("asks to ADD a new number and to RESTORE a retired one", () => {
    const [add] = buildHarnessPartRequestEmails({
      partNumber: "999001-1",
      request: { kind: "new" },
      description: "New loom",
      note: "WO 1002089401",
      recipients: [lead],
      actor,
    });
    expect(add.subject).toBe("Harness part number request: 999001-1");
    expect(add.headlineHtml).toContain("<strong>add</strong> part number <strong>999001-1</strong>");
    expect(add.detailHtml).toContain("New loom");
    expect(add.detailHtml).toContain("WO 1002089401");

    const [restore] = buildHarnessPartRequestEmails({
      partNumber: "593030-18",
      request: classifyHarnessPartRequest("593030-18", parts),
      description: "",
      note: "",
      recipients: [lead],
      actor,
    });
    expect(restore.headlineHtml).toContain("<strong>restore</strong> the retired part number");
    expect(restore.detailHtml).toContain("Old harness");
  });

  it("sends nothing when nobody is set up", () => {
    expect(
      buildHarnessPartRequestEmails({ partNumber: "X", request: { kind: "new" }, description: "", note: "", recipients: [], actor }),
    ).toEqual([]);
  });

  it("escapes what was typed", () => {
    const [email] = buildHarnessPartRequestEmails({
      partNumber: "<b>",
      request: { kind: "new" },
      description: "",
      note: "<script>",
      recipients: [lead],
      actor,
    });
    expect(email.headlineHtml).toContain("&lt;B&gt;");
    expect(email.detailHtml).toContain("&lt;script&gt;");
  });
});
