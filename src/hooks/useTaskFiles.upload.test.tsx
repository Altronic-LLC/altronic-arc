// A task upload is DONE once the file is in the project folder. The extra
// copy on the task item (one un-chunked SP REST request) runs in the
// background, so a large file can't hold the upload — or a comment's Post
// button — hostage to it (Ray, 2026-09-29).

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MOCK_TASKS } from "@/data/mockData";

vi.mock("@/api/projectFiles", async (orig) => ({
  ...(await orig<typeof import("@/api/projectFiles")>()),
  listProjectFolders: vi.fn(),
  resolveFolderForProject: vi.fn(() => ({ folderId: "f1", folderName: "0017-AMP", prefix: "" })),
  uploadTaskFile: vi.fn(),
}));
vi.mock("@/api/attachments", async (orig) => ({
  ...(await orig<typeof import("@/api/attachments")>()),
  uploadAttachment: vi.fn(),
}));
vi.mock("@/hooks/useTasks", () => ({ useProjects: () => ({ data: [] }) }));

import { useUploadTaskFile } from "./useTaskFiles";
import { listProjectFolders, uploadTaskFile } from "@/api/projectFiles";
import { uploadAttachment } from "@/api/attachments";

const TASK = MOCK_TASKS[0];
const FILE = new File(["x".repeat(10)], "drawing.pdf");

function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  (listProjectFolders as Mock).mockResolvedValue([]);
  (uploadTaskFile as Mock).mockResolvedValue({ name: "drawing.pdf", webUrl: "https://x/drawing.pdf" });
});

describe("useUploadTaskFile", () => {
  it("finishes once the project-folder copy lands, without waiting for the task-item copy", async () => {
    // The task-item copy never answers — the timeout case.
    (uploadAttachment as Mock).mockReturnValue(new Promise(() => {}));
    const { wrapper } = harness();
    const { result } = renderHook(() => useUploadTaskFile(TASK), { wrapper });
    await waitFor(() => expect(listProjectFolders).toHaveBeenCalled());

    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync(FILE);
    });
    expect(returned).toEqual({ name: "drawing.pdf", webUrl: "https://x/drawing.pdf" });
    // The copy was still started — it's best-effort, not dropped.
    expect(uploadAttachment).toHaveBeenCalledWith("task", TASK.id, FILE);
  });

  it("a failed task-item copy doesn't fail the upload", async () => {
    (uploadAttachment as Mock).mockRejectedValue(new Error("timed out"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { wrapper } = harness();
    const { result } = renderHook(() => useUploadTaskFile(TASK), { wrapper });
    await waitFor(() => expect(listProjectFolders).toHaveBeenCalled());
    await act(async () => {
      await result.current.mutateAsync(FILE);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
