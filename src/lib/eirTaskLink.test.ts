import { describe, it, expect } from "vitest";
import {
  eirForTask,
  eirIdFromLink,
  eirNumbersIn,
  linkedEirForTask,
  linkedTaskForEir,
} from "./eirTaskReference";
import type { TaskEirReference } from "@/types/task";

// =============================================================================
// The EIR direction of the promoted EIR ⇄ task link (2026-10-27).
//
// The shapes below are the ones found live: the old Power App wrote the
// SharePoint FORM link on the task (url and label both), and some of those
// name an EIR id that no longer exists because the EIRs were re-created —
// the EIR number in the task's title is then the only thing left pointing
// at it.
// =============================================================================

const FORM = (id: number) =>
  `https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering/Lists/EIREngineering%20Information%20Request/DispForm.aspx?ID=${id}`;
const link = (url: string, label = url): TaskEirReference => ({ url, label });

const eir = (id: number, eirNo: string, taskReference = "") => ({ id, eirNo, taskReference });
const task = (id: number, numberedTitle: string, eirReference: TaskEirReference | null = null) => ({
  id,
  numberedTitle,
  title: numberedTitle,
  eirReference,
});

describe("eirNumbersIn", () => {
  it("finds the numbers people actually write, canonicalised", () => {
    expect(eirNumbersIn("T40-0003-EIR_2024-0396 | Test sheets")).toEqual(["EIR_2024-0396"]);
    expect(eirNumbersIn("Fault Status Code EIR 2024-0371")).toEqual(["EIR_2024-0371"]);
    expect(eirNumbersIn("eir_2025-140")).toEqual(["EIR_2025-0140"]);
    expect(eirNumbersIn("nothing here")).toEqual([]);
  });
});

describe("eirIdFromLink", () => {
  it("reads ARC's /eir/{id} and the SharePoint form ?ID=", () => {
    expect(eirIdFromLink("https://altronic-llc.github.io/altronic-arc/eir/768")).toBe(768);
    expect(eirIdFromLink(FORM(825))).toBe(825);
  });
  it("is null for anything that isn't a link to an EIR", () => {
    expect(eirIdFromLink("EIR_2025-0191")).toBeNull();
    expect(eirIdFromLink("https://altronic-llc.github.io/altronic-arc/task/768")).toBeNull();
    expect(eirIdFromLink(null)).toBeNull();
  });
});

describe("eirForTask", () => {
  const eirs = [eir(768, "EIR_2025-0191"), eir(1492, "EIR_2024-0396"), eir(1, "EIR_2026-0001")];

  it("follows the old Power App's form link to the EIR", () => {
    expect(eirForTask(task(1663, "T41", link(FORM(768))), eirs)?.id).toBe(768);
  });

  it("falls back to the EIR number in the title when the form link names an id that's gone", () => {
    expect(eirForTask(task(1680, "T40-0003-EIR_2024-0396 | Test", link(FORM(396))), eirs)?.id).toBe(1492);
  });

  it("reads an ARC link's label as an EIR number", () => {
    expect(eirForTask(task(9, "T1", link("https://elsewhere/x", "EIR_2026-0001")), eirs)?.id).toBe(1);
  });

  it("never pairs a task with no EIR link, whatever its title mentions", () => {
    // "ECN for EIR_2025-0286" is related work, not a promotion.
    expect(eirForTask(task(9, "T3-ECN for EIR_2025-0191"), eirs)).toBeNull();
  });

  it("won't guess between two EIRs carrying the same number", () => {
    const twice = [eir(1, "EIR_2026-0001"), eir(2, "EIR_2026-0001")];
    expect(eirForTask(task(9, "T1-EIR_2026-0001", link(FORM(999))), twice)).toBeNull();
  });
});

describe("linkedEirForTask / linkedTaskForEir — only when both records agree", () => {
  const ref = "https://apps.powerapps.com/play/e/x?ItemID=1663";

  it("links a pair that names each other", () => {
    const t = task(1663, "T41-0003-EIR_2025-0191 | Test", link(FORM(768)));
    const e = eir(768, "EIR_2025-0191", ref);
    expect(linkedEirForTask(t, [e], [t])?.id).toBe(768);
    expect(linkedTaskForEir(e, [t], [e])?.id).toBe(1663);
  });

  it("refuses a task whose EIR names a DIFFERENT task (two 'Test' tasks, live)", () => {
    const real = task(1663, "T41-0003-EIR_2025-0191 | Test", link(FORM(768)));
    const stray = task(1630, "T39-0003-EIR_2025-0191 | Test", link(FORM(768)));
    const e = eir(768, "EIR_2025-0191", ref);
    expect(linkedEirForTask(stray, [e], [real, stray])).toBeNull();
    expect(linkedEirForTask(real, [e], [real, stray])?.id).toBe(768);
  });

  it("accepts one side blank — the backfill fills the other half", () => {
    const t = task(2711, "T1-219-EIR_2026-0103 | VSM-800", link(FORM(1069)));
    const e = eir(1069, "EIR_2026-0103", "");
    expect(linkedEirForTask(t, [e], [t])?.id).toBe(1069);
    expect(linkedTaskForEir(e, [t], [e])?.id).toBe(2711);
  });

  it("finds the EIR from its Task Reference when the task carries no link", () => {
    const t = task(3344, "T188-321--CM4 BOM changes");
    const e = eir(1887, "EIR_2026-0270", "T188-321--CM4 BOM changes");
    expect(linkedEirForTask(t, [e], [t])?.id).toBe(1887);
    expect(linkedTaskForEir(e, [t], [e])?.id).toBe(3344);
  });

  it("refuses an EIR whose task links to another EIR", () => {
    const t = task(5, "T5-0001-x", link(FORM(2)));
    const e1 = eir(1, "EIR_2026-0001", "T5-0001-x");
    const e2 = eir(2, "EIR_2026-0002", "");
    expect(linkedTaskForEir(e1, [t], [e1, e2])).toBeNull();
  });
});
