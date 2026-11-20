import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Send, X } from "lucide-react";
import { useHarnessPartNumbers } from "@/hooks/useHarnessProductionLog";
import { useRequestHarnessPartNumber } from "@/hooks/useHarnessAlertRecipients";
import { classifyHarnessPartRequest } from "@/lib/harnessPartRequest";

interface HarnessPartRequestDialogProps {
  onClose: () => void;
}

/**
 * "Request a part number" — for somebody who isn't an ARC admin and needs a
 * part that isn't in the dropdown: brand new, or retired (Tim, 2026-10-27).
 * Emails the "Part number request" people on Harness Alert Recipients.
 *
 * It says as you type what the number is to the list — new, retired (so the
 * ask is to restore it), or already there (nothing to ask; pick it instead).
 *
 * Portalled to <body>, because it opens from INSIDE the harness entry form and
 * a <form> in a <form> is invalid. Its submit also stops propagation: React
 * routes a portal's events through the component tree, and sending the request
 * must never submit the entry form behind it. Checked 2026-10-27 that the
 * entry form doesn't submit even without that line (the test pins the result,
 * not the line), so it is belt-and-braces.
 */
export function HarnessPartRequestDialog({ onClose }: HarnessPartRequestDialogProps) {
  const { data: parts = [] } = useHarnessPartNumbers();
  const request = useRequestHarnessPartNumber();
  const [partNumber, setPartNumber] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [sentTo, setSentTo] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const kind = useMemo(
    () => (partNumber.trim() ? classifyHarnessPartRequest(partNumber, parts) : null),
    [partNumber, parts],
  );
  const busy = request.isPending;

  // On the document, not the dialog: after a send the focused button is gone,
  // so a key handler on the dialog would never see Escape. The entry form
  // behind ignores Escape while this is open — one thing closes at a time.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    try {
      setSentTo(await request.mutateAsync({ partNumber, description, note }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the request.");
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="Request a part number"
        className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-fg">Request a part number</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-sm p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>

        {sentTo ? (
          <>
            <p role="status" className="rounded-md bg-cooper-green/10 px-3 py-2 text-sm text-fg">
              Sent to {sentTo.join(", ")}. You'll be able to pick the part once it's been added.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                autoFocus
                onClick={onClose}
                className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-fg-muted">
              Only ARC admins add or restore harness part numbers. This emails the people who look after the list.
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Part number *</span>
              <input
                autoFocus
                value={partNumber}
                onChange={(e) => setPartNumber(e.target.value)}
                className="select font-mono"
                disabled={busy}
              />
              {kind && (
                <span
                  role="note"
                  className={kind.kind === "active" ? "text-[11px] font-semibold text-cooper-red" : "text-[11px] text-fg-muted"}
                >
                  {kind.kind === "new"
                    ? "Not on the list — this asks for it to be added."
                    : kind.kind === "retired"
                      ? `${kind.part.title} is retired — this asks for it to be restored.`
                      : `${kind.part.title} is already on the list. Pick it from the Part Number dropdown.`}
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Description</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} className="select" disabled={busy} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Why it's needed</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="e.g. new work order 1002089401"
                className="rounded-md border border-border bg-bg px-3 py-2 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-hidden sm:text-sm"
                disabled={busy}
              />
            </label>
            {error && <p className="rounded-md bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg-muted hover:text-fg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !partNumber.trim() || kind?.kind === "active"}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                {busy ? "Sending…" : "Send request"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>,
    document.body,
  );
}
