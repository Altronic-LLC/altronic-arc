import { describe, it, expect } from "vitest";
import type { Person } from "@/types/task";
import { createTask, getTask, setAssigned, setWatchers } from "./tasks";
import { createEir, getEir, setEirAssignedEngineers } from "./eirs";
import {
  createOperationsTask,
  getOperationsTask,
  setOperationsAssigned,
} from "./operationsTasks";
import { createPanelTask, getPanelTask, setPanelTaskAssigned } from "./panelTasks";
import { createPanelOrder, getPanelOrder, setPanelOrderEngineer } from "./panelOrders";
import {
  createBuildRequest,
  getBuildRequest,
  setBuildRequestEngineer,
} from "./buildRequests";

// Whoever an item is assigned to has to be watching it (Ray, 2026-08-18) —
// otherwise the person doing the work is the one person the comment emails
// skip. Every department's assign path folds the assignee into Watchers, in
// the same write.
//
// USE_MOCK is true under Vitest, so these run against the in-memory stores;
// the union happens before the mock/real branch, so both take the same path.

const AMY: Person = { displayName: "Amy Adams", email: "amy@altronic-llc.com", lookupId: 7 };
const SAM: Person = { displayName: "Sam Shah", email: "sam@altronic-llc.com", lookupId: 9 };
const names = (people: Person[]) => people.map((p) => p.displayName).sort();

describe("assignees become watchers", () => {
  it("on an Engineering task", async () => {
    const task = await createTask({ title: "Watch me" });
    await setAssigned(task.id, [AMY]);

    expect(names((await getTask(task.id))!.watchers)).toContain("Amy Adams");
  });

  it("on an EIR", async () => {
    const eir = await createEir({ title: "Watch me" });
    await setEirAssignedEngineers(eir.id, [AMY]);

    expect(names((await getEir(eir.id))!.watchers)).toContain("Amy Adams");
  });

  it("on an Operations task", async () => {
    const task = await createOperationsTask({ title: "Watch me" });
    await setOperationsAssigned(task.id, AMY);

    expect(names((await getOperationsTask(task.id))!.watchers)).toContain("Amy Adams");
  });

  it("on a panel task", async () => {
    const task = await createPanelTask({ title: "Watch me" });
    await setPanelTaskAssigned(task.id, AMY);

    expect(names((await getPanelTask(task.id))!.watchers)).toContain("Amy Adams");
  });

  it("on a panel order", async () => {
    const order = await createPanelOrder({ title: "Watch me" });
    await setPanelOrderEngineer(order.id, AMY);

    expect(names((await getPanelOrder(order.id))!.watchers)).toContain("Amy Adams");
  });

  it("on a build request", async () => {
    const br = await createBuildRequest({ title: "Watch me", brNo: "BR_2026-9001" });
    await setBuildRequestEngineer(br.id, AMY);

    expect(names((await getBuildRequest(br.id))!.watchers)).toContain("Amy Adams");
  });
});

describe("assignment and the existing watcher list", () => {
  it("keeps the watchers who were already there", async () => {
    const task = await createTask({ title: "Watch me", watchers: [SAM] });
    await setAssigned(task.id, [AMY]);

    expect(names((await getTask(task.id))!.watchers)).toEqual(["Amy Adams", "Sam Shah"]);
  });

  it("does not duplicate someone who is already watching", async () => {
    const task = await createTask({ title: "Watch me", watchers: [AMY] });
    await setAssigned(task.id, [AMY]);

    expect((await getTask(task.id))!.watchers).toHaveLength(1);
  });

  // Unassigning is not un-watching: they were involved, and Unwatch is one
  // click away. Silently dropping them would lose a deliberate choice too —
  // the same person may have added themselves.
  it("leaves the old assignee watching after they are unassigned", async () => {
    const task = await createTask({ title: "Watch me" });
    await setAssigned(task.id, [AMY]);
    await setAssigned(task.id, []);

    const after = (await getTask(task.id))!;
    expect(after.assigned).toHaveLength(0);
    expect(names(after.watchers)).toContain("Amy Adams");
  });

  it("still lets a watcher be removed on purpose", async () => {
    const task = await createTask({ title: "Watch me" });
    await setAssigned(task.id, [AMY]);
    await setWatchers(task.id, []);

    expect((await getTask(task.id))!.watchers).toHaveLength(0);
  });
});
