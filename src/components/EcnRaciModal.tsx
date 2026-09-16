import { useEffect, useMemo, useRef } from "react";
import { X, Users } from "lucide-react";
import { useOverlayDismiss } from "./useOverlayDismiss";
import {
  ECN_RACI_BY_ITEM,
  ECN_RACI_DEPARTMENTS,
  ECN_RACI_ITEM_COUNT,
  ECN_RACI_LEGEND,
  ECN_RACI_ROLES,
  RACI_COMBINED_NOTE,
} from "@/lib/ecnChecklistRaci";
import { ECN_CHECKLIST_ITEMS, itemByKey } from "@/lib/ecnChecklistTemplate";
import { cn } from "@/lib/cn";

// =============================================================================
// The RACI matrix from MFGFRM-038, as a reference modal.
//
// Static reference, NOT stored data (Ray, 2026-09-15) — it is identical on
// every ECN, so it lives in code and never touches the checklist row.
//
// Three things about how it renders:
//
//  - **32 role columns do not fit.** The grid scrolls horizontally inside its
//    OWN container, with the item text frozen in the first column — the house
//    rule that the page body must never scroll sideways.
//  - **Only the 18 items that carry marks are shown.** Sections 4-10 have none
//    on Rev 0; 66 empty rows would read as a rendering fault rather than as
//    missing source data, so the count is stated in words instead.
//  - **`focusItemKey` scrolls to one row and highlights it**, because "who do
//    I consult for THIS line" is the question someone actually has while
//    filling the checklist out — hunting for it in a 32-column grid is worse
//    than not having it.
// =============================================================================

/** The mark's tone — A and R are the ones somebody must act on. */
function markTone(mark: string): string {
  if (mark.includes("A")) return "bg-accent/15 text-accent border-accent/30";
  if (mark.includes("R")) return "bg-cooper-green/15 text-cooper-green border-cooper-green/30";
  if (mark.includes("C")) return "bg-superior-blue/15 text-superior-blue border-superior-blue/30";
  return "bg-muted/60 text-fg-muted border-border";
}

export function EcnRaciModal({
  onClose,
  focusItemKey,
}: {
  onClose: () => void;
  /** Scroll to and highlight this item's row, when it has marks. */
  focusItemKey?: string;
}) {
  const overlayDismiss = useOverlayDismiss(onClose);
  const focusRef = useRef<HTMLTableRowElement | null>(null);

  // Items in FORM order, so the matrix reads the same way the checklist does.
  const rows = useMemo(
    () =>
      ECN_CHECKLIST_ITEMS.filter((item) => (ECN_RACI_BY_ITEM[item.key]?.length ?? 0) > 0).map(
        (item) => ({ item, marks: ECN_RACI_BY_ITEM[item.key] }),
      ),
    [],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    // Feature-detected: `scrollIntoView` is absent in jsdom and on some older
    // browsers, and scrolling to a row is a nicety — it must never be the
    // reason the whole modal fails to render.
    const row = focusRef.current;
    if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [focusItemKey]);

  /** A role's mark on one item, or "" when the form assigns none. */
  function markFor(itemKey: string, role: string): string {
    return ECN_RACI_BY_ITEM[itemKey]?.find((m) => m.role === role)?.mark ?? "";
  }

  const focusedItem = focusItemKey ? itemByKey(focusItemKey) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Who is involved? (RACI)"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <Users className="h-4 w-4 text-accent" />
            Who is involved? (RACI)
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-fg-muted hover:bg-muted hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm text-fg-muted">
            From the Cross-Functional ECN Checklist, Form# MFGFRM-038 Rev 0. Reference only —
            nothing here is stored against an ECN.
          </p>

          {/* Legend first: the matrix is unreadable without it. */}
          <div className="mt-4 rounded-lg border border-border bg-bg p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
              What the letters mean
            </h3>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              {ECN_RACI_LEGEND.map((l) => (
                <div key={l.letter} className="flex gap-2">
                  <dt>
                    <span
                      className={cn(
                        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border text-xs font-semibold",
                        markTone(l.letter),
                      )}
                    >
                      {l.letter}
                    </span>
                  </dt>
                  <dd className="text-xs text-fg-muted">
                    <span className="font-medium text-fg">{l.role}</span> — {l.meaning}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 border-t border-border pt-2 text-xs text-fg-muted">
              {RACI_COMBINED_NOTE}
            </p>
          </div>

          {focusedItem && (
            <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">
                Highlighted item
              </h3>
              <p className="mt-1 text-sm text-fg">{focusedItem.text}</p>
            </div>
          )}

          <p className="mt-4 text-xs text-fg-muted">
            {ECN_RACI_ITEM_COUNT} of {ECN_CHECKLIST_ITEMS.length} checklist items carry a RACI
            assignment on Rev 0 of the form — all of them in Sections 1–3. The remaining{" "}
            {ECN_CHECKLIST_ITEMS.length - ECN_RACI_ITEM_COUNT} have none assigned, which is not
            the same as having nobody involved.
          </p>

          {/* The matrix. Scrolls in its OWN container — never the page body. */}
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-max min-w-full border-collapse text-xs">
              <thead>
                <tr className="bg-muted/60">
                  <th
                    scope="col"
                    className="sticky left-0 z-10 min-w-[18rem] max-w-[22rem] border-b border-r border-border bg-muted/60 p-2 text-left font-semibold text-fg"
                  >
                    Review step
                  </th>
                  {ECN_RACI_DEPARTMENTS.map((dept) => {
                    const span = ECN_RACI_ROLES.filter((r) => r.department === dept).length;
                    return (
                      <th
                        key={dept}
                        scope="col"
                        colSpan={span}
                        className="border-b border-l border-border p-2 text-center font-semibold text-fg"
                      >
                        {dept}
                      </th>
                    );
                  })}
                </tr>
                <tr className="bg-muted/30">
                  <th
                    scope="col"
                    className="sticky left-0 z-10 border-b border-r border-border bg-muted/30 p-2 text-left font-medium text-fg-muted"
                  >
                    <span className="sr-only">Review step</span>
                  </th>
                  {ECN_RACI_ROLES.map((r) => (
                    <th
                      key={r.column}
                      scope="col"
                      className="h-32 border-b border-l border-border p-1 align-bottom"
                    >
                      {/* Rotated so 32 columns fit without a 40rem-wide table. */}
                      <div className="mx-auto w-5 whitespace-nowrap text-left font-medium text-fg-muted [writing-mode:vertical-rl] [transform:rotate(180deg)]">
                        {r.role}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ item }) => {
                  const focused = item.key === focusItemKey;
                  return (
                    <tr
                      key={item.key}
                      ref={focused ? focusRef : undefined}
                      className={cn(focused ? "bg-accent/10" : "odd:bg-bg even:bg-surface")}
                    >
                      <th
                        scope="row"
                        className={cn(
                          "sticky left-0 z-10 min-w-[18rem] max-w-[22rem] border-b border-r border-border p-2 text-left align-top font-normal text-fg",
                          focused ? "bg-accent/10" : "bg-inherit",
                        )}
                      >
                        <span className="text-[0.7rem] font-semibold text-fg-muted">
                          §{item.section}
                        </span>{" "}
                        {item.text}
                      </th>
                      {ECN_RACI_ROLES.map((r) => {
                        const mark = markFor(item.key, r.role);
                        return (
                          <td
                            key={r.column}
                            className="border-b border-l border-border p-1 text-center align-middle"
                          >
                            {mark && (
                              <span
                                className={cn(
                                  "inline-flex min-w-[2rem] items-center justify-center rounded border px-1 py-0.5 text-[0.7rem] font-semibold",
                                  markTone(mark),
                                )}
                                title={`${r.role} — ${mark}`}
                              >
                                {mark}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-muted"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
