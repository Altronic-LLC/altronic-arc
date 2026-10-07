import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  SCN_DOCUMENTS_SITE_LABEL: "ALTRONICSALESTEAM / SCN",
  listScnDocuments: vi.fn(async () => []),
  getScnDocumentPath: vi.fn(async () => []),
  createScnFolder: vi.fn(),
  uploadScnDocument: vi.fn(),
  renameScnDocument: vi.fn(),
  deleteScnDocument: vi.fn(),
}));
const pushToast = vi.hoisted(() => vi.fn());

vi.mock("@/api/scnDocuments", () => api);
vi.mock("@/components/Toast", () => ({ pushToast }));

import {
  SCN_DOCUMENTS_KEY,
  useCreateScnFolder,
  useDeleteScnDocument,
  useRenameScnDocument,
  useScnDocumentPath,
  useScnDocuments,
  useUploadScnDocument,
} from "./useScnDocuments";

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

function forbidden() {
  return Object.assign(new Error("Graph 403"), { status: 403, body: "accessDenied" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useScnDocuments / useScnDocumentPath", () => {
  it("lists the root with no folder, and a folder by id", async () => {
    const { wrapper } = setup();
    const root = renderHook(() => useScnDocuments(null), { wrapper });
    await waitFor(() => expect(root.result.current.isSuccess).toBe(true));
    expect(api.listScnDocuments).toHaveBeenCalledWith(undefined);

    const folder = renderHook(() => useScnDocuments("01A"), { wrapper });
    await waitFor(() => expect(folder.result.current.isSuccess).toBe(true));
    expect(api.listScnDocuments).toHaveBeenCalledWith("01A");
  });

  it("asks for the breadcrumb of the current folder", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useScnDocumentPath("01A"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.getScnDocumentPath).toHaveBeenCalledWith("01A");
  });
});

describe("useCreateScnFolder", () => {
  it("creates the folder, refreshes ITS parent's listing and says so", async () => {
    api.createScnFolder.mockResolvedValue({ id: "n", name: "Q4" });
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateScnFolder(), { wrapper });
    await act(() => result.current.mutateAsync({ parentId: "01A", name: "Q4" }));
    expect(api.createScnFolder).toHaveBeenCalledWith("01A", "Q4");
    expect(spy).toHaveBeenCalledWith({ queryKey: SCN_DOCUMENTS_KEY("01A") });
    expect(pushToast).toHaveBeenCalledWith({ message: 'Created the folder "Q4".' });
  });

  it("turns a 403 into the site-naming sentence", async () => {
    api.createScnFolder.mockRejectedValue(forbidden());
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateScnFolder(), { wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ parentId: null, name: "Q4" })).rejects.toThrow(),
    );
    const message = pushToast.mock.calls[0][0].message as string;
    expect(message).toMatch(/SharePoint wouldn't let you create the folder "Q4"/);
    expect(message).toContain("ALTRONICSALESTEAM / SCN");
  });

  it("passes the 409 sentence through", async () => {
    api.createScnFolder.mockRejectedValue(new Error('A folder called "Q4" already exists here.'));
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateScnFolder(), { wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ parentId: null, name: "Q4" })).rejects.toThrow(),
    );
    expect(pushToast.mock.calls[0][0].message).toContain('A folder called "Q4" already exists here.');
  });
});

describe("useUploadScnDocument", () => {
  it("sends files ONE AT A TIME, in order, reporting progress", async () => {
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    api.uploadScnDocument.mockImplementation(
      async (_folder: string | null, file: File, onProgress?: (f: number) => void) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(file.name);
        onProgress?.(0.5);
        await Promise.resolve();
        inFlight--;
        return { id: file.name, name: file.name };
      },
    );
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUploadScnDocument(), { wrapper });
    const files = [new File(["a"], "a.pdf"), new File(["b"], "b.docx")];
    const out = await act(() => result.current.mutateAsync({ folderId: null, files }));
    expect(order).toEqual(["a.pdf", "b.docx"]);
    expect(maxInFlight).toBe(1);
    expect(out.uploaded).toHaveLength(2);
    expect(result.current.progress).toBeNull();
    expect(spy).toHaveBeenCalledWith({ queryKey: SCN_DOCUMENTS_KEY(null) });
    expect(pushToast).toHaveBeenCalledWith({ message: "Uploaded 2 files." });
  });

  it("keeps going past a failed file and names it", async () => {
    api.uploadScnDocument
      .mockRejectedValueOnce(forbidden())
      .mockResolvedValueOnce({ id: "b", name: "b.docx" });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUploadScnDocument(), { wrapper });
    const files = [new File(["a"], "a.pdf"), new File(["b"], "b.docx")];
    const out = await act(() => result.current.mutateAsync({ folderId: "01A", files }));
    expect(out.uploaded.map((e) => e.name)).toEqual(["b.docx"]);
    expect(out.failed[0].name).toBe("a.pdf");
    expect(out.failed[0].message).toMatch(/SharePoint wouldn't let you upload "a.pdf"/);
    expect(pushToast).toHaveBeenCalledWith({ message: 'Uploaded "b.docx".' });
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });
});

describe("useRenameScnDocument", () => {
  const item = { id: "f1", name: "Old.docx", isFolder: false };

  it("renames, refreshes EVERY listing and breadcrumb, and says so", async () => {
    api.renameScnDocument.mockResolvedValue({ id: "f1", name: "New.docx" });
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRenameScnDocument(), { wrapper });
    await act(() => result.current.mutateAsync({ item, newName: "New.docx" }));
    expect(api.renameScnDocument).toHaveBeenCalledWith("f1", "New.docx", {
      currentName: "Old.docx",
      isFolder: false,
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["scn-documents"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["scn-documents-path"] });
    expect(pushToast).toHaveBeenCalledWith({ message: 'Renamed "Old.docx" to "New.docx".' });
  });

  it("an unchanged name is silent", async () => {
    api.renameScnDocument.mockResolvedValue(null);
    const { wrapper } = setup();
    const { result } = renderHook(() => useRenameScnDocument(), { wrapper });
    await act(() => result.current.mutateAsync({ item, newName: "Old.docx" }));
    expect(pushToast).not.toHaveBeenCalled();
  });

  it("a 403 names the site and EDITING", async () => {
    api.renameScnDocument.mockRejectedValue(forbidden());
    const { wrapper } = setup();
    const { result } = renderHook(() => useRenameScnDocument(), { wrapper });
    await act(() =>
      expect(result.current.mutateAsync({ item, newName: "New.docx" })).rejects.toThrow(),
    );
    const message = pushToast.mock.calls[0][0].message as string;
    expect(message).toMatch(/SharePoint wouldn't let you rename "Old.docx"/);
    expect(message).toContain("ALTRONICSALESTEAM / SCN");
    expect(message).toContain("may not include editing");
  });
});

describe("useDeleteScnDocument", () => {
  const item = { id: "d1", name: "LTB Analysis", isFolder: true };

  it("deletes, refreshes everything, and says where it went", async () => {
    api.deleteScnDocument.mockResolvedValue(undefined);
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteScnDocument(), { wrapper });
    await act(() => result.current.mutateAsync({ item }));
    expect(api.deleteScnDocument).toHaveBeenCalledWith("d1");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["scn-documents"] });
    expect(pushToast).toHaveBeenCalledWith({
      message: `Deleted "LTB Analysis" — it's in the SCN site's recycle bin for 93 days.`,
    });
  });

  it("a 403 names the site and DELETING, and refreshes the listing", async () => {
    api.deleteScnDocument.mockRejectedValue(forbidden());
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteScnDocument(), { wrapper });
    await act(() => expect(result.current.mutateAsync({ item })).rejects.toThrow());
    const message = pushToast.mock.calls[0][0].message as string;
    expect(message).toMatch(/SharePoint wouldn't let you delete "LTB Analysis"/);
    expect(message).toContain("may not include deleting");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["scn-documents"] });
  });
});
