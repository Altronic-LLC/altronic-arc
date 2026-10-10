import {
  QUOTE_OUTCOME_STATUSES,
  QUOTE_ROLES,
  type QuoteRole,
  type QuoteStatus,
} from "@/types/quote";

// =============================================================================
// Who may do what on Insourcing Quotes — the ONE place the rules live.
//
// Every greyed control and every gated `mutationFn` asks these gates, so a
// disabled button and the write behind it can't disagree (the Parts Roles /
// CMMS arrangement). Tags come from the Quote Roles list, so who holds them
// changes on the list, not in code.
//
//   | Right                                          | viewer | quoter | manager |
//   |------------------------------------------------|--------|--------|---------|
//   | See quotes and sell prices, comment, attach    | yes    | yes    | yes     |
//   | See cost / margin / target GM / overhead       | —      | yes    | yes     |
//   | Edit, create (quotes, assemblies, items, revs) | —      | yes    | yes     |
//   | Generate the PDF                               | —      | yes    | yes     |
//   | Set Won / Lost / Expired                       | —      | —      | yes     |
//   | Create and edit customers                      | —      | —      | yes     |
//   | Manage the roles list                          | —      | —      | yes     |
//
// Each tag IMPLIES the ones below it (manager ⊃ quoter ⊃ viewer), so nobody
// needs three ticks, and a single-value Roles cell still works.
//
// Two rules that are deliberate, not oversights:
//
//   * **NO ROLE = NO ACCESS** — the opposite of EIR Roles' fall-open. Nobody
//     could quote in ARC before this existed, so falling closed takes nothing
//     away, while falling open would show every signed-in user cost and margin.
//   * **An ARC admin gets ONLY `canManageRoles`.** Quote cost and margin are
//     commercially sensitive, and being an ARC admin is not a reason to see
//     them. But the admin CAN manage the roles list, so a list nobody holds
//     `manager` on is never a door locked from the inside.
//
// Hiding cost from a viewer is UI-ONLY: Graph still returns those columns and
// the bundle is public. SharePoint list permissions are the real boundary.
// =============================================================================

/** Parse a stored Roles value — CSV, array, single string or nothing. */
export function parseQuoteRoles(raw: unknown): QuoteRole[] {
  // The column is text today, but tolerate an array (a choice column) and a
  // bare string, so a column-type change in SharePoint can't silently strip
  // everybody's access. Same answer `parseRoles` gives on the CMMS list.
  const pieces: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,;]/)
      : [];
  const found = new Set<string>();
  for (const piece of pieces) {
    if (typeof piece !== "string") continue;
    found.add(piece.trim().toLowerCase());
  }
  // Canonical order, unknown tags dropped, duplicates gone.
  return QUOTE_ROLES.filter((r) => found.has(r));
}

/** Lowercase CSV in canonical order — what's written to the `Roles` column. */
export function serializeQuoteRoles(roles: readonly QuoteRole[]): string {
  return QUOTE_ROLES.filter((r) => roles.includes(r)).join(",");
}

export interface QuoteRights {
  canAccess: boolean;
  canSeeCost: boolean;
  canEdit: boolean;
  canCreate: boolean;
  canGeneratePdf: boolean;
  canSetOutcome: boolean;
  canManageCustomers: boolean;
  canManageRoles: boolean;
}

/** Collapse role tags (plus ARC admin standing) into rights. */
export function quoteRightsFrom(
  roles: readonly QuoteRole[],
  opts: { isArcAdmin: boolean },
): QuoteRights {
  const manager = roles.includes("manager");
  const quoter = manager || roles.includes("quoter");
  const viewer = quoter || roles.includes("viewer");
  return {
    canAccess: viewer,
    canSeeCost: quoter,
    canEdit: quoter,
    canCreate: quoter,
    canGeneratePdf: quoter,
    canSetOutcome: manager,
    canManageCustomers: manager,
    // The ONLY thing an ARC admin is given — see the header.
    canManageRoles: manager || opts.isArcAdmin,
  };
}

/** The signed-in user's rights, plus whether the roles list has answered. */
export interface QuoteAccess {
  rights: QuoteRights;
  /** The roles list is still loading — the answer is unknown, not "no". */
  resolving: boolean;
  /** The roles list couldn't be read — refuse, but say it's a fault. */
  failed: boolean;
}

/** One gate's answer: may they, are we still finding out, and why in words. */
export interface QuoteGate {
  allowed: boolean;
  /**
   * True when the answer isn't known yet. `allowed` is false then, but the
   * hint is neutral — a caller must not show a denial it is about to withdraw.
   */
  resolving: boolean;
  hint: string;
}

const CHECKING = "Checking your access…";
const FAILED = "Couldn't check your quote role — try again.";
const ASK = "Ask a quote manager to add you on the Quote Roles list.";

/**
 * Resolving and failed are checked BEFORE the right, in that order: a right
 * read while the list is loading is the empty default, and a failed read must
 * refuse (granting on error would make the gate advisory).
 */
function decide(
  access: QuoteAccess,
  held: (r: QuoteRights) => boolean,
  allowedHint: string,
  refusal: string,
): QuoteGate {
  if (access.resolving) return { allowed: false, resolving: true, hint: CHECKING };
  if (access.failed) return { allowed: false, resolving: false, hint: FAILED };
  if (held(access.rights)) return { allowed: true, resolving: false, hint: allowedHint };
  return { allowed: false, resolving: false, hint: refusal };
}

/** May they open Insourcing Quotes at all? (Any quote role.) */
export function accessQuotesGate(access: QuoteAccess): QuoteGate {
  return decide(
    access,
    (r) => r.canAccess,
    "You can view quotes.",
    `Insourcing Quotes is limited to people with a quote role. ${ASK}`,
  );
}

/** May they see cost, margin, target GM and overhead? (Quoter or manager.) */
export function seeCostGate(access: QuoteAccess): QuoteGate {
  return decide(
    access,
    (r) => r.canSeeCost,
    "You can see cost and margin.",
    "Only quoters and quote managers can see cost and margin.",
  );
}

/** May they edit a quote, its assemblies and components? */
export function editQuoteGate(access: QuoteAccess): QuoteGate {
  return decide(
    access,
    (r) => r.canEdit,
    "You can edit this quote.",
    "Only quoters and quote managers can edit quotes.",
  );
}

/** May they create a quote, an assembly, a component or a new rev? */
export function createQuoteGate(access: QuoteAccess): QuoteGate {
  return decide(
    access,
    (r) => r.canCreate,
    "You can create quotes.",
    "Only quoters and quote managers can create quotes.",
  );
}

/** May they generate the customer PDF? */
export function generatePdfGate(access: QuoteAccess): QuoteGate {
  return decide(
    access,
    (r) => r.canGeneratePdf,
    "You can generate the customer quote.",
    "Only quoters and quote managers can generate the customer quote.",
  );
}

/** May they create and edit Quote Customers? (Manager only.) */
export function manageCustomersGate(access: QuoteAccess): QuoteGate {
  return decide(
    access,
    (r) => r.canManageCustomers,
    "You can add and edit customers.",
    "Only a quote manager can add customers.",
  );
}

/** May they manage the Quote Roles list? (Manager, or an ARC admin.) */
export function manageRolesGate(access: QuoteAccess): QuoteGate {
  return decide(
    access,
    (r) => r.canManageRoles,
    "You can manage quote roles.",
    "Only a quote manager or an ARC admin can manage quote roles.",
  );
}

const isOutcome = (s: QuoteStatus) => QUOTE_OUTCOME_STATUSES.includes(s);

/**
 * May they move a quote from `from` to `to`?
 *
 * A quoter moves a quote between Draft and Sent. Only a manager may set an
 * outcome (Won / Lost / Expired) — or LEAVE one: reopening a Won quote to
 * Draft is as much an outcome decision as setting it, and a quoter undoing a
 * manager's Lost would otherwise be one click.
 */
export function setQuoteStatusGate(
  access: QuoteAccess,
  from: QuoteStatus,
  to: QuoteStatus,
): QuoteGate {
  if (isOutcome(from) || isOutcome(to)) {
    const refusal = isOutcome(to)
      ? `Only a quote manager can mark a quote ${to}.`
      : `Only a quote manager can reopen a quote marked ${from}.`;
    return decide(access, (r) => r.canSetOutcome, "You can set this status.", refusal);
  }
  return decide(
    access,
    (r) => r.canEdit,
    "You can set this status.",
    "Only quoters and quote managers can change a quote's status.",
  );
}
