import type { QcFormField } from "./qcFormEngine";

// =============================================================================
// QC Forms — the paper sheet as a pure layout model, shared by every form.
//
// A form's sheet layout (e.g. lib/qcCpu95Sheet.ts) is a list of draw
// operations in PIXELS on the scan of its blank paper form, y = text baseline;
// lib/qcFormPdf.ts scales them to Letter points and draws them. Working in the
// scan's pixels means a layout can be checked against the scan by eye.
//
// The helpers here are the parts every form's layout needs: print text, rule a
// blank, and write a record's value onto that blank the way the paper means it
// (a tick for Yes, the words for No or N/A, MM/DD/YYYY for a date, and N/A in
// print on a line the unit doesn't use).
// =============================================================================

export type SheetFont = "normal" | "bold" | "italic" | "bolditalic";

export type SheetOp =
  | {
      type: "text";
      x: number;
      y: number;
      text: string;
      size?: number;
      font?: SheetFont;
      underline?: boolean;
      align?: "left" | "center" | "right";
      /** A value from the record, rather than the form's own print. */
      filled?: boolean;
    }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number }
  | { type: "rect"; x: number; y: number; w: number; h: number; fill?: boolean }
  | { type: "check"; x: number; y: number }
  /**
   * A filled value that may need more than one line — wrapped by the
   * renderer. What doesn't fit in `maxLines` is printed in full on a
   * continuation page under `title`, never cut off.
   */
  | {
      type: "wrap";
      x: number;
      y: number;
      width: number;
      lineHeight: number;
      maxLines: number;
      text: string;
      title: string;
    };

export interface SheetPage {
  ops: SheetOp[];
}

/** The body text size, in points, of a sheet's printed lines. */
export const SHEET_BODY_SIZE = 8;

/** What every layout helper needs to know about the sheet being drawn. */
export interface SheetCtx {
  ops: SheetOp[];
  /** Values to print; empty for the blank form. */
  values: Record<string, string>;
  /** The keys the unit shows — only these reach paper. */
  visible: Set<string>;
  /** A filled export (a record), not a blank form. */
  filled: boolean;
  /**
   * The sheet is for one unit — a filled record, or a blank printed for one
   * variant. Lines that unit doesn't use are then marked N/A in print.
   */
  known: boolean;
  fieldByKey: Record<string, QcFormField>;
}

/** "2026-10-20" → "10/20/2026"; anything else as stored. */
export function sheetDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return m ? `${m[2]}/${m[3]}/${m[1]}` : value.trim();
}

export function sheetText(
  ctx: SheetCtx,
  x: number,
  y: number,
  t: string,
  opts: Partial<Extract<SheetOp, { type: "text" }>> = {},
) {
  ctx.ops.push({ type: "text", x, y, text: t, size: SHEET_BODY_SIZE, ...opts });
}

export function sheetUnderline(ctx: SheetCtx, x1: number, x2: number, y: number) {
  ctx.ops.push({ type: "line", x1, y1: y + 2, x2, y2: y + 2 });
}

/** The record's value for `key`, or "" when blank, hidden for this unit, or a blank export. */
export function sheetValue(ctx: SheetCtx, key: string): string {
  if (!ctx.filled || !ctx.visible.has(key)) return "";
  return (ctx.values[key] ?? "").trim();
}

/** An underlined blank, with the value written on it (left-aligned, or centred). */
export function sheetBlank(ctx: SheetCtx, x1: number, x2: number, y: number, key: string | null, center = false) {
  sheetUnderline(ctx, x1, x2, y);
  if (!key) return;
  const field = ctx.fieldByKey[key];
  if (field && ctx.known && !ctx.visible.has(key)) {
    // A line this unit doesn't use — printed (black), not an answer (blue).
    sheetText(ctx, (x1 + x2) / 2, y, "N/A", { align: "center", size: 7 });
    return;
  }
  let v = sheetValue(ctx, key);
  if (!v) return;
  if (field?.kind === "flag" || (field?.kind === "check" && v === "Yes")) {
    ctx.ops.push({ type: "check", x: (x1 + x2) / 2, y });
    return;
  }
  if (field?.kind === "check") {
    // No or N/A, in words — a tick can't say either.
    sheetText(ctx, (x1 + x2) / 2, y, v.toUpperCase(), { filled: true, align: "center", size: 7 });
    return;
  }
  if (field?.kind === "date") v = sheetDate(v);
  if (center) sheetText(ctx, (x1 + x2) / 2, y, v, { filled: true, align: "center" });
  else sheetText(ctx, x1 + 3, y, v, { filled: true });
}
