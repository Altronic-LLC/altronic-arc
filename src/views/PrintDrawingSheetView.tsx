import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useDrawingLog } from "@/hooks/useDrawingLogs";
import { CHANGE_SLOTS } from "@/lib/drawingLogMapper";
import { formatSpDate } from "@/lib/spDates";
import { LoadingTasks } from "@/components/LoadingTasks";
import type { DrawingChange, DrawingLogEntry, DrawingLogKind } from "@/types/task";

// =============================================================================
// DRAWING WORK SHEET — the paper form (FORM #E006, REV. 7) that accompanies a
// CAD drawing from work-in-progress through to release.
//
// Two deliberate properties, both from Ray's marked-up copy (2026-07-30):
//
// 1. IT PRINTS EVERYTHING WE HOLD. The form Hoerbiger generates leaves out data
//    that is in the register — the Entered By / By initials, and the second
//    column of the change history (revisions 9-16). Those were annotated "in DB
//    but doesn't print". So this sheet renders all 16 change slots and every CAD
//    field, including the read-only ones.
//
// 2. HALF THE FORM IS DELIBERATELY BLANK. Prototype / Preliminary / Production,
//    the checked-approved / entered-in-system / to-mylar dates, and the whole
//    Print Distribution block have no columns behind them — they're filled in by
//    hand as the drawing moves. Printing them as empty ruled lines is the point
//    of the sheet, not a gap in the data.
//
// Sized for US Letter portrait (8.5 x 11) via @page in globals.css. Explicit
// light colours rather than theme tokens, so it prints the same from either
// theme — same convention as PrintTaskView / PrintBuildRequestItemView.
//
// CAD ONLY. The labels are CAD's ("CAD DRAWING NUMBER", the AutoCAD software
// line) and CCC/CEC/Sketches don't carry By / EnteredBy / Software at all, so
// pointing this at another register would print a form of blank rows.
// =============================================================================

/** Slots 1-8 print in the left column, 9-16 in the right. */
export const HISTORY_ROWS = CHANGE_SLOTS / 2;

/**
 * The change log padded to all 16 slots, split into the form's two columns.
 *
 * Padded, not filtered: the form is a fixed grid of ruled lines, and a drawing
 * with three changes still prints thirteen empty rows for the next thirteen.
 */
export function historyColumns(changes: DrawingChange[]): {
  left: Array<DrawingChange | null>;
  right: Array<DrawingChange | null>;
} {
  const bySlot = new Map(changes.map((c) => [c.slot, c]));
  const slots = Array.from({ length: CHANGE_SLOTS }, (_, i) => bySlot.get(i + 1) ?? null);
  return { left: slots.slice(0, HISTORY_ROWS), right: slots.slice(HISTORY_ROWS) };
}

/** A value for the form, or an empty string so the ruled line prints bare. */
function text(entry: DrawingLogEntry, key: string): string {
  const value = entry.values[key];
  if (value == null || value === "") return "";
  if (value instanceof Date) return formatSpDate(value);
  return String(value);
}

export function PrintDrawingSheetView() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const logKind = (kind ?? "cad") as DrawingLogKind;
  const entryId = id ? parseInt(id, 10) : null;
  const { data: entries = [], isLoading } = useDrawingLog(logKind);

  const entry = useMemo(
    () => entries.find((e) => e.id === entryId) ?? null,
    [entries, entryId],
  );

  // Print only once the drawing is actually on the page — firing on load alone
  // snapshots the loading screen (the mistake PrintBuildRequestItemView records).
  useEffect(() => {
    if (isLoading || !entry) return;
    const t = window.setTimeout(() => window.print(), 500);
    return () => window.clearTimeout(t);
  }, [isLoading, entry]);

  if (isLoading) return <LoadingTasks noun="this drawing" />;

  if (!entry) {
    return (
      <div className="mx-auto max-w-[700px] p-8 text-sm">
        That drawing isn't in the {logKind.toUpperCase()} register — it may have been
        deleted. Go back to Drawing File Logs and open it from the table.
      </div>
    );
  }

  const { left, right } = historyColumns(entry.changes);

  return (
    <div className="mx-auto max-w-[8in] bg-white px-6 py-5 font-sans text-[10pt] text-black print:px-0 print:py-0">
      {/* ---------------------------------------------------------------- head */}
      <div className="flex items-start justify-between">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[7pt] font-bold uppercase tracking-wider text-gray-600">
            Prim Key:
          </span>
          <span className="text-[8pt]">{text(entry, "legacyId")}</span>
        </div>
      </div>

      <div className="text-center">
        <h1 className="font-display text-[17pt] font-bold uppercase leading-none tracking-tight">
          Drawing Work Sheet
        </h1>
        <div className="mt-0.5 text-[8pt] font-semibold uppercase tracking-wider">
          {text(entry, "software") || " "}
        </div>
      </div>

      {/* --------------------------------------------------------- identifiers */}
      <div className="mt-2 grid grid-cols-[1.55fr_1fr] gap-x-6">
        <div>
          <Row label="Date" value={text(entry, "drawingDate")} />
          <Row label="Drawing Number" value={text(entry, "drawingNo")} />
          <Row label="CAD Drawing Number" value={text(entry, "cadNumber")} />
          <Row label="Drawing Title" value={text(entry, "drawingTitle")} />
        </div>
        <div>
          {/* No columns behind these three — the stage is ticked by hand. */}
          <Row label="Prototype" value="" />
          <Row label="Preliminary" value="" />
          <Row label="Production" value="" />
          <Row label="Size" value={text(entry, "size")} />
        </div>
      </div>

      <hr className="my-2 border-t-2 border-black" />

      {/* -------------------------------------------------------- dates and by */}
      <div className="text-center text-[9pt] font-bold uppercase tracking-wide">
        New Revision: <span className="font-normal">{text(entry, "newRevision")}</span>
      </div>

      <div className="mt-1.5 grid grid-cols-[1.55fr_1fr] gap-x-6">
        <div>
          <Row label="Log Book Entry Date" value={text(entry, "logBookDate")} />
          <Row label="Date Completed" value={text(entry, "dateCompleted")} />
          <Row label="Date Checked/Approved" value="" />
          <Row label="Date Entered in Sys" value="" />
          <Row label="Date to Mylar" value="" />
        </div>
        <div>
          {/* Annotated "in DB but doesn't print" on the current form. */}
          <Row label="Entered By" value={text(entry, "enteredBy")} />
          <Row label="By" value={text(entry, "by")} />
          <Row label="By" value="" />
          <Row label="By" value="" />
          <Row label="By" value="" />
        </div>
      </div>

      {text(entry, "newDrawing") && (
        <div className="mt-1">
          <Row label="New Drawing" value={text(entry, "newDrawing")} />
        </div>
      )}

      <hr className="my-2 border-t-2 border-black" />

      {/* -------------------------------------------------- print distribution */}
      <div className="text-center text-[10pt] font-bold uppercase tracking-wide">
        Print Distribution
      </div>

      <div className="mt-1.5 grid grid-cols-2 gap-x-6">
        <Row label="Date Distributed" value="" />
        <Row label="By" value="" />
      </div>

      <p className="mt-1.5 text-[7.5pt] font-bold leading-snug">
        NOTE: PROTOTYPE AND PRELIMINARY DRAWINGS SHOULD NOT BE DISTRIBUTED UNLESS
        SPECIFIED BY DESIGN ENGINEER, APPROVED ORIGINALS SHOULD BE GIVEN TO
        DOCUMENT CONTROL FOR THE PROJECT FILE ENVELOPES.
      </p>

      <div className="mt-1.5 grid grid-cols-2 gap-x-6">
        <div>
          <ColumnHeading>Engineering/Sales/Purchasing:</ColumnHeading>
          {ENGINEERING_RECIPIENTS.map((r) => (
            <Recipient key={r} label={r} />
          ))}
        </div>
        <div>
          <ColumnHeading>Production/Quality Control:</ColumnHeading>
          {PRODUCTION_RECIPIENTS.map((r) => (
            <Recipient key={r} label={r} />
          ))}
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-[8pt] font-bold uppercase">Other:</span>
            <span className="min-w-[1.2in] flex-1 border-b border-gray-500">&nbsp;</span>
          </div>
        </div>
      </div>

      <hr className="my-2 border-t-2 border-black" />

      {/* ------------------------------------------------------ drawing history */}
      <div className="text-center text-[10pt] font-bold uppercase tracking-wide">
        Drawing History
      </div>

      <div className="mt-1 grid grid-cols-2 gap-x-6">
        <HistoryColumn rows={left} firstSlot={1} />
        <HistoryColumn rows={right} firstSlot={HISTORY_ROWS + 1} />
      </div>

      {/* -------------------------------------------------------------- footer */}
      <div className="mt-3 flex items-end justify-between text-[7pt]">
        <span className="italic">
          This form is to accompany drawing and related materials until released to
          production.
        </span>
        <span className="font-semibold">FORM #E006, REV. 7</span>
      </div>
      <div className="mt-1 text-[6.5pt] text-gray-500">
        Printed from ARC {new Date().toLocaleDateString()} · Altronic internal use only
      </div>
    </div>
  );
}

/** Left column of the distribution block, in the order the paper form lists them. */
const ENGINEERING_RECIPIENTS = [
  "V.P. of Engineering",
  "Document Control",
  "Design Engineer",
  "Sales(2)",
  "Purchasing",
];

const PRODUCTION_RECIPIENTS = [
  "Mfg. Engineer",
  "Mfg. Test Engineer",
  "Production Manager",
  "Q.C. Manager",
  "Repair Depr.",
];

/**
 * One labelled value on a ruled line. An empty value still prints its line —
 * that's how the blank-by-design fields get somewhere to write.
 */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5 leading-[1.6]">
      <span className="shrink-0 text-[8pt] font-bold uppercase">{label}:</span>
      <span className="min-w-0 flex-1 border-b border-gray-400 text-[9pt]">
        {value || " "}
      </span>
    </div>
  );
}

function ColumnHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-0.5 text-[8pt] font-bold uppercase">{children}</div>
  );
}

/** A tick line plus the role — initialled by whoever takes the print. */
function Recipient({ label }: { label: string }) {
  return (
    <div className="flex items-baseline gap-2 leading-[1.55]">
      <span className="w-[0.55in] shrink-0 border-b border-gray-500">&nbsp;</span>
      <span className="text-[8pt] font-semibold uppercase">{label}</span>
    </div>
  );
}

/**
 * Eight change rows. Slot numbers are printed small alongside, because the log is
 * a fixed sixteen slots and a correction is discussed as "slot 4", not "the
 * fourth one down" — a sparse log makes those different rows.
 */
function HistoryColumn({
  rows,
  firstSlot,
}: {
  rows: Array<DrawingChange | null>;
  firstSlot: number;
}) {
  return (
    <table className="w-full border-collapse text-[8.5pt]">
      <thead>
        <tr className="border-b border-black text-[7.5pt] uppercase">
          <th className="w-[0.2in] text-left font-bold">#</th>
          <th className="text-left font-bold">Date Changed</th>
          <th className="w-[0.5in] text-left font-bold">Rev #</th>
          <th className="w-[0.85in] text-left font-bold">ECN #</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((change, i) => (
          <tr key={firstSlot + i} className="border-b border-gray-300">
            <td className="text-[7pt] text-gray-500">{firstSlot + i}</td>
            <td>{change?.date ? formatSpDate(change.date) : " "}</td>
            <td>{change?.rev || " "}</td>
            <td>{change?.ecn || " "}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
