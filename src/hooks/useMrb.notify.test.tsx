import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MrbEntry, Person } from "@/types/task";

// =============================================================================
// Who gets emailed about an MRB comment.
//
// Written after Tim reported "no email notification on any of these edits or
// new discussion items, and I added myself as a watcher and still nothing"
// (2026-09-21). That turned out to be the house rule working correctly — the
// author is NEVER notified about their own comment, even when they are a
// watcher — and testing alone means being the author every time.
//
// Worth pinning rather than just explaining, because "it's by design" is
// exactly the kind of claim that can quietly be wrong. The positive path
// (a watcher who ISN'T the author) had never actually been exercised.
//
// Note the absence of an email is itself evidence the identity matching
// worked: if the author's mailbox had NOT matched their watcher entry, the
// exclusion would have missed and they WOULD have been emailed.
// =============================================================================

const AUTHOR: Person = {
  displayName: "Tim Webster",
  email: "tim.webster@altronic-llc.com",
  lookupId: 1,
};
const SOMEONE_ELSE: Person = {
  displayName: "Katie Fleming",
  email: "katie.fleming@altronic-llc.com",
  lookupId: 2,
};

// Typed so `mock.calls[0][0].recipients` is readable below — an untyped
// vi.fn() infers a zero-arg signature and the cast gets ugly.
const notifyMentions = vi.hoisted(() =>
  vi.fn((_args: { recipients: { email: string }[] }) => Promise.resolve({ ok: true })),
);
const addMrbComment = vi.hoisted(() => vi.fn());
const editMrbComment = vi.hoisted(() => vi.fn());
const listMrbEntries = vi.hoisted(() => vi.fn());

vi.mock("@/api/email", () => ({ notifyMentions }));
vi.mock("@/api/mrb", () => ({
  addMrbComment,
  editMrbComment,
  listMrbEntries,
  setMrbWatchers: vi.fn(() => Promise.resolve()),
  createMrbEntry: vi.fn(),
  updateMrbEntry: vi.fn(),
  mrbWatchersAvailable: () => true,
}));
// Auto-watch is a separate concern and hits the PMO site resolver.
vi.mock("@/api/autoWatch", () => ({ autoWatchFromMentions: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/api/operationsTasks", () => ({ resolvePmoSiteUserLookupId: vi.fn() }));

import { MRB_KEY, useAddMrbComment, useEditMrbComment } from "./useMrb";

function entry(over: Partial<MrbEntry> = {}): MrbEntry {
  return {
    id: 42,
    sapNumber: "1000-1347-00",
    mrbDate: new Date("2026-09-08T12:00:00Z"),
    oldPartNumber: "",
    quantity: 1,
    description: "Can Machining",
    reason: "Paint chipping",
    whereCaused: "",
    disposition: "",
    vendorName: "",
    pricePerUnit: null,
    pricePerIssue: null,
    notes: "",
    comments: [],
    watchers: [],
    dataFormat: "Current",
    sourceYear: 2026,
    provenance: {},
    hasAttachments: false,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
    ...over,
  };
}

/** A wrapper whose cache is pre-seeded with one entry. */
function seeded(e: MrbEntry) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  qc.setQueryData(MRB_KEY, [e]);
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

/** A mention chip in the shape the parser reads. */
function mention(p: Person): string {
  return `<span class="mention" data-email="${p.email}">@${p.displayName}</span>`;
}

/** Every address notifyMentions was asked to write to. */
function notifiedEmails(): string[] {
  return notifyMentions.mock.calls.flatMap((c) =>
    (c[0].recipients ?? []).map((r) => r.email.toLowerCase()),
  );
}

beforeEach(() => {
  notifyMentions.mockClear();
  addMrbComment.mockReset();
  editMrbComment.mockReset();
  addMrbComment.mockImplementation((_id: number) => Promise.resolve(entry()));
  editMrbComment.mockImplementation((_id: number) => Promise.resolve(entry()));
});

async function postComment(e: MrbEntry, bodyHtml: string) {
  const { result } = renderHook(() => useAddMrbComment(), { wrapper: seeded(e) });
  await result.current.mutateAsync({
    id: e.id,
    comment: {
      authorName: AUTHOR.displayName,
      authorEmail: AUTHOR.email!,
      bodyHtml,
    },
  });
  // notifyMentions is fired-and-forgotten inside onSuccess.
  await waitFor(() => expect(addMrbComment).toHaveBeenCalled());
}

describe("posting an MRB comment", () => {
  // THE REPORTED CASE. Testing alone always looks like this.
  it("does NOT email the author, even when they are the only watcher", async () => {
    await postComment(entry({ watchers: [AUTHOR] }), "<p>Test number two of comments</p>");
    expect(notifyMentions).not.toHaveBeenCalled();
  });

  // The positive path the report couldn't exercise.
  it("DOES email a watcher who isn't the author", async () => {
    await postComment(entry({ watchers: [AUTHOR, SOMEONE_ELSE] }), "<p>Vendor is sending a credit.</p>");
    expect(notifiedEmails()).toEqual([SOMEONE_ELSE.email!.toLowerCase()]);
  });

  it("emails an @-mentioned person who isn't watching", async () => {
    await postComment(entry(), `<p>${mention(SOMEONE_ELSE)} can you chase this?</p>`);
    expect(notifiedEmails()).toEqual([SOMEONE_ELSE.email!.toLowerCase()]);
  });

  // The documented escape hatch — and the way to test notifications solo.
  it("DOES email the author when they explicitly @-mention themselves", async () => {
    await postComment(entry({ watchers: [AUTHOR] }), `<p>${mention(AUTHOR)} remember this</p>`);
    expect(notifiedEmails()).toEqual([AUTHOR.email!.toLowerCase()]);
  });

  it("sends nothing at all when there is nobody to tell", async () => {
    await postComment(entry(), "<p>Just a note to myself.</p>");
    expect(notifyMentions).not.toHaveBeenCalled();
  });
});

describe("editing an MRB comment", () => {
  async function editComment(e: MrbEntry, bodyHtml: string, previousBodyHtml: string) {
    const { result } = renderHook(() => useEditMrbComment(), { wrapper: seeded(e) });
    await result.current.mutateAsync({
      id: e.id,
      target: { timestamp: new Date("2026-09-21T13:05:00Z"), authorEmail: AUTHOR.email! },
      bodyHtml,
      previousBodyHtml,
    });
    await waitFor(() => expect(editMrbComment).toHaveBeenCalled());
  }

  // The second half of the report: editing notified nobody.
  it("tells nobody when an edit adds no new mention", async () => {
    await editComment(
      entry({ watchers: [AUTHOR, SOMEONE_ELSE] }),
      "<p>Test number two of comments, corrected</p>",
      "<p>Test number two of comments</p>",
    );
    expect(notifyMentions).not.toHaveBeenCalled();
  });

  it("emails only the NEWLY mentioned person", async () => {
    await editComment(
      entry(),
      `<p>Actually ${mention(SOMEONE_ELSE)} owns this</p>`,
      "<p>Actually somebody owns this</p>",
    );
    expect(notifiedEmails()).toEqual([SOMEONE_ELSE.email!.toLowerCase()]);
  });

  it("does not re-ping someone who was already mentioned before the edit", async () => {
    const body = `<p>${mention(SOMEONE_ELSE)} please review</p>`;
    await editComment(entry(), `${body}<p>(typo fixed)</p>`, body);
    expect(notifyMentions).not.toHaveBeenCalled();
  });
});
