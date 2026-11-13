import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { MirrorTarget } from "@/lib/commentMirror";
import type { Eir, Task } from "@/types/task";

// =============================================================================
// A promoted EIR and its task share one conversation (Ray, 2026-10-27): a
// comment on either is copied to the other, under the "Posted on …" banner,
// the way a task and its build request already do. These cases cover the part
// only the hook can get wrong — finding the partner in the caches, refusing a
// pair whose two records disagree, and not emailing one person twice.
// =============================================================================

const mirrorComment = vi.hoisted(() =>
  vi.fn(async (args: { targets: MirrorTarget[] }) => ({
    written: args.targets,
    failed: [] as { target: MirrorTarget; error: unknown }[],
  })),
);
type NotifyFn = (args: {
  recipients: { email?: string }[];
  target: { kind: string; id: number; title: string };
}) => Promise<unknown>;
const notifyMentions = vi.hoisted(() => vi.fn<NotifyFn>(async () => ({ ok: true })));

vi.mock("@/api/commentMirror", () => ({
  mirrorComment,
  describeMirrorTarget: (t: MirrorTarget) => t.kind,
}));
vi.mock("@/api/email", () => ({ notifyMentions }));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

import { fanOutComment } from "./useCommentMirror";
import { TASK_LIST_KEY } from "./useTasks";
import { EIRS_KEY } from "./useEirs";
import { BUILD_REQUESTS_KEY } from "./useBuildRequests";

const FORM = (id: number) =>
  `https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering/Lists/EIREngineering%20Information%20Request/DispForm.aspx?ID=${id}`;

const glenn = { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com" };
const sheila = { displayName: "Sheila Horn", email: "sheila.horn@altronic-llc.com" };

const TASK = {
  id: 1663,
  title: "Test",
  numberedTitle: "T41-0003-EIR_2025-0191 | Test",
  eirReference: { url: FORM(768), label: FORM(768) },
  watchers: [sheila],
  assigned: [],
} as unknown as Task;
const STRAY = {
  ...TASK,
  id: 1630,
  numberedTitle: "T39-0003-EIR_2025-0191 | Test",
} as unknown as Task;
const EIR = {
  id: 768,
  eirNo: "EIR_2025-0191",
  title: "Test",
  taskReference: "https://apps.powerapps.com/play/e/x?ItemID=1663",
  watchers: [glenn, sheila],
  assignedEngineers: [],
} as unknown as Eir;

function client(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(TASK_LIST_KEY, [TASK, STRAY]);
  qc.setQueryData(EIRS_KEY, [EIR]);
  qc.setQueryData(BUILD_REQUESTS_KEY, []);
  return qc;
}

const COMMENT = { authorName: "Ray White", authorEmail: "ray.white@altronic-llc.com", bodyHtml: "<p>hi</p>" };
const targets = () => (mirrorComment.mock.calls[0]?.[0]?.targets ?? []).map((t) => `${t.kind}:${t.id}`);

beforeEach(() => {
  mirrorComment.mockClear();
  notifyMentions.mockClear();
});

describe("fanOutComment — EIR ⇄ task", () => {
  it("copies an EIR comment onto its task, named after the EIR", async () => {
    await fanOutComment({ qc: client(), source: { kind: "eir", id: 768 }, comment: COMMENT, alreadyNotified: [] });
    expect(targets()).toEqual(["task:1663"]);
    expect(mirrorComment.mock.calls[0][0]).toMatchObject({ origin: { kind: "eir", id: 768, label: "EIR_2025-0191" } });
  });

  it("copies a task comment onto its EIR — reading the old SharePoint form link", async () => {
    await fanOutComment({ qc: client(), source: { kind: "task", id: 1663 }, comment: COMMENT, alreadyNotified: [] });
    expect(targets()).toEqual(["eir:768"]);
  });

  it("mirrors nothing from a task its EIR doesn't name back", async () => {
    await fanOutComment({ qc: client(), source: { kind: "task", id: 1630 }, comment: COMMENT, alreadyNotified: [] });
    expect(mirrorComment).not.toHaveBeenCalled();
  });

  it("emails the EIR's watchers minus whoever the task post already told", async () => {
    await fanOutComment({
      qc: client(),
      source: { kind: "task", id: 1663 },
      comment: COMMENT,
      alreadyNotified: [sheila],
    });
    expect(notifyMentions).toHaveBeenCalledTimes(1);
    const call = notifyMentions.mock.calls[0][0];
    expect(call.recipients.map((r) => r.email)).toEqual([glenn.email]);
    // The EIR's own email title, so the copy joins the EIR's conversation.
    expect(call.target).toMatchObject({ kind: "eir", id: 768, title: "EIR_2025-0191 — Test" });
  });
});
