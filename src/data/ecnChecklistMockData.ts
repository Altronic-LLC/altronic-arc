import type { EcnChecklist } from "@/types/task";
import {
  ECN_CHECKLIST_ITEMS,
  ECN_CHECKLIST_TEMPLATE_REVISION,
} from "@/lib/ecnChecklistTemplate";
import {
  progressFor,
  serialiseAnswers,
  statusFromProgress,
  type EcnChecklistAnswer,
  type EcnChecklistAnswers,
} from "@/lib/ecnChecklist";

// =============================================================================
// Sample ECN checklists for mock mode.
//
// Deliberately covers the states a real checklist passes through, so the card
// can be seen at each one without hand-editing 84 items in the browser:
//
//   ECN 1  part-way through, with findings text, an N/A and two flagged
//   ECN 2  finished - every item settled, signed off
//   ECN 3  freshly auto-created, nothing answered yet
//
// ECN 4 deliberately has NO checklist row, so the "Create checklist" button
// (the fallback for the 1,800+ ECNs that predate this feature) is reachable
// in mock mode too.
// =============================================================================

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

function answers(entries: Record<string, EcnChecklistAnswer>): EcnChecklistAnswers {
  return { templateRevision: ECN_CHECKLIST_TEMPLATE_REVISION, items: entries };
}

const complete = (findings = ""): EcnChecklistAnswer => ({ status: "complete", findings });
const na = (findings = ""): EcnChecklistAnswer => ({ status: "na", findings });
const flagged = (findings: string): EcnChecklistAnswer => ({ status: "flagged", findings });

/** Keys, taken from the template in order, so the fixtures survive a re-slug. */
const key = (n: number) => ECN_CHECKLIST_ITEMS[n].key;

// --- ECN 1: part-way through -------------------------------------------------
const partial = answers({
  [key(0)]: complete("Searched the log — no existing ECN for this change."),
  [key(1)]: complete("NGI-5000"),
  [key(2)]: complete("791970-1, 791970-2"),
  [key(3)]: complete(),
  [key(4)]: complete(),
  [key(5)]: complete("S. Shaffer"),
  [key(6)]: complete("Priority II — 10 days"),
  [key(7)]: complete("791970 rev C, dated 08/14/2026"),
  [key(8)]: complete("Two new drawings: 791970-3, 791970-4"),
  [key(9)]: complete("Schematic 791970-SCH rev C attached"),
  [key(10)]: complete("R14 designator, qty 7 → 6, PN 701082 → 711478"),
  [key(11)]: na("No make/buy change on this ECN."),
  [key(14)]: flagged("510 ohm part is a different footprint — needs MFG review before release."),
  [key(20)]: na("No chemical change."),
  [key(24)]: flagged("Obsolescence on 701082 may need an SCN — checking with Supply Chain."),
});

// --- ECN 2: finished ---------------------------------------------------------
const finishedItems: Record<string, EcnChecklistAnswer> = {};
for (const [i, item] of ECN_CHECKLIST_ITEMS.entries()) {
  // A realistic finished checklist is mostly "complete" with a good number of
  // N/A — most ECNs never touch chemicals, CSA files or panel inventory.
  finishedItems[item.key] = i % 3 === 1 ? na("Does not apply to this change.") : complete();
}
const finished = answers(finishedItems);

// --- ECN 3: freshly created --------------------------------------------------
const untouched = answers({});

function rollups(a: EcnChecklistAnswers) {
  const p = progressFor(a);
  return {
    status: statusFromProgress(p),
    itemsTotal: p.total,
    itemsComplete: p.complete,
    itemsNa: p.na,
    itemsFlagged: p.flagged,
    answersJson: serialiseAnswers(a),
    templateRevision: a.templateRevision,
  };
}

export const MOCK_ECN_CHECKLISTS: EcnChecklist[] = [
  {
    id: 1,
    ecnId: 1,
    title: "260062",
    ...rollups(partial),
    completedBy: null,
    completedDate: null,
    comments: [],
    watchers: [
      { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com" },
    ],
    hasAttachments: false,
    createdAt: daysAgo(2),
    modifiedAt: daysAgo(1),
  },
  {
    id: 2,
    ecnId: 2,
    title: "260059R1",
    ...rollups(finished),
    completedBy: { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
    completedDate: daysAgo(3),
    comments: [],
    watchers: [{ displayName: "Ray White", email: "ray.white@altronic-llc.com" }],
    hasAttachments: false,
    createdAt: daysAgo(9),
    modifiedAt: daysAgo(3),
  },
  {
    id: 3,
    ecnId: 3,
    title: "260058",
    ...rollups(untouched),
    completedBy: null,
    completedDate: null,
    comments: [],
    watchers: [],
    hasAttachments: false,
    createdAt: daysAgo(1),
    modifiedAt: daysAgo(1),
  },
];
