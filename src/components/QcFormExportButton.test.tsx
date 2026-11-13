import { beforeEach, describe, expect, it, vi } from "vitest";

const download = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useQuotePdf", () => ({ downloadBlob: download }));
vi.mock("./Toast", () => ({ pushToast: toast }));

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { QcFormExportButton } from "./QcFormExportButton";

beforeEach(() => vi.clearAllMocks());

describe("QcFormExportButton", () => {
  it("downloads what build() makes", async () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    renderWithProviders(<QcFormExportButton label="Blank form" build={async () => ({ blob, fileName: "x.pdf" })} />);
    await userEvent.click(screen.getByRole("button", { name: "Blank form" }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(blob, "x.pdf"));
    expect(toast).not.toHaveBeenCalled();
  });

  it("says why when the export fails, and downloads nothing", async () => {
    renderWithProviders(
      <QcFormExportButton
        label="Export"
        build={async () => {
          throw new Error("jsPDF failed to load");
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        message: "Couldn't export the form — jsPDF failed to load",
        variant: "error",
      }),
    );
    expect(download).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  });
});
