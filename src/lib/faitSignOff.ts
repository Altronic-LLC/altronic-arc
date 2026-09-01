import type { Fait } from "@/types/task";

// =============================================================================
// The FAIT sign-off chain — SQE, then Engineering, then (if one is owed) the
// KAM.
//
// Three sign-off columns on one list can be filled in any order and nobody was
// told when it was their turn (Ray, 2026-08-28). This module owns the RULES of
// that chain — which transition happened, and what Status the FAIT should
// advance to — as pure functions, so the hook that writes the columns and the
// view that renders them can't disagree about them.
//
// `kamNeeded()` lived in FaitDetailView.tsx, where it hid the KAM fields on a
// FAIT that doesn't need a KAM. It's here now because the alert chain has to
// ask the same question: a rule enforced only in a view is a rule that isn't
// enforced. Its logic is unchanged.
//
// Nothing here sends anything or knows what an email looks like — the wording
// is in lib/faitAlerts.ts and the sending in api/email.ts.
// =============================================================================

/** The statuses the chain moves a FAIT between (subset of FAIT_STATUSES). */
export const FAIT_STATUS_WITH_SQE = "This is with SQE";
export const FAIT_STATUS_WITH_ENG = "This is with ENG";
export const FAIT_STATUS_WITH_KAM = "This is with KAM";
export const FAIT_STATUS_CLOSED = "Closed";

/** SharePoint column names for the three sign-offs. */
export const SQE_SIGN_OFF_COLUMN = "SQESignOff";
export const ENG_SIGN_OFF_COLUMN = "EngSignOff";
export const KAM_SIGN_OFF_COLUMN = "KAMSignOff";

/**
 * The sign-off values that mean something to the chain.
 *
 * `SQESignOff` offers Approved / Pending / Failed. **`EngSignOff` and
 * `KAMSignOff` offer only "Approved"** — there is no rejection value on
 * either column, so there is no reject path to build at those two stages. If
 * Engineering ever needs to send a FAIT back, the SharePoint column needs a
 * value for it first.
 */
export const SIGN_OFF_APPROVED = "Approved";
export const SIGN_OFF_FAILED = "Failed";

/**
 * Whether this FAIT needs a KAM sign-off at all. False only when there's
 * neither a KAM assigned nor any KAM sign-off data already on the record —
 * the detail page hides the KAM sign-off fields in that case, which is how
 * "this FAIT doesn't need a KAM" is expressed (Ray, 2026-08-27: "how to
 * hide/remove the KAM signoff when it is not required"). Checking the
 * existing data too, not just whether a KAM is assigned, means a FAIT
 * someone already signed off on before there was any way to assign a KAM
 * person never has its real sign-off hidden out from under it.
 *
 * It also gates the third link of the alert chain: with no KAM owed the
 * chain finishes at the engineer, and the FAIT must NOT be parked at "This
 * is with KAM" waiting on a signature nobody owes.
 */
export function kamNeeded(fait: Fait): boolean {
  return (
    fait.kam !== null ||
    !!fait.values.kamSignOff ||
    !!fait.values.kamInitials ||
    !!fait.values.kamApprovalNotes
  );
}

/** Stored choice values vary in case ("yes"/"Yes"), so compare loosely. */
function norm(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** One link of the chain that a write just moved. */
export type FaitSignOffStep =
  | { kind: "sqe-approved" }
  | { kind: "sqe-failed" }
  | { kind: "eng-approved"; kamOwed: boolean };

export interface FaitSignOffOutcome {
  /** Transitions this write makes — usually none, at most one per column. */
  steps: FaitSignOffStep[];
  /** Status the write should ALSO set, or null to leave Status alone. */
  nextStatus: string | null;
}

const NOTHING: FaitSignOffOutcome = { steps: [], nextStatus: null };

/**
 * What a pending write does to the sign-off chain.
 *
 * `prev` is the FAIT as it was BEFORE the write — pass the pre-optimistic
 * snapshot, not the patched cache entry, or every transition reads as
 * "unchanged".
 *
 * **`"SQESignOff" in fields` is PRESENCE, not change.** Saving the Sign-off
 * card re-sends whatever is in it, so the guard throughout is `to !== from`:
 * re-saving an already-approved FAIT must not re-ask the engineer.
 */
export function faitSignOffOutcome(
  prev: Fait,
  fields: Record<string, unknown>,
): FaitSignOffOutcome {
  const steps: FaitSignOffStep[] = [];
  let nextStatus: string | null = null;

  const sqe = changedTo(fields, SQE_SIGN_OFF_COLUMN, prev.values.sqeSignOff);
  if (sqe !== null) {
    if (norm(sqe) === norm(SIGN_OFF_APPROVED)) {
      steps.push({ kind: "sqe-approved" });
      nextStatus = FAIT_STATUS_WITH_ENG;
    } else if (norm(sqe) === norm(SIGN_OFF_FAILED)) {
      // ---------------------------------------------------------------------
      // ASSUMPTION, needs confirming (2026-08-31). The spec only described the
      // happy path, and "Failed" is a real SQESignOff choice. Taken to mean:
      // the FAIT goes BACK, not forward — the status does not advance, the
      // engineer is not asked for anything, and the initiator is told it came
      // back to them. Changing that decision is this one branch plus
      // buildFaitSqeFailedEmails; nothing else reads it.
      // ---------------------------------------------------------------------
      steps.push({ kind: "sqe-failed" });
    }
  }

  const eng = changedTo(fields, ENG_SIGN_OFF_COLUMN, prev.values.engSignOff);
  if (eng !== null && norm(eng) === norm(SIGN_OFF_APPROVED)) {
    const kamOwed = kamNeeded(prev);
    steps.push({ kind: "eng-approved", kamOwed });
    // A later link overrides an earlier one's advance: both columns can move
    // in one save of the Sign-off card, and ending at "This is with ENG" when
    // engineering has already signed would be a lie. With no KAM owed the
    // chain finishes here — the FAIT is ready to close and its status is left
    // where whoever is working it put it.
    nextStatus = kamOwed ? FAIT_STATUS_WITH_KAM : null;
  }

  if (steps.length === 0) return NOTHING;

  // An explicit Status in the same write WINS. The sidebar picker is a
  // separate control saving a separate write, but nothing stops the two
  // arriving together, and silently overruling a status somebody just chose
  // is worse than not advancing.
  if ("Status" in fields) return { steps, nextStatus: null };

  // Never reopen a closed FAIT by editing its sign-offs. Correcting an
  // initials typo on a FAIT that finished last month must not drag it back
  // into somebody's queue.
  if (norm(prev.status) === norm(FAIT_STATUS_CLOSED)) return { steps, nextStatus: null };

  return { steps, nextStatus };
}

/**
 * The new value of `column`, but only when the write actually MOVES it.
 * `null` when the column isn't in the write at all, or is being re-sent
 * unchanged.
 */
function changedTo(
  fields: Record<string, unknown>,
  column: string,
  previous: string | undefined,
): string | null {
  if (!(column in fields)) return null;
  const to = String(fields[column] ?? "");
  return norm(to) === norm(previous) ? null : to;
}
