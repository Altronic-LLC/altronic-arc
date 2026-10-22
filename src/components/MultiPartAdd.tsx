import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useLookUpSapParts, type PastedPartResult } from "@/hooks/usePricingLookup";
import { isPricingDataNotConnected, needsSapSignIn } from "@/api/pricingLookup";
import { FabricAuthError, FabricRequestError, signInToFabric } from "@/api/fabric";
import { parsePartNumberList } from "@/lib/pricingMath";

// =============================================================================
// Add several parts at once (Ray, 2026-10-22) — the SAP comparison's paste box,
// for a sub-assembly's components and for a worksheet's parts. Paste a column
// out of Excel (SAP #s, Altronic #s, or a mix): each number is looked up in
// SAP and handed to `onAdd`, which adds what it should and says what it did.
//
// * A number SAP DOESN'T HAVE is still added, for its description and cost to
//   be typed. A number SAP COULDN'T BE ASKED ABOUT (unreachable, refused, not
//   signed in) is NOT added as a blank row — it stays in the box, with the
//   reason, so Add tries it again (Ray, 2026-10-22: "it should try and bring
//   in the SAP data available"). The one exception is SAP not being connected
//   at all: asking again changes nothing, so those are added as typed.
// * Anything with no digit is dropped — a pasted header ("SAP Part Number")
//   isn't three parts.
// =============================================================================

/** The pasted part numbers — words with no digit (a column header) dropped. */
export function pastedPartNumbers(text: string): string[] {
  return parsePartNumberList(text).filter((t) => /\d/.test(t));
}

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
  const [signIn, setSignIn] = useState(false);

  async function add() {
    const all = pastedPartNumbers(text);
    if (all.length === 0 || busy) {
      if (text.trim() && all.length === 0) setNote("No part numbers there — a part number has at least one digit.");
      return;
    }
    const numbers = all.slice(0, MAX_PASTED_PARTS);
    setBusy(true);
    try {
      const results = await lookUp(numbers);
      const retry = results.filter((r) => r.failed && !isPricingDataNotConnected(r.error));
      const usable = results.filter((r) => !retry.includes(r));
      const said = usable.length > 0 ? onAdd(usable) : "";
      const over = all.slice(MAX_PASTED_PARTS);
      const kept = [...retry.map((r) => r.number), ...over];
      setNote(
        [
          said,
          retry.length > 0
            ? `${retry.length} couldn't be checked — ${sapFailureReason(retry[0].error)}. Left in the box: press Add to try again.`
            : "",
          over.length > 0 ? `${over.length} more left in the box — ${MAX_PASTED_PARTS} at a time.` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      setSignIn(retry.some((r) => needsSapSignIn(r.error)));
      setText(kept.join(" "));
    } finally {
      setBusy(false);
    }
  }

  async function doSignIn() {
    try {
      await signInToFabric();
      setSignIn(false);
      await add();
    } catch (err) {
      setNote(`Couldn't sign in to SAP: ${err instanceof Error ? err.message : String(err)}`);
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
      {signIn && (
        <button
          type="button"
          onClick={() => void doSignIn()}
          className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-2"
        >
          Sign in to SAP
        </button>
      )}
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

/** Why SAP couldn't be asked, in a few words. Nothing is guessed: an unrecognised failure says only that. */
export function sapFailureReason(err: unknown): string {
  if (needsSapSignIn(err)) return "sign in to SAP first";
  if (err instanceof FabricAuthError) return "your sign-in can't read SAP yet";
  if (err instanceof FabricRequestError && err.cause === "http" && (err.detail.status === 401 || err.detail.status === 403)) {
    return "your account can't read SAP";
  }
  return "SAP couldn't be reached just now";
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
    failed > 0 ? `${failed} added as typed — SAP data isn't connected; fill them in.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
