import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Person } from "@/types/task";

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/api/config", async (orig) => ({
  ...(await orig<typeof import("@/api/config")>()),
  USE_MOCK: false,
}));

import { pushToast } from "@/components/Toast";
import { afterMentionAutoWatch, beginMentionAutoWatch } from "./mentionAutoWatch";

const mention = (name: string, email: string) =>
  `<span class="mention" data-email="${email}">@${name}</span>`;

const ANA: Person = { displayName: "Ana", email: "ana@altronic-llc.com", lookupId: 7 };

function setup(over: Partial<Parameters<typeof beginMentionAutoWatch>[0]> = {}) {
  const patch = vi.fn();
  const write = vi.fn().mockResolvedValue(undefined);
  const onWriteFailed = vi.fn();
  const resolveLookupId = vi.fn().mockResolvedValue(42);
  const handle = beginMentionAutoWatch({
    bodyHtml: `<p>hi ${mention("Bo", "bo@altronic-llc.com")}</p>`,
    currentWatchers: [ANA],
    directory: () => [],
    resolveLookupId,
    patch,
    write,
    onWriteFailed,
    noun: "task",
    ...over,
  });
  return { handle, patch, write, onWriteFailed, resolveLookupId };
}

beforeEach(() => vi.mocked(pushToast).mockClear());

describe("beginMentionAutoWatch", () => {
  it("shows the mentioned person as a watcher IMMEDIATELY — before any network call", () => {
    const { patch, resolveLookupId, write } = setup();
    expect(patch).toHaveBeenCalledWith([
      ANA,
      { displayName: "Bo", email: "bo@altronic-llc.com" },
    ]);
    expect(pushToast).toHaveBeenCalledWith({ message: "Bo is now watching this task." });
    expect(resolveLookupId).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("returns null and touches nothing when nobody new is mentioned", () => {
    const patch = vi.fn();
    const handle = beginMentionAutoWatch({
      bodyHtml: `<p>${mention("Ana", "ANA@altronic-llc.com")}</p>`,
      currentWatchers: [ANA],
      directory: () => [],
      resolveLookupId: vi.fn(),
      patch,
      write: vi.fn(),
      onWriteFailed: vi.fn(),
      noun: "task",
    });
    expect(handle).toBeNull();
    expect(patch).not.toHaveBeenCalled();
  });

  it("writes only after commit(), with the resolved lookupId", async () => {
    const { handle, write } = setup();
    expect(write).not.toHaveBeenCalled();
    handle!.commit();
    await handle!.settled;
    expect(write).toHaveBeenCalledWith([
      ANA,
      { displayName: "Bo", email: "bo@altronic-llc.com", lookupId: 42 },
    ]);
  });

  it("cancel() writes nothing — a failed comment leaves no subscription behind", async () => {
    const { handle, write, resolveLookupId } = setup();
    handle!.cancel();
    handle!.commit();
    await handle!.settled;
    expect(write).not.toHaveBeenCalled();
    expect(resolveLookupId).not.toHaveBeenCalled();
  });

  it("takes back and names a person with no SharePoint account, rather than dropping them silently", async () => {
    const { handle, patch, write } = setup({ resolveLookupId: vi.fn().mockResolvedValue(0) });
    handle!.commit();
    await handle!.settled;
    expect(patch).toHaveBeenLastCalledWith([ANA]);
    expect(write).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ variant: "error", message: expect.stringContaining("Bo") }),
    );
  });

  it("a failed write refetches and says so; settled still resolves", async () => {
    const { handle, onWriteFailed } = setup({
      write: vi.fn().mockRejectedValue(new Error("403")),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    handle!.commit();
    await handle!.settled;
    expect(onWriteFailed).toHaveBeenCalled();
    expect(pushToast).toHaveBeenLastCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("afterMentionAutoWatch waits for the write before running the refetch", async () => {
    let release!: () => void;
    const write = vi.fn(() => new Promise<void>((r) => (release = r)));
    const { handle } = setup({ write });
    const then = vi.fn();
    handle!.commit();
    afterMentionAutoWatch(handle, then);
    await vi.waitFor(() => expect(write).toHaveBeenCalled());
    expect(then).not.toHaveBeenCalled();
    release();
    await handle!.settled;
    await Promise.resolve();
    expect(then).toHaveBeenCalled();
  });

  it("afterMentionAutoWatch runs straight away with no auto-watch", () => {
    const then = vi.fn();
    afterMentionAutoWatch(null, then);
    expect(then).toHaveBeenCalled();
  });
});
