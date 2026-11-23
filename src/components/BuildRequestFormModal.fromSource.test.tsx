import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS } from "@/data/mockData";
import { parseCommunication } from "@/lib/communicationParser";
import type { BuildRequestSource } from "@/lib/buildRequestFromSource";

// =============================================================================
// "Create Build Request" from an EIR, Gray Market request or FAIT —
// BuildRequestFormModal's `fromSource` (BusinessIT#68/#69/#65).
//
// Tim's decisions, 2026-11-23: the #58 task rule still holds (the source's
// linked task is PRE-PICKED, not locked); the discussion is copied once; the
// source's part becomes the first part; the link is stored on the request.
// =============================================================================

const createBr = vi.hoisted(() =>
  vi.fn(async (input: unknown) => ({
    id: 500,
    brNo: "BR_2026-1100",
    ...(input as Record<string, unknown>),
  })),
);
const createItem = vi.hoisted(() => vi.fn(async (input: unknown) => ({ id: 77, ...(input as object) })));
const pushToast = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/hooks/useBuildRequests", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useBuildRequests")>();
  return {
    ...actual,
    useCreateBuildRequest: () => ({ mutateAsync: createBr, isPending: false }),
    useCreateBuildRequestItem: () => ({ mutateAsync: createItem, isPending: false }),
  };
});

vi.mock("./Toast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./Toast")>();
  return { ...actual, pushToast };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Femi Olugbon",
    email: "femi.olugbon@altronic-llc.com",
    lookupId: 0,
  }),
}));

import { BuildRequestFormModal } from "./BuildRequestFormModal";

const TASK = MOCK_TASKS.find((t) => t.parentProject !== null)!;

function source(overrides: Partial<BuildRequestSource> = {}): BuildRequestSource {
  return {
    kind: "eir",
    id: 31,
    label: "EIR_2026-0031",
    title: "Alternate for C-450-220",
    projectLookupIds: [TASK.parentProject!.lookupId],
    taskId: TASK.id,
    comments: [
      {
        timestamp: new Date("2026-11-01T10:00:00Z"),
        authorName: "Sarah Shaffer",
        authorEmail: "sarah.shaffer@altronic-llc.com",
        bodyHtml: "<p>Try the alternate</p>",
      },
    ],
    part: { partNumber: "C-450-220", partDesc: "Capacitor", drawingNo: "D-9", qty: 5 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

async function create() {
  const button = await screen.findByRole("button", { name: "Create" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await waitFor(() => expect(createBr).toHaveBeenCalledTimes(1));
  return createBr.mock.calls[0][0] as Record<string, unknown>;
}

describe("BuildRequestFormModal — fromSource", () => {
  it("names the source, prefills the title and shows the source locked", async () => {
    renderWithProviders(<BuildRequestFormModal fromSource={source()} onClose={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "New Build Request from EIR_2026-0031" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. HUB V4")).toHaveValue("Alternate for C-450-220");
    expect(screen.getByText("Raised from EIR")).toBeInTheDocument();
    expect(screen.getByTestId("br-source-hint")).toHaveTextContent("1 comment will be copied");
  });

  it("submits with the linked task pre-picked, the link, and the carried discussion", async () => {
    renderWithProviders(<BuildRequestFormModal fromSource={source()} onClose={vi.fn()} />);
    const args = await create();
    expect(args.taskReferenceLookupId).toBe(TASK.id);
    expect(args.eirReferenceLookupId).toBe(31);
    expect(args.parentProjectLookupIds).toEqual([TASK.parentProject!.lookupId]);
    const carried = parseCommunication(args.communication as string);
    expect(carried).toHaveLength(2);
    expect(carried[0].bodyHtml).toContain("Raised from EIR");
    expect(carried[1].authorName).toBe("Sarah Shaffer");
  });

  it("still needs a task when the source has none linked (#58)", async () => {
    renderWithProviders(<BuildRequestFormModal fromSource={source({ taskId: null })} onClose={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("adds the source's part as the first part, after the request exists", async () => {
    renderWithProviders(<BuildRequestFormModal fromSource={source()} onClose={vi.fn()} />);
    await create();
    await waitFor(() => expect(createItem).toHaveBeenCalledTimes(1));
    expect(createItem.mock.calls[0][0]).toMatchObject({
      partNumber: "C-450-220",
      buildRequestLookupId: 500,
      partDesc: "Capacitor",
      drawingNo: "D-9",
      qty: 5,
    });
    expect(mockNavigate).toHaveBeenCalledWith("/build-request/500");
  });

  it("adds no part when the part number is cleared", async () => {
    renderWithProviders(<BuildRequestFormModal fromSource={source()} onClose={vi.fn()} />);
    const partField = (await screen.findByText("Part Number")).parentElement!.querySelector("input")!;
    await userEvent.clear(partField);
    await create();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(createItem).not.toHaveBeenCalled();
  });

  it("a failed part never fails the create", async () => {
    createItem.mockRejectedValueOnce(new Error("refused"));
    const onCreated = vi.fn();
    renderWithProviders(<BuildRequestFormModal fromSource={source()} onCreated={onCreated} onClose={vi.fn()} />);
    await create();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/build-request/500"));
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 500 }));
  });

  it("hands the new request to onCreated (the GMR writes its Build Request No)", async () => {
    const onCreated = vi.fn();
    renderWithProviders(
      <BuildRequestFormModal
        fromSource={source({ kind: "grayMarket", id: 207, label: "GMR_2026-207" })}
        onCreated={onCreated}
        onClose={vi.fn()}
      />,
    );
    const args = await create();
    expect(args.grayMarketRequestId).toBe(207);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated.mock.calls[0][0].brNo).toBe(args.brNo);
  });

  it("says so when the list couldn't store the link", async () => {
    createBr.mockImplementationOnce(async (input: unknown) => ({
      id: 501,
      brNo: "BR_2026-1101",
      ...(input as Record<string, unknown>),
      eirReferenceLookupId: null,
    }));
    renderWithProviders(<BuildRequestFormModal fromSource={source()} onClose={vi.fn()} />);
    await create();
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("add-build-request-source-columns.ps1") }),
      ),
    );
  });
});
