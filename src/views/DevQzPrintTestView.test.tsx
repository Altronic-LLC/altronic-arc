import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

const checkQzPrinterAvailable = vi.hoisted(() => vi.fn());
const printHtmlSilently = vi.hoisted(() => vi.fn());

vi.mock("@/api/qzPrint", () => ({ checkQzPrinterAvailable, printHtmlSilently }));

const configMock = vi.hoisted(() => ({ PANEL_QC_LABEL_PRINTER_NAME: undefined as string | undefined }));
vi.mock("@/api/config", () => configMock);

import { DevQzPrintTestView } from "./DevQzPrintTestView";

beforeEach(() => {
  checkQzPrinterAvailable.mockReset();
  printHtmlSilently.mockReset();
  configMock.PANEL_QC_LABEL_PRINTER_NAME = undefined;
});

describe("DevQzPrintTestView", () => {
  it("preloads the printer name from the configured Panel QC printer, when set", () => {
    configMock.PANEL_QC_LABEL_PRINTER_NAME = "Zebra ZD410";
    renderWithProviders(<DevQzPrintTestView />);

    expect(screen.getByLabelText(/printer name/i)).toHaveValue("Zebra ZD410");
  });

  it("disables both actions until a printer name is entered", () => {
    renderWithProviders(<DevQzPrintTestView />);

    expect(screen.getByRole("button", { name: /check printer/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /print test label/i })).toBeDisabled();
  });

  it("reports the resolved printer name when Check printer finds a match", async () => {
    checkQzPrinterAvailable.mockResolvedValue("Zebra ZD410 (real name)");
    const user = userEvent.setup();
    renderWithProviders(<DevQzPrintTestView />);

    await user.type(screen.getByLabelText(/printer name/i), "Zebra");
    await user.click(screen.getByRole("button", { name: /check printer/i }));

    await waitFor(() => expect(screen.getByText(/Zebra ZD410 \(real name\)/)).toBeInTheDocument());
    expect(checkQzPrinterAvailable).toHaveBeenCalledWith("Zebra");
  });

  it("reports 'nothing matched' distinctly from 'QZ Tray unreachable'", async () => {
    checkQzPrinterAvailable.mockResolvedValue(null);
    const user = userEvent.setup();
    renderWithProviders(<DevQzPrintTestView />);

    await user.type(screen.getByLabelText(/printer name/i), "Nonexistent");
    await user.click(screen.getByRole("button", { name: /check printer/i }));

    await waitFor(() => expect(screen.getByText(/no printer matched/i)).toBeInTheDocument());
  });

  it("reports when QZ Tray itself can't be reached", async () => {
    checkQzPrinterAvailable.mockRejectedValue(new Error("connection refused"));
    const user = userEvent.setup();
    renderWithProviders(<DevQzPrintTestView />);

    await user.type(screen.getByLabelText(/printer name/i), "Zebra");
    await user.click(screen.getByRole("button", { name: /check printer/i }));

    await waitFor(() => expect(screen.getByText(/couldn't reach qz tray/i)).toBeInTheDocument());
  });

  it("sends the currently entered label size when printing a test label", async () => {
    printHtmlSilently.mockResolvedValue(true);
    const user = userEvent.setup();
    renderWithProviders(<DevQzPrintTestView />);

    await user.type(screen.getByLabelText(/printer name/i), "Zebra");
    const widthInput = screen.getByLabelText(/label width/i);
    await user.clear(widthInput);
    await user.type(widthInput, "1");
    const heightInput = screen.getByLabelText(/label height/i);
    await user.clear(heightInput);
    await user.type(heightInput, "0.5");
    await user.click(screen.getByRole("button", { name: /print test label/i }));

    await waitFor(() => expect(screen.getByText(/sent/i)).toBeInTheDocument());
    expect(printHtmlSilently).toHaveBeenCalledWith(
      "Zebra",
      expect.stringContaining("1\" × 0.5\""),
      { widthIn: 1, heightIn: 0.5 },
    );
  });

  it("reports a failed silent print without throwing", async () => {
    printHtmlSilently.mockResolvedValue(false);
    const user = userEvent.setup();
    renderWithProviders(<DevQzPrintTestView />);

    await user.type(screen.getByLabelText(/printer name/i), "Zebra");
    await user.click(screen.getByRole("button", { name: /print test label/i }));

    await waitFor(() => expect(screen.getByText(/couldn't print silently/i)).toBeInTheDocument());
  });
});
