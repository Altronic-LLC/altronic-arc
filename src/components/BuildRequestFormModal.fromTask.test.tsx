import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS } from "@/data/mockData";
import { parseCommunication } from "@/lib/communicationParser";

// =============================================================================
// "Create Build Request" from a task — BuildRequestFormModal's `fromTask`.
//
// Ray, 2026-09-20: "a clean way to create a build request from a task... pop
// up the build request creation forms and load the build request after submit
// linked back and forth from task and build request and copy task comments to
// the build request comments."
//
// Mirrors TaskFormModal's `fromParentTask` and TestSheetFormModal's `fromTask`
// — prefill what corresponds, LOCK the reference, leave everything else
// editable. What's specific here is the carried discussion.
// =============================================================================

const createBr = vi.hoisted(() =>
  vi.fn(async (input: unknown) => ({
    id: 500,
    brNo: "BR-0042",
    ...(input as Record<string, unknown>),
  })),
);
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
  };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 0,
  }),
}));

import { BuildRequestFormModal } from "./BuildRequestFormModal";

/** A task that has both a project AND a real discussion to carry. */
const TASK = MOCK_TASKS.find((t) => t.parentProject !== null && t.comments.length > 0)!;

beforeEach(() => {
  vi.clearAllMocks();
});

function submitArgs(): Record<string, unknown> {
  return createBr.mock.calls[0][0] as Record<string, unknown>;
}

describe("BuildRequestFormModal — fromTask", () => {
  it("names the source task in the heading", async () => {
    renderWithProviders(<BuildRequestFormModal fromTask={TASK} onClose={vi.fn()} />);
    expect(
      await screen.findByRole("heading", {
        name: `New Build Request from ${TASK.numberedTitle}`,
      }),
    ).toBeInTheDocument();
  });

  it("prefills the task's PLAIN title, not its numbered one", async () => {
    // The BR's Title column is "Product or Project Name" — "T3-0017-…" is a
    // task identifier and means nothing on a build request.
    renderWithProviders(<BuildRequestFormModal fromTask={TASK} onClose={vi.fn()} />);
    const title = await screen.findByPlaceholderText("e.g. HUB V4");
    expect(title).toHaveValue(TASK.title);
  });

  it("shows the task reference LOCKED, never as a picker", async () => {
    // Arriving here from a task means the task is already decided. Offering
    // to change it invites a BR pointing at a task whose discussion it
    // just carried over.
    renderWithProviders(<BuildRequestFormModal fromTask={TASK} onClose={vi.fn()} />);
    const label = (await screen.findByText("Task Reference")).parentElement!;
    expect(label).toHaveTextContent(TASK.numberedTitle);
    expect(label.querySelector('[aria-haspopup="listbox"]')).toBeNull();
  });

  it("says how many comments will be copied", async () => {
    renderWithProviders(<BuildRequestFormModal fromTask={TASK} onClose={vi.fn()} />);
    expect(
      await screen.findByText(
        new RegExp(`${TASK.comments.length} comments? will be copied`, "i"),
      ),
    ).toBeInTheDocument();
  });

  it("submits the task link and the carried discussion together", async () => {
    renderWithProviders(<BuildRequestFormModal fromTask={TASK} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Create" }));

    await waitFor(() => expect(createBr).toHaveBeenCalledTimes(1));
    const args = submitArgs();
    expect(args.taskReferenceLookupId).toBe(TASK.id);

    const carried = parseCommunication(args.communication as string);
    // Every task comment, plus the "raised from" header.
    expect(carried).toHaveLength(TASK.comments.length + 1);
    expect(carried.some((c) => /Raised from task/.test(c.bodyHtml))).toBe(true);
  });

  it("carries the task's project across", async () => {
    renderWithProviders(<BuildRequestFormModal fromTask={TASK} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Create" }));
    await waitFor(() => expect(createBr).toHaveBeenCalledTimes(1));
    expect(submitArgs().parentProjectLookupIds).toEqual([TASK.parentProject!.lookupId]);
  });

  it("navigates to the new build request after submitting", async () => {
    const onClose = vi.fn();
    renderWithProviders(<BuildRequestFormModal fromTask={TASK} onClose={onClose} />);
    await userEvent.click(await screen.findByRole("button", { name: "Create" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockNavigate).toHaveBeenCalledWith("/build-request/500");
  });

  it("leaves every other field editable", async () => {
    renderWithProviders(<BuildRequestFormModal fromTask={TASK} onClose={vi.fn()} />);
    const title = await screen.findByPlaceholderText("e.g. HUB V4");
    expect(title).not.toBeDisabled();
    const typeLabel = screen.getByText("Type").closest("label")!;
    expect(typeLabel.querySelector('[aria-haspopup="listbox"]')).not.toBeNull();
  });
});

describe("BuildRequestFormModal — the ordinary create is unaffected", () => {
  it("keeps the plain heading, an empty title and no Task Reference row", async () => {
    renderWithProviders(<BuildRequestFormModal onClose={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "New Build Request" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. HUB V4")).toHaveValue("");
    expect(screen.queryByText("Task Reference")).toBeNull();
  });

  it("sends no task link and no pre-built discussion", async () => {
    renderWithProviders(<BuildRequestFormModal onClose={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText("e.g. HUB V4"), "Standalone build");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createBr).toHaveBeenCalledTimes(1));
    expect(submitArgs().taskReferenceLookupId).toBeNull();
    expect(submitArgs().communication).toBeUndefined();
  });
});
