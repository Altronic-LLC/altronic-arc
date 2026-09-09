import { useState } from "react";
import { PANEL_QC_LABEL_PRINTER_NAME } from "@/api/config";
import { checkQzPrinterAvailable, printHtmlSilently, type QzLabelSize } from "@/api/qzPrint";

/**
 * A self-contained, fully inline-styled test label — same reasoning as
 * `buildPanelQcLabelHtml` in `PrintPanelQcIssueView.tsx`: QZ Tray's HTML
 * print path uses its OWN limited renderer, not the browser's, so this has
 * no Tailwind classes and no flexbox. Scales its font size down for a very
 * small label so the text has a chance of fitting a 1"×0.5" test roll.
 */
function buildTestLabelHtml(size: QzLabelSize): string {
  const smallSide = Math.min(size.widthIn, size.heightIn);
  const fontPt = smallSide < 0.75 ? 6 : smallSide < 1.5 ? 8 : 11;
  const timestamp = new Date().toLocaleTimeString();
  return `
<div style="box-sizing:border-box;width:${size.widthIn}in;height:${size.heightIn}in;padding:0.05in;font-family:Arial,Helvetica,sans-serif;font-size:${fontPt}pt;line-height:1.2;color:#000;background:#fff;overflow:hidden;">
  <div style="font-weight:bold;">QZ TEST</div>
  <div>${size.widthIn}" × ${size.heightIn}"</div>
  <div>${timestamp}</div>
</div>`.trim();
}

type Status = { tone: "idle" | "info" | "success" | "error"; text: string };

const TONE_CLASS: Record<Status["tone"], string> = {
  idle: "border-border bg-surface text-fg-muted",
  info: "border-border bg-surface text-fg-muted",
  success: "border-cooper-green/40 bg-cooper-green/10 text-cooper-green",
  error: "border-cooper-red/40 bg-cooper-red/10 text-cooper-red",
};

/**
 * Dev-only page (never rendered in production — see the `import.meta.env.DEV`
 * guard around its route in App.tsx) for testing the QZ Tray silent-print
 * path against WHATEVER printer and label size a tester actually has on
 * their desk, independent of the real Panel QC label's fixed 2"×2" size.
 * Reached at /dev/qz-print-test while running `npm run dev`.
 */
export function DevQzPrintTestView() {
  const [printerName, setPrinterName] = useState(PANEL_QC_LABEL_PRINTER_NAME ?? "");
  const [widthIn, setWidthIn] = useState(1);
  const [heightIn, setHeightIn] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({
    tone: "idle",
    text: "Set VITE_PANEL_QC_LABEL_PRINTER_NAME in .env.local to preload this, or just type a printer name below.",
  });

  const size: QzLabelSize = { widthIn, heightIn };

  async function handleCheck() {
    setBusy(true);
    setStatus({ tone: "info", text: "Checking QZ Tray…" });
    try {
      const found = await checkQzPrinterAvailable(printerName);
      setStatus(
        found
          ? { tone: "success", text: `QZ Tray found it: "${found}"` }
          : {
              tone: "error",
              text: `QZ Tray is running, but no printer matched "${printerName}". Check the exact name in QZ Tray's tray icon → Advanced → Printer Info, or Windows' "Printers & scanners" settings.`,
            },
      );
    } catch (err) {
      setStatus({
        tone: "error",
        text: `Couldn't reach QZ Tray — is it installed and running on this machine? (${err instanceof Error ? err.message : String(err)})`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handlePrint() {
    setBusy(true);
    setStatus({ tone: "info", text: "Sending the test label…" });
    const ok = await printHtmlSilently(printerName, buildTestLabelHtml(size), size);
    setStatus(
      ok
        ? { tone: "success", text: "Sent — check the label came out right on your test printer." }
        : {
            tone: "error",
            text: "Couldn't print silently. Open the browser console for the real error (QZ Tray not running, printer not found, or the print call itself failing all land here).",
          },
    );
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-md space-y-5 p-8">
      <div>
        <h1 className="text-lg font-semibold text-fg">QZ Tray print test</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Dev-only — this page doesn't exist in the deployed app. Use it to confirm QZ Tray finds your printer
          and can print to it silently, at whatever small label size you actually have loaded, without needing
          a real Panel QC issue or the real 2"×2" label size.
        </p>
      </div>

      <label className="block text-sm text-fg">
        Printer name (exactly as QZ Tray sees it)
        <input
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
          value={printerName}
          onChange={(e) => setPrinterName(e.target.value)}
          placeholder="e.g. Zebra ZD410"
        />
      </label>

      <div className="flex gap-4">
        <label className="block flex-1 text-sm text-fg">
          Label width (in)
          <input
            type="number"
            step="0.1"
            min="0.1"
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
            value={widthIn}
            onChange={(e) => setWidthIn(Number(e.target.value) || 0)}
          />
        </label>
        <label className="block flex-1 text-sm text-fg">
          Label height (in)
          <input
            type="number"
            step="0.1"
            min="0.1"
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
            value={heightIn}
            onChange={(e) => setHeightIn(Number(e.target.value) || 0)}
          />
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !printerName.trim()}
          onClick={handleCheck}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg transition-colors hover:border-cooper-red hover:text-cooper-red disabled:cursor-not-allowed disabled:opacity-40"
        >
          Check printer
        </button>
        <button
          type="button"
          disabled={busy || !printerName.trim() || widthIn <= 0 || heightIn <= 0}
          onClick={handlePrint}
          className="rounded-md bg-cooper-red px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cooper-red/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Print test label
        </button>
      </div>

      <div className={`rounded-md border px-3 py-2 text-xs ${TONE_CLASS[status.tone]}`}>{status.text}</div>
    </div>
  );
}

export { buildTestLabelHtml };
