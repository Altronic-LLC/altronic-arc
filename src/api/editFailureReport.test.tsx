import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  describeAttemptedChange,
  describeFailureReason,
  isWriteLandedError,
  NO_EDIT_FAILURE_EMAIL,
  prettifyFieldName,
  reportEditFailure,
  resolveEditFailureActor,
} from "./editFailureReport";
import { GraphError, SessionExpiredError } from "./graph";
import { FaitReadBackError } from "./faits";
import { useUploadAttachment } from "@/hooks/useAttachments";

describe("prettifyFieldName", () => {
  it("splits camelCase SharePoint names and strips LookupId", () => {
    expect(prettifyFieldName("TaskDescription")).toBe("Task Description");
    expect(prettifyFieldName("CustomerContactEmail")).toBe("Customer Contact Email");
    expect(prettifyFieldName("EngineerAssignedLookupId")).toBe("Engineer Assigned");
    expect(prettifyFieldName("Status")).toBe("Status");
  });

  it("decodes _x0020_ / _x002f_ encodings (PCB checklist fields)", () => {
    expect(prettifyFieldName("Complete_x0020_Gerber_x0020_File")).toBe("Complete Gerber File");
    expect(prettifyFieldName("Send_x002f_Receive")).toBe("Send/Receive");
  });
});

describe("describeAttemptedChange", () => {
  it("expands a field-update bag, skipping @odata.type annotations", () => {
    const change = describeAttemptedChange({
      id: 42,
      fields: {
        Status: "In Production",
        "WatchersLookupId@odata.type": "Collection(Edm.Int32)",
        WatchersLookupId: [46, 87],
      },
    });
    expect(change.summary).toBe("update");
    expect(change.itemId).toBe(42);
    expect(change.rows).toContainEqual({ label: "Status", value: "In Production" });
    expect(change.rows).toContainEqual({ label: "Watchers", value: "46, 87" });
    // The annotation sibling is not shown.
    expect(change.rows.some((r) => r.label.includes("odata"))).toBe(false);
  });

  it("captures a new comment as plain text", () => {
    const change = describeAttemptedChange({
      id: 7,
      comment: {
        authorName: "Ray White",
        authorEmail: "ray@x.com",
        bodyHtml: "<p>Please <strong>expedite</strong> this</p>",
      },
    });
    expect(change.summary).toBe("comment");
    expect(change.rows).toEqual([{ label: "Comment", value: "Please expedite this" }]);
    // Author metadata is not echoed back as "what they typed".
    expect(change.rows.some((r) => /author/i.test(r.label))).toBe(false);
  });

  it("captures an edited comment body", () => {
    const change = describeAttemptedChange({
      id: 7,
      target: { timestamp: new Date(), authorEmail: "ray@x.com" },
      newBodyHtml: "<p>revised text</p>",
      renotify: true,
    });
    expect(change.summary).toBe("comment");
    expect(change.rows).toEqual([{ label: "Comment", value: "revised text" }]);
  });

  it("treats an object with no id as a new item and lists its input", () => {
    const change = describeAttemptedChange({
      title: "Archrock skid panel build",
      status: "Submitted",
      customer: "Archrock",
    });
    expect(change.summary).toBe("new item");
    expect(change.itemId).toBeNull();
    expect(change.rows).toContainEqual({ label: "title", value: "Archrock skid panel build" });
    expect(change.rows).toContainEqual({ label: "customer", value: "Archrock" });
  });

  it("expands a nested `input` object (admin project update)", () => {
    const change = describeAttemptedChange({
      id: 3,
      input: { title: "P-0003", customer: "Kodiak Gas", department: "Operations" },
    });
    expect(change.summary).toBe("update");
    expect(change.rows).toContainEqual({ label: "customer", value: "Kodiak Gas" });
  });

  it("renders cleared values and person arrays readably", () => {
    const change = describeAttemptedChange({
      id: 1,
      person: null,
      people: [{ displayName: "Sarah Shaffer", email: "s@x.com" }],
    });
    expect(change.rows).toContainEqual({ label: "person", value: "(cleared)" });
    expect(change.rows).toContainEqual({ label: "people", value: "Sarah Shaffer" });
  });

  it("names the file when the variable IS a File (an upload)", () => {
    // Object.entries(file) is empty — this used to email "the specific values
    // couldn't be captured" for every failed upload.
    const change = describeAttemptedChange(new File([new Uint8Array(2048)], "scan.pdf"));
    expect(change.summary).toBe("file upload");
    expect(change.rows).toEqual([{ label: "File", value: "scan.pdf (2.0 KB)" }]);
  });

  it("never throws on odd/empty input", () => {
    expect(describeAttemptedChange(undefined).rows).toEqual([]);
    expect(describeAttemptedChange("a string").rows).toEqual([]);
    expect(describeAttemptedChange(42).rows).toEqual([]);
  });
});

describe("describeFailureReason", () => {
  it("maps common Graph statuses to plain language", () => {
    expect(describeFailureReason(new GraphError(403, "Forbidden", "{}", "u")).headline).toMatch(
      /permission/i,
    );
    expect(describeFailureReason(new GraphError(400, "Bad Request", "{}", "u")).headline).toMatch(
      /rejected/i,
    );
    expect(describeFailureReason(new GraphError(503, "Unavailable", "{}", "u")).headline).toMatch(
      /unavailable after several/i,
    );
  });

  it("includes the raw status + body as maintainer detail", () => {
    const r = describeFailureReason(new GraphError(400, "Bad Request", '{"error":"bad"}', "u"));
    expect(r.detail).toContain("400");
    expect(r.detail).toContain("bad");
  });

  it("recognises a network failure", () => {
    expect(describeFailureReason(new TypeError("Failed to fetch")).headline).toMatch(
      /couldn't reach|network/i,
    );
  });

  it("falls back to the error message for anything else", () => {
    expect(describeFailureReason(new Error("weird thing")).headline).toBe("weird thing");
    expect(describeFailureReason("plain string").headline).toMatch(/couldn't be saved/i);
  });
});

describe("resolveEditFailureActor", () => {
  it("returns the demo user under USE_MOCK (tests run in mock mode)", () => {
    expect(resolveEditFailureActor()).toEqual({
      displayName: "Demo User",
      email: "demo.user@altronic-llc.com",
    });
  });
});

describe("reportEditFailure", () => {
  afterEach(() => vi.restoreAllMocks());

  it("skips session-expiry (a re-auth, not a lost edit)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await reportEditFailure({
      error: new SessionExpiredError("expired"),
      variables: { id: 1, fields: { Status: "x" } },
    });
    expect(info).not.toHaveBeenCalled();
  });

  it("skips a mutation that opted out through its meta", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await reportEditFailure({
      error: new GraphError(500, "Internal Server Error", "{}", "u"),
      variables: new File(["x"], "scan.pdf"),
      meta: NO_EDIT_FAILURE_EMAIL,
    });
    expect(info).not.toHaveBeenCalled();
  });

  it("skips an error whose write LANDED — the change is on screen and in SharePoint", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await reportEditFailure({
      error: new FaitReadBackError(4, new Error("429 throttled")),
      variables: { id: 4, fields: { Status: "Closed" } },
    });
    expect(info).not.toHaveBeenCalled();
    expect(isWriteLandedError(new FaitReadBackError(4, null))).toBe(true);
    expect(isWriteLandedError(new GraphError(500, "x", "{}", "u"))).toBe(false);
  });

  it("an attachment upload's failure never reaches the email (the hook's own meta)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The same wiring main.tsx uses: the global MutationCache hands the
    // mutation's meta to reportEditFailure.
    const qc = new QueryClient({
      mutationCache: new MutationCache({
        onError: (error, variables, _ctx, mutation) =>
          void reportEditFailure({ error, variables, meta: mutation.meta }),
      }),
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    // A null item id makes the mutationFn throw before any request.
    const { result } = renderHook(() => useUploadAttachment("eir", null), { wrapper });
    await act(() => expect(result.current.mutateAsync(new File(["x"], "a.pdf"))).rejects.toThrow());
    await new Promise((r) => setTimeout(r, 0));
    expect(info).not.toHaveBeenCalledWith("[email mock] edit-failure report:", expect.anything());
  });

  it("logs a recovery record in mock mode instead of sending mail, and never throws", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(
      reportEditFailure({
        error: new GraphError(403, "Forbidden", "{}", "u"),
        variables: { id: 9, fields: { OrderNotes: "<p>ship ASAP</p>" } },
      }),
    ).resolves.toBeUndefined();
    expect(info).toHaveBeenCalledWith(
      "[email mock] edit-failure report:",
      expect.objectContaining({
        to: "demo.user@altronic-llc.com",
        reason: expect.stringMatching(/permission/i),
        rows: expect.arrayContaining([{ label: "Order Notes", value: "ship ASAP" }]),
      }),
    );
  });
});
