// Minimal Engineering and Operations task builders for tests that need a
// handful of hand-made rows — the combined task lists especially, where both
// shapes appear side by side. Override only what the test is about.

import type { OperationsTask, Task } from "@/types/task";

export const testDay = (d: number) => new Date(Date.UTC(2026, 0, d));

export function makeTask(id: number, over: Partial<Task> = {}): Task {
  const title = over.title ?? `Eng ${id}`;
  return {
    id,
    numberedTitle: `T${id}-0001-${title}`,
    title,
    description: "",
    status: "BACKLOG",
    priority: null,
    category: null,
    labels: [],
    dueDate: null,
    createdAt: testDay(1),
    modifiedAt: testDay(1),
    authorLookupId: 0,
    author: null,
    editorLookupId: 0,
    parentProject: null,
    relatedProjects: [],
    parentTask: null,
    childTasks: [],
    assigned: [],
    watchers: [],
    softwareRevision: "",
    eirReference: null,
    comments: [],
    hasAttachments: false,
    ...over,
  };
}

/**
 * A small pair of lists for the combined Engineering + Operations views. The
 * SAME item ids appear on both, on purpose — keys must not collide. One task
 * per list is active, one is done (Complete / Canceled), and the dates give a
 * fixed newest-first order: Board rework, Lathe install, then the two done.
 * Lathe install carries an Operations project, so a project filter left in
 * the URL would hide it if it were honoured in the combined scope.
 */
export const SAMPLE_ENGINEERING_TASKS: Task[] = [
  makeTask(1, { title: "Board rework", status: "In Progress", createdAt: testDay(3) }),
  makeTask(2, { title: "Old drawing", status: "Complete", createdAt: testDay(1) }),
];

export function makeOperationsTask(id: number, over: Partial<OperationsTask> = {}): OperationsTask {
  return {
    id,
    taskNumber: `Task 0001-${id}`,
    title: `Ops ${id}`,
    description: "",
    status: "Backlog",
    priority: null,
    taskType: null,
    location: null,
    dueDate: null,
    createdAt: testDay(1),
    modifiedAt: testDay(1),
    authorLookupId: 0,
    author: null,
    editorLookupId: 0,
    assigned: null,
    watchers: [],
    parentProject: null,
    equipment: null,
    comments: [],
    hasAttachments: false,
    ...over,
  };
}

export const SAMPLE_OPERATIONS_TASKS: OperationsTask[] = [
  makeOperationsTask(1, {
    title: "Lathe install",
    status: "WIP",
    createdAt: testDay(2),
    parentProject: { lookupId: 99, title: "Shop floor" },
  }),
  makeOperationsTask(2, { title: "Press move", status: "Canceled", createdAt: testDay(1) }),
];
