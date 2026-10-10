import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetQuoteMockStores, quoteMockDb } from "@/data/quoteMockData";

const who = vi.hoisted(() => ({ emails: ["katie.fleming@altronic-llc.com"] as string[] }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: who.emails[0] ?? "", lookupId: 0 }),
  useCurrentUserEmails: () => who.emails,
}));
vi.mock("@/lib/quotePdf", async (orig) => {
  const a = await orig<typeof import("@/lib/quotePdf")>();
  return { ...a, generateQuotePdf: vi.fn(async () => new Blob(["%PDF-1.3"], { type: "application/pdf" })) };
});
vi.mock("@/api/quotePdfFiles", async (orig) => {
  const a = await orig<typeof import("@/api/quotePdfFiles")>();
  return { ...a, saveQuotePdf: vi.fn(a.saveQuotePdf), listQuotePdfs: vi.fn(a.listQuotePdfs) };
});

import * as pdf from "@/lib/quotePdf";
import * as files from "@/api/quotePdfFiles";
import { downloadBlob, useGenerateQuotePdf, useQuotePdfs, useSaveQuotePdf } from "./useQuotePdf";

const QUOTER = ["katie.fleming@altronic-llc.com"];
const VIEWER = ["brandon.mirto@altronic-llc.com"];

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

function inputFor(quoteId: number) {
  const quote = quoteMockDb.quotes.find((q) => q.id === quoteId)!;
  return {
    quote,
    customer: quoteMockDb.customers.find((c) => c.id === quote.customerId) ?? null,
    assemblies: quoteMockDb.assemblies,
    items: quoteMockDb.items,
  };
}

beforeEach(() => {
  __resetQuoteMockStores();
  files.__resetQuotePdfMockStore();
  who.emails = QUOTER;
  vi.mocked(pdf.generateQuotePdf).mockClear();
  vi.mocked(files.saveQuotePdf).mockClear();
});

describe("useGenerateQuotePdf", () => {
  it("refuses a viewer BEFORE anything is built", async () => {
    who.emails = VIEWER;
    const { wrapper } = setup();
    const { result } = renderHook(() => useGenerateQuotePdf(), { wrapper });
    await act(() => expect(result.current.mutateAsync(inputFor(1))).rejects.toThrow(/generate the customer quote/));
    expect(pdf.generateQuotePdf).not.toHaveBeenCalled();
  });

  it("builds the model dated TODAY and returns the blob with the quote's file name", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useGenerateQuotePdf(), { wrapper });
    const out = await act(() => result.current.mutateAsync(inputFor(1)));
    expect(out.fileName).toBe("IQ-COO-0001-R1.pdf");
    expect(out.blob).toBeInstanceOf(Blob);
    const model = vi.mocked(pdf.generateQuotePdf).mock.calls[0][0];
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(model.issueDate).toBe(today);
  });

  it("names the SIGNED-IN user as Prepared by — name and mailbox, read at generate time", async () => {
    const { wrapper } = setup();
    const { result, rerender } = renderHook(() => useGenerateQuotePdf(), { wrapper });
    await act(() => result.current.mutateAsync(inputFor(1)));
    expect(vi.mocked(pdf.generateQuotePdf).mock.calls[0][0].preparedBy).toEqual({
      name: "Signed In",
      email: "katie.fleming@altronic-llc.com",
    });
    // Whoever is signed in NOW — not the value captured when the hook first rendered.
    who.emails = ["demo.user@altronic-llc.com"];
    rerender();
    await act(() => result.current.mutateAsync(inputFor(1)));
    expect(vi.mocked(pdf.generateQuotePdf).mock.calls[1][0].preparedBy).toEqual({
      name: "Signed In",
      email: "demo.user@altronic-llc.com",
    });
  });

  it("refuses, listing the problems, when the quote can't be printed", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useGenerateQuotePdf(), { wrapper });
    const input = { ...inputFor(1), customer: null };
    await act(() => expect(result.current.mutateAsync(input)).rejects.toThrow(/Choose a customer/));
    expect(pdf.generateQuotePdf).not.toHaveBeenCalled();
  });
});

describe("useSaveQuotePdf / useQuotePdfs", () => {
  const blob = new Blob(["%PDF"], { type: "application/pdf" });

  it("refuses a viewer BEFORE any write", async () => {
    who.emails = VIEWER;
    const { wrapper } = setup();
    const { result } = renderHook(() => useSaveQuotePdf(), { wrapper });
    await act(() => expect(result.current.mutateAsync({ blob, fileName: "IQ-COO-0001-R1.pdf" })).rejects.toThrow());
    expect(files.saveQuotePdf).not.toHaveBeenCalled();
  });

  it("saves for a quoter and the folder listing picks it up", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ save: useSaveQuotePdf(), list: useQuotePdfs("IQ-COO-0001") }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.list.data).toBeDefined());
    const before = result.current.list.data!.length;
    const saved = await act(() => result.current.save.mutateAsync({ blob, fileName: "IQ-COO-0001-R1.pdf" }));
    expect(saved.name).toMatch(/^IQ-COO-0001-R1/);
    await waitFor(() => expect(result.current.list.data!.length).toBe(before + 1));
  });
});

describe("downloadBlob", () => {
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.assign(URL, { createObjectURL: original.create, revokeObjectURL: original.revoke });
  });

  it("clicks an anchor at an object URL, and does NOT revoke it on the same tick", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:quote");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadBlob(new Blob(["x"]), "IQ-COO-0001-R1.pdf");
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe("IQ-COO-0001-R1.pdf");
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:quote");
  });
});
