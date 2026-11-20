// =============================================================================
// Where an Engineering project is still referenced (BusinessIT#41).
//
// Deleting a project from the Projects list leaves every lookup that pointed
// at it dangling — the record keeps a bare id that names nothing, and every
// screen renders it as a project nobody can identify. The request was for
// removing DUPLICATE project references, so the safe rule is: a project can be
// deleted only once nothing points at it. Records on the duplicate are moved to
// the surviving project first, and then the duplicate goes.
//
// Pure: the caller loads the lists. Each source is one of the lookups into the
// Projects list (6280c711-…) that ARC reads:
//
//   Tasks            Parent Project (single) + Related Projects (multi)
//   EIRs             Project Reference (multi)
//   ECNs             ProjectReference (single)
//   Test sheets      Project Reference (single)
//   Build requests   Project Reference (multi)
//   Build req. parts Project Reference (single)
//   FAITs            Project Reference (single)
//   Project folders  the folder's Project Reference metadata column
//
// Two that are deliberately NOT here: SCNs store the project's TITLE as text
// (another site collection, no lookup to dangle), and CPU-95's ProjectTag is
// a real lookup ARC doesn't read yet.
// =============================================================================

import type {
  BuildRequest,
  BuildRequestItem,
  Ecn,
  Eir,
  Fait,
  ProjectReference,
  Task,
  TestSheet,
} from "@/types/task";

export interface ProjectUsageSources {
  tasks: Task[];
  eirs: Eir[];
  ecns: Ecn[];
  testSheets: TestSheet[];
  buildRequests: BuildRequest[];
  buildRequestItems: BuildRequestItem[];
  faits: Fait[];
  /** Only the lookup is needed — ProjectFolder carries more. */
  projectFolders: { projectLookupId: number }[];
}

export interface ProjectUsage {
  /** Plural noun for the count, e.g. "tasks". */
  label: string;
  count: number;
}

const has = (refs: (ProjectReference | null | undefined)[], id: number) =>
  refs.some((r) => r?.lookupId === id);

/** Every kind of record still pointing at the project, zero counts dropped. */
export function projectUsage(lookupId: number, s: ProjectUsageSources): ProjectUsage[] {
  const counts: [string, string, number][] = [
    [
      "task",
      "tasks",
      s.tasks.filter((t) => has([t.parentProject, ...t.relatedProjects], lookupId)).length,
    ],
    ["EIR", "EIRs", s.eirs.filter((e) => has(e.parentProjects, lookupId)).length],
    ["ECN", "ECNs", s.ecns.filter((e) => has([e.parentProject], lookupId)).length],
    ["test sheet", "test sheets", s.testSheets.filter((t) => has([t.parentProject], lookupId)).length],
    [
      "build request",
      "build requests",
      s.buildRequests.filter((b) => has(b.parentProjects, lookupId)).length,
    ],
    [
      "build request part",
      "build request parts",
      s.buildRequestItems.filter((i) => has([i.projectRef], lookupId)).length,
    ],
    ["FAIT", "FAITs", s.faits.filter((f) => has([f.parentProject], lookupId)).length],
    [
      "project folder",
      "project folders",
      s.projectFolders.filter((f) => f.projectLookupId === lookupId).length,
    ],
  ];
  return counts
    .filter(([, , count]) => count > 0)
    .map(([one, many, count]) => ({ label: count === 1 ? one : many, count }));
}

/** "3 tasks, 1 EIR and 2 project folders". Empty string for no usage. */
export function describeProjectUsage(usage: ProjectUsage[]): string {
  const parts = usage.map((u) => `${u.count} ${u.label}`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
