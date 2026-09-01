import type { MaintenanceRole, MaintenanceTask } from "@/types/task";

// =============================================================================
// Maintenance role → rights mapping, and the four CMMS gates.
//
// Kept pure and in `lib/` for the same reason `lib/panelRoles.ts` is: the rule
// is the thing worth testing, and a rule expressed as a ternary at each call
// site is a rule that drifts. Every gated control in the CMMS and every gated
// `mutationFn` asks these functions, so the greyed button and the refusal it
// would have hit cannot disagree.
//
// TWO levels, and `admin` outranks `tech` — an admin IS a tech, and
// `maintenanceAccessFrom` sets `isTech` for them accordingly, because the
// SharePoint `Roles` column is a choice column that may hold only one value:
//
//   | Action                                          | Who              |
//   |-------------------------------------------------|------------------|
//   | Raise a work order, edit an open one, comment    | anyone signed in |
//   | Complete a work order                           | tech or admin    |
//   | Log a PM (Start / Complete / Skip)              | tech or admin    |
//   | Create / edit / retire a PM schedule            | admin            |
//   | Manage assets, departments, locations           | admin            |
//
// **The tech tag REPLACED an assignee check.** Until this landed, completing a
// work order required being its assignee (or an ARC admin) — so any tech who
// picked up somebody else's job was refused, and accountability was being
// bought by blocking the wrong people. It comes from `CompletedBy` being
// stamped instead. The one behaviour kept from that rule: completing an
// UNASSIGNED work order assigns it to the completer in the same write, because
// that is what gives the row an owner in every report that reads it.
//
// Two rules that are lockout safety, not politeness:
//
//   * **`enforced: false` allows everything.** An unconfigured Maintenance
//     Roles list means "everyone keeps what they can do today", never "nobody
//     can do anything". That flag is the whole point of the pattern.
//   * **`isResolving` is neither yes nor no.** The roles list loads
//     asynchronously, so a real tech reads as untagged for a beat on first
//     paint. A gate reports `resolving` separately and callers show a neutral
//     "checking…" rather than a denial they are about to take back.
// =============================================================================

/** What the signed-in user may do, as the gates below need to see it. */
export interface MaintenanceAccess {
  /**
   * May do a tech's work. **True for an admin too** — `admin` implies `tech`.
   *
   * Not merely convenient: the SharePoint `Roles` column is a CHOICE column,
   * and if it turns out to be SINGLE-value a person can hold exactly one tag.
   * An admin who could create PM schedules but not close a work order out
   * would be absurd, so the implication is applied whatever the column's shape
   * turns out to be. It does NOT run the other way: a tech is not an admin.
   */
  isTech: boolean;
  /**
   * Holds the `admin` tag, OR is an ARC admin (the global Admins list). An
   * admin can do everything a tech can — the gates check `isTech || isAdmin`,
   * they never require the literal tech tag.
   */
  isAdmin: boolean;
  /**
   * Whether gating applies at all. False when the Maintenance Roles list
   * isn't configured in real mode, in which case every gate allows.
   */
  enforced: boolean;
  /** True while the roles list is still loading and the answer is unknown. */
  isResolving: boolean;
}

/** One gate's answer: may they, are we still finding out, and why in words. */
export interface MaintenanceGate {
  allowed: boolean;
  /**
   * True when the answer isn't known yet. `allowed` is false in that case, so
   * a control can be disabled — but the hint is neutral, and a caller must not
   * render a "you don't have access" explanation while this is true.
   */
  resolving: boolean;
  /** Why — in words, in every case including the allowed ones. */
  hint: string;
}

/**
 * Collapse a row's role tags (plus ARC admin standing) into an access record.
 *
 * Two implications live here rather than at the gates:
 *
 *   * **An ARC admin is a maintenance admin.** A roles list nobody holds
 *     `admin` on would otherwise be a door locked from the inside.
 *   * **An admin is a tech.** See the note on `isTech` — the `Roles` column is
 *     a choice column that may only hold one value per person.
 */
export function maintenanceAccessFrom({
  roles = [],
  arcAdmin = false,
  enforced,
  isResolving = false,
}: {
  roles?: readonly MaintenanceRole[];
  arcAdmin?: boolean;
  enforced: boolean;
  isResolving?: boolean;
}): MaintenanceAccess {
  const isAdmin = arcAdmin || roles.includes("admin");
  return {
    // `|| isAdmin` — admin outranks tech, and under a single-value choice
    // column nobody can hold both tags.
    isTech: roles.includes("tech") || isAdmin,
    isAdmin,
    enforced,
    // An ARC admin can do everything regardless of the list, so there is
    // nothing left to wait for — reporting "resolving" for them would disable
    // controls they are certainly allowed to use.
    isResolving: !arcAdmin && isResolving,
  };
}

const ASK_FOR_TECH =
  "Ask an ARC admin to add you to the Maintenance Roles list with the Tech role " +
  "(Admin → Maintenance Roles).";

const ASK_FOR_ADMIN =
  "Ask an ARC admin to give you the Admin role on the Maintenance Roles list " +
  "(Admin → Maintenance Roles).";

const CHECKING = "Checking your maintenance permissions…";

/** Allowed, with the reason stated — the shape every gate returns on success. */
function allow(hint: string): MaintenanceGate {
  return { allowed: true, resolving: false, hint };
}

/**
 * The three not-allowed answers, in one place so no gate forgets one:
 * unenforced (allow), still resolving (neutral), or a genuine refusal.
 */
function decide(
  access: MaintenanceAccess,
  held: boolean,
  { unenforcedHint, allowedHint, refusal }: {
    unenforcedHint: string;
    allowedHint: string;
    refusal: string;
  },
): MaintenanceGate {
  if (!access.enforced) return allow(unenforcedHint);
  if (held) return allow(allowedHint);
  if (access.isResolving) return { allowed: false, resolving: true, hint: CHECKING };
  return { allowed: false, resolving: false, hint: refusal };
}

/**
 * Tech or admin.
 *
 * `isTech` already covers an admin (see `maintenanceAccessFrom`), so the
 * second half is redundant today. It stays because it states the RULE, and
 * because a caller may hand in an access record it built itself.
 */
function isTechOrAdmin(access: MaintenanceAccess): boolean {
  return access.isTech || access.isAdmin;
}

/** May they close a work order out? (Tech or admin.) */
export function completeWorkOrderGate(access: MaintenanceAccess): MaintenanceGate {
  return decide(access, isTechOrAdmin(access), {
    unenforcedHint:
      "Maintenance roles aren't set up yet, so anyone signed in can close a work order out.",
    allowedHint: "You can close this work order out; your name is recorded as who completed it.",
    refusal: `Closing a work order out is limited to maintenance techs. ${ASK_FOR_TECH}`,
  });
}

/** May they log a PM occurrence — Start / Complete / Skip? (Tech or admin.) */
export function logPmGate(access: MaintenanceAccess): MaintenanceGate {
  return decide(access, isTechOrAdmin(access), {
    unenforcedHint: "Maintenance roles aren't set up yet, so anyone signed in can log a PM.",
    allowedHint: "Logging this creates the work order and records it against the schedule.",
    refusal:
      `Logging a PM creates a work order against the schedule, which is limited to ` +
      `maintenance techs. ${ASK_FOR_TECH}`,
  });
}

/** May they create, edit or retire a PM schedule? (Admin only.) */
export function manageSchedulesGate(access: MaintenanceAccess): MaintenanceGate {
  return decide(access, access.isAdmin, {
    unenforcedHint:
      "Maintenance roles aren't set up yet, so anyone signed in can manage PM schedules.",
    allowedHint: "You can create, edit and retire PM schedules.",
    refusal:
      `Creating and editing PM schedules is limited to maintenance admins — a schedule ` +
      `drives what the whole shop is told is due. ${ASK_FOR_ADMIN}`,
  });
}

/**
 * May they manage the asset register, departments and locations? (Admin only.)
 *
 * Nothing calls this yet — the asset/department/location admin screen doesn't
 * exist. It is here so that screen asks the same question the rest of the CMMS
 * asks, through `useMyMaintenanceRoles`, rather than inventing a rule of its
 * own when it is built.
 */
export function manageAssetsGate(access: MaintenanceAccess): MaintenanceGate {
  return decide(access, access.isAdmin, {
    unenforcedHint:
      "Maintenance roles aren't set up yet, so anyone signed in can manage the asset register.",
    allowedHint: "You can manage the asset register, departments and locations.",
    refusal:
      `Managing the asset register is limited to maintenance admins — every work order and ` +
      `PM schedule points at it. ${ASK_FOR_ADMIN}`,
  });
}

/** `completeWorkOrderGate`, plus what completing THIS work order will do. */
export interface MaintenanceCompletionAccess extends MaintenanceGate {
  /** True for the unassigned case, where completing also claims the job. */
  claimsOnComplete: boolean;
}

/**
 * Who may close THIS work order out, and what happens when they do.
 *
 * The role half is `completeWorkOrderGate`. The task-specific half is the
 * unassigned case: completing an unassigned work order ALSO assigns it to the
 * completer, in the same write, and somebody who didn't expect that has
 * silently put their name on a job — so the hint says so even though the
 * answer is yes.
 *
 * Deliberately pure and synchronous. The mutation re-reads the item before
 * writing anyway (see `completionFields` in hooks/useMaintenanceTasks.ts);
 * this is the display answer, and that is the authority.
 */
export function maintenanceCompletionAccess(
  task: MaintenanceTask,
  access: MaintenanceAccess,
): MaintenanceCompletionAccess {
  const gate = completeWorkOrderGate(access);
  if (!gate.allowed) return { ...gate, claimsOnComplete: false };

  if (!task.assigned) {
    return {
      ...gate,
      hint:
        "Nobody is assigned to this work order yet — completing it assigns it to you, so the " +
        "record shows who did the job.",
      claimsOnComplete: true,
    };
  }

  const assigneeName = task.assigned.displayName || "somebody else";
  return {
    ...gate,
    hint:
      `Assigned to ${assigneeName}. Any maintenance tech can close a work order out — you will ` +
      `be recorded as who completed it.`,
    claimsOnComplete: false,
  };
}
