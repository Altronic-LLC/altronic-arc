import type { ForceUnit } from "@/types/pullTest";

// =============================================================================
// The Mark-10 WT-205 wire crimp pull tester, as text (BusinessIT#64). Pure —
// the port itself is api/mark10Serial.ts.
//
// From the WT-205 User's Guide, §12 Communications and Outputs:
//  - USB and RS-232 send the SAME data; 8 data bits, 1 stop bit, no parity,
//    baud set on the tester (Serial/USB Settings → Baud Rate) up to 115,200.
//  - A reading is "124.8 lbF" + CR LF ("Numeric + Units"), or "124.8" + CR LF
//    ("Numeric Only").
//  - It sends one when DATA is pressed, by itself after a break when Auto
//    Settings → RS232/USB Output is on (the PEAK, plus a date/time stamp if
//    that option is installed), and in answer to "?" + CR.
//  - Units: lbF, ozF, kgF, N, kN.
//  - A "break" is the force passing the Break Detection threshold, then
//    falling to 2 lbF. The manual allows 1-90%; the firmware on our tester
//    refuses below 5% (10 lbF), so a weaker pull is only sent on DATA or "?".
//
// So: the first number on a line is the force, the word after it (if any) is
// the unit, and anything after that (a date/time stamp) is ignored.
// =============================================================================

/** The rates the WT-205 offers; the tester and ARC must match. */
export const MARK10_BAUD_RATES = [9600, 19200, 38400, 57600, 115200] as const;
export const DEFAULT_MARK10_BAUD = 9600;

/** "Request the displayed reading" — answered with one line. */
export const MARK10_READ_COMMAND = "?\r";

const UNIT_WORDS: Record<string, ForceUnit> = {
  lbf: "lbF",
  lb: "lbF",
  lbs: "lbF",
  n: "N",
  kgf: "kgF",
  kg: "kgF",
  ozf: "ozF",
  oz: "ozF",
  kn: "kN",
};

export type Mark10Line =
  | { ok: true; value: number; unit: ForceUnit | null }
  | { ok: false; reason: string };

/**
 * One line from the tester → a force, or why it isn't one.
 *
 * A NEGATIVE reading is refused, not made positive: the WT-205 measures
 * tension only, so a sign means something is set up differently from what ARC
 * expects, and guessing would put a number on a test nobody read. An unknown
 * unit (gF, mN from another Mark-10 gauge) is refused for the same reason.
 * "*10" is the tester's own "illegal command" reply.
 */
export function parseMark10Line(line: string): Mark10Line {
  const t = line.trim();
  if (!t) return { ok: false, reason: "The tester sent an empty line." };
  if (t.startsWith("*")) return { ok: false, reason: `The tester refused a command (${t}).` };
  const m = /^([+-]?)(\d*\.?\d+)(?:\s*([A-Za-z]+))?/.exec(t);
  if (!m) return { ok: false, reason: `The tester sent "${t}", which isn't a reading.` };
  if (m[1] === "-") {
    return { ok: false, reason: `The tester sent a negative reading (${t}). It should read tension as positive.` };
  }
  const value = Number(m[2]);
  if (!Number.isFinite(value)) return { ok: false, reason: `The tester sent "${t}", which isn't a reading.` };
  if (!m[3]) return { ok: true, value, unit: null };
  const unit = UNIT_WORDS[m[3].toLowerCase()];
  if (!unit) return { ok: false, reason: `The tester sent a unit ARC doesn't know (${m[3]}). Set it to lbF, N, kgF, ozF or kN.` };
  return { ok: true, value, unit };
}

/**
 * A Web Serial failure → a sentence the operator can act on, or null when
 * there's nothing to say (they closed the browser's port chooser).
 */
export function describeSerialError(err: unknown): string | null {
  const name = (err as { name?: string })?.name ?? "";
  const message = (err as { message?: string })?.message ?? String(err ?? "");
  if (name === "NotFoundError" || /no port selected/i.test(message)) return null;
  if (name === "SecurityError") {
    return "The browser blocked access to the tester. Use Chrome or Edge, and allow ARC to use serial ports.";
  }
  if (name === "InvalidStateError" || /already open/i.test(message)) {
    return "The tester's port is already open — in another ARC tab, or in Mark-10's own software. Close that and connect again.";
  }
  if (name === "NetworkError" || /failed to open|device has been lost|disconnected/i.test(message)) {
    return "ARC lost the tester. Check the USB cable, that nothing else is using the tester (MESUR, another tab), and connect again.";
  }
  return `ARC couldn't talk to the tester: ${message || "unknown error"}`;
}

/**
 * Split what has arrived so far into whole lines, keeping the unfinished tail.
 * The tester ends a line with CR LF; a lone CR or LF also ends one, so a port
 * that drops one half still works. Blank lines are dropped.
 */
export function takeLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split(/\r\n|\r|\n/);
  const rest = parts.pop() ?? "";
  return { lines: parts.map((p) => p.trim()).filter(Boolean), rest };
}
