import { describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { QcFormsView } from "./QcFormsView";

describe("QcFormsView", () => {
  it("shows a button for every registered form", () => {
    renderWithProviders(<QcFormsView />);
    expect(screen.getByRole("button", { name: /CPU-95 Ignition Module/i })).toBeInTheDocument();
    expect(screen.getByText("QCFRM-012")).toBeInTheDocument();
  });

  it("filters the buttons by name, form number or description", async () => {
    renderWithProviders(<QcFormsView />);
    await userEvent.type(screen.getByPlaceholderText(/search forms/i), "nonexistent form");
    await waitFor(() => expect(screen.getByText(/no forms match/i)).toBeInTheDocument());

    await userEvent.clear(screen.getByPlaceholderText(/search forms/i));
    await userEvent.type(screen.getByPlaceholderText(/search forms/i), "QCFRM-012");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /CPU-95 Ignition Module/i })).toBeInTheDocument(),
    );
  });

  it("navigates to the form's own screen when clicked", async () => {
    renderWithProviders(<QcFormsView />);
    await userEvent.click(screen.getByRole("button", { name: /CPU-95 Ignition Module/i }));
    expect(mockNavigate).toHaveBeenCalledWith("/qc-forms/cpu-95");
  });
});
