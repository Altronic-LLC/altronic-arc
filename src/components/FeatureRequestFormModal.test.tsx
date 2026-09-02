import { describe, expect, it, vi, beforeEach } from "vitest";

const createRequest = vi.hoisted(() => vi.fn(async () => ({ id: 1, title: "New idea" })));
vi.mock("@/hooks/useFeatureRequests", () => ({
  useCreateFeatureRequest: () => ({ mutateAsync: createRequest, isPending: false }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { FeatureRequestFormModal } from "./FeatureRequestFormModal";

const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FeatureRequestFormModal", () => {
  it("disables Submit until a summary is typed", () => {
    renderWithProviders(<FeatureRequestFormModal onClose={onClose} />);
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });

  it("submits title, description, department and priority — nothing else", async () => {
    renderWithProviders(<FeatureRequestFormModal onClose={onClose} />);
    await userEvent.type(screen.getByPlaceholderText(/bulk status change/i), "My new idea");
    await userEvent.type(screen.getByPlaceholderText(/what's needed/i), "because reasons");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(createRequest).toHaveBeenCalledWith({
      title: "My new idea",
      description: "because reasons",
      department: null,
      priority: null,
    });
  });

  it("navigates to the new request's detail page on success", async () => {
    renderWithProviders(<FeatureRequestFormModal onClose={onClose} />);
    await userEvent.type(screen.getByPlaceholderText(/bulk status change/i), "Idea");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/feature-request/1");
  });

  it("has no RequestedBy, Status or Watchers field — those are set by the API", () => {
    renderWithProviders(<FeatureRequestFormModal onClose={onClose} />);
    expect(screen.queryByText(/requested by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^status$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/watchers/i)).not.toBeInTheDocument();
  });

  it("closes on Cancel without submitting", async () => {
    renderWithProviders(<FeatureRequestFormModal onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(createRequest).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
