import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useLookUpSapParts, type PastedPartResult } from "@/hooks/usePricingLookup";
import { parsePartNumberList } from "@/lib/pricingMath";

// =============================================================================
// Add several parts at once (Ray, 2026-10-22) — the SAP comparison's paste box,
// for a sub-assembly's components and for a worksheet's parts. Paste a column
// out of Excel (SAP #s, Altronic #s, or a mix): each number is looked up in
// SAP and handed to `onAdd`, which adds what it should and says what it did.
// =============================================================================

/** At most this many per paste — enough for a BOM column, not a whole parts list. */
export const MAX_PASTED_PARTS = 100;

export function MultiPartAdd({
  label,
  onAdd,
  onDone,
}: {
  /** Names the box for a screen reader, e.g. "Component part numbers to add". */
  label: string;
  /** Adds the looked-up parts; returns the sentence to show. */
  onAdd: (results: PastedPartResult[]) => string;
  onDone?: () => void;
}) {
  const lookUp = useLookUpSapParts();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function add() {
    const all = parsePartNumberList(text);
    if (all.length === 0 || busy) return;
    const numbers = all.slice(0, MAX_PASTED_PARTS);
    setBusy(true);
    try {
      const results = await lookUp(numbers);
      const said = onAdd(results);
      const over = all.length - numbers.length;
      setNote([said, over > 0 ? `${over} more left out — ${MAX_PASTED_PARTS} at a time.` : ""].filter(Boolean).join(" "));
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-3 flex flex-wrap items-start gap-2 rounded-md border border-dashed border-border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <textarea
        aria-label={label}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void add();
          }
        }}
        placeholder="SAP or Altronic part numbers — paste several at once"
        className="input min-h-9 w-80! max-w-full resize-y py-1.5 font-mono text-xs"
        disabled={busy}
      />
      <button
        type="submit"
        disabled={!text.trim() || busy}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {busy ? "Looking up…" : "Add"}
      </button>
      {onDone && (
        <button type="button" onClick={onDone} className="h-9 rounded-md px-2 text-xs text-fg-muted hover:text-fg">
          Close
        </button>
      )}
      {note && (
        <p role="status" className="w-full text-xs text-fg-muted">
          {note}
        </p>
      )}
    </form>
  );
}

/** "Added 3. 1 already here. 2 not found in SAP — type their description and cost." */
export function describePastedAdd(results: PastedPartResult[], duplicates: number, noun: string): string {
  // `results` are the ones ADDED — duplicates aren't counted twice.
  const added = results.length;
  const notFound = results.filter((r) => !r.failed && !r.part).length;
  const failed = results.filter((r) => r.failed).length;
  const noCost = results.filter((r) => r.part && r.part.cost === null).length;
  const plural = (n: number) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  return [
    added > 0 ? `Added ${plural(added)}.` : "Nothing new to add.",
    duplicates > 0 ? `${duplicates} already here.` : "",
    notFound > 0 ? `${notFound} not found in SAP — type their description and cost.` : "",
    noCost > 0 ? `${noCost} found with no SAP cost — type it.` : "",
    failed > 0 ? `${failed} couldn't be checked in SAP just now — added as typed; fill them in.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
