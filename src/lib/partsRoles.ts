import {
  COMPONENT_SIGN_OFF_STATUSES,
  PART_SIGN_OFF_STATUSES,
  PARTS_ROLE_TAGS,
  type PartsRole,
} from "@/types/task";

export { PARTS_ROLE_TAGS, type PartsRole };

// =============================================================================
// Who may do what on the Altronic Parts List — the ONE place the rules live.
//
// Every greyed-out button and every gated mutationFn asks the same gate, so a
// disabled control and the write behind it can't disagree (the CMMS roles'
// arrangement). Tags come from the admin-managed Parts Roles list (Tim,
// 2026-09-28), so who holds them changes on the list, not in code.
//
//   editor              ADD Part List parts on existing lists, and HCO
//                       components (except 722). No editing: they suggest a
//                       correction instead (suggestCorrectionGate)
//   hco editor          + EDIT existing parts on BOTH lists, and add to 722
//                       (shown as "Parts editor")
//   reviewing engineer  + approve a component's Engineering Review step
//   sap admin           + approve the Pending SAP step; start a new parts list;
//                       edits every field on
//                       both lists (Tim: "Sheila should be able to edit all
//                       fields"); told about new parts and every edit
//
// ADDING and EDITING are separate rights (Tim, with Brandon and Glenn,
// 2026-09-29). An editor who spots a typo on an existing part sends it to the
// reviewing engineers and the SAP admin rather than changing it. The stored
// tag is still "hco editor", so rows already saved keep their rights.
//
// IMPLICATIONS, so nobody needs four ticks: a reviewing engineer corrects what
// they review, so they hold hco editor; an hco editor is an engineer, so they
// hold editor; a sap admin holds every edit right. APPROVAL rights do NOT
// imply each other — the SAP admin's step is not an engineering review.
//
// NOT CONFIGURED means OFF. Unlike EIR Roles, whose gating falls open so
// nobody loses an edit they had, nobody could edit parts in ARC before this
// existed — so an unset Parts Roles list leaves the Parts List read-only
// rather than handing every signed-in user the keys.
//
// UI-level only, as everywhere in ARC: SharePoint's list permissions are the
// real boundary.
// =============================================================================

export const PARTS_ROLE_LABELS: Record<PartsRole, string> = {
  editor: "Add",
  "hco editor": "Parts editor (incl. HCO)",
  "reviewing engineer": "Reviewing engineer",
  "sap admin": "SAP admin (Reviewing Admin)",
};

export const PARTS_ROLE_DESCRIPTIONS: Record<PartsRole, string> = {
  editor:
    "Adds Part List parts on existing lists and HCO components (not 722). Can't edit existing parts — suggests corrections to the reviewers and the SAP admin instead.",
  "hco editor": "Also edits existing parts on both lists and adds to the 722 list. Includes Add.",
  "reviewing engineer": "Approves new HCO components at the Engineering Review step. Includes Parts editor.",
  "sap admin": "Adds new parts to SAP and gives final approval; starts new parts lists; can edit every field. Emailed about every new part and every edit.",
};

/**
 * Old spellings of a tag, read as the current one. The HCO tag was first
 * written "hoc editor" (a typo for HCO), and rows saved then still hold it;
 * the next save through the admin screen rewrites it with the right name.
 */
const LEGACY_TAGS: Record<string, PartsRole> = { "hoc editor": "hco editor" };

/** Parse a stored Roles value — a lowercase CSV — keeping only known tags. */
export function parsePartsRoles(raw: unknown): PartsRole[] {
  if (typeof raw !== "string") return [];
  const known = new Set<string>(PARTS_ROLE_TAGS);
  const out: PartsRole[] = [];
  for (const piece of raw.split(",")) {
    const lower = piece.trim().toLowerCase();
    const tag = LEGACY_TAGS[lower] ?? lower;
    if (known.has(tag) && !out.includes(tag as PartsRole)) out.push(tag as PartsRole);
  }
  return PARTS_ROLE_TAGS.filter((t) => out.includes(t));
}

/** Tags → the stored CSV, in a stable order. */
export function serializePartsRoles(roles: readonly PartsRole[]): string {
  return PARTS_ROLE_TAGS.filter((t) => roles.includes(t)).join(", ");
}

export interface PartsRights {
  /** Add a Part List part to an existing list. */
  addParts: boolean;
  /** Edit an existing Part List part. */
  editParts: boolean;
  addComponents: boolean;
  editComponents: boolean;
  /** Add to 722. */
  addSil: boolean;
  approveEngineering: boolean;
  approveSap: boolean;
}

/** What a set of tags lets someone do, implications applied. */
export function partsRightsFor(tags: Iterable<PartsRole>): PartsRights {
  const t = new Set(tags);
  const sap = t.has("sap admin");
  const reviewer = t.has("reviewing engineer");
  const hco = t.has("hco editor") || reviewer || sap;
  const editor = t.has("editor") || hco;
  return {
    addParts: editor,
    editParts: hco,
    addComponents: editor,
    editComponents: hco,
    addSil: hco,
    approveEngineering: reviewer,
    approveSap: sap,
  };
}

export interface PartsAccess {
  /** The signed-in user's tags. */
  roles: readonly PartsRole[];
  /** Is a Parts Roles list configured at all? Off = read-only for everyone. */
  configured: boolean;
  /** The roles list is still loading — neither yes nor no. */
  resolving: boolean;
  /** The roles list couldn't be read — refuse, and say why. */
  failed: boolean;
}

export interface PartsGate {
  allowed: boolean;
  resolving: boolean;
  /** Why not — shown beside the greyed control. Empty when allowed. */
  hint: string;
}

const NOT_CONFIGURED =
  "Editing parts in ARC isn't set up yet — an ARC admin needs to configure the Parts Roles list.";
const CHECKING = "Checking your Parts List roles…";
const FAILED = "Couldn't check your Parts List roles — reload and try again.";

function gate(access: PartsAccess, allowed: (r: PartsRights) => boolean, deniedHint: string): PartsGate {
  if (!access.configured) return { allowed: false, resolving: false, hint: NOT_CONFIGURED };
  if (access.resolving) return { allowed: false, resolving: true, hint: CHECKING };
  if (access.failed) return { allowed: false, resolving: false, hint: FAILED };
  const ok = allowed(partsRightsFor(access.roles));
  return { allowed: ok, resolving: false, hint: ok ? "" : deniedHint };
}

const ASK = "Ask an ARC admin to add you on Admin → Parts Roles.";

/**
 * May this person add a part to this three-digit list? `opensNewList` — no
 * part has that prefix yet — is the SAP admin's alone (Tim, 2026-09-29): a
 * new list is a new SAP numbering range, so an engineer asks for one rather
 * than starting it. The HCO lists are fixed, so a component never opens one.
 */
export function addPartGate(
  access: PartsAccess,
  prefix: string,
  component: boolean,
  opensNewList = false,
): PartsGate {
  if (component && prefix === "722") {
    return gate(access, (r) => r.addSil, `Only parts editors can add to the 722 list. ${ASK}`);
  }
  if (!component && opensNewList) {
    return gate(
      access,
      (r) => r.approveSap,
      `There's no list ${prefix} yet, and only the SAP admin can start a new list. Ask the SAP admin to open it.`,
    );
  }
  return gate(
    access,
    (r) => (component ? r.addComponents : r.addParts),
    `Adding parts is limited to Engineering. ${ASK}`,
  );
}

/**
 * May this person edit an existing part on this list? Parts editors and up,
 * on both lists — adding a part doesn't let you edit one (Tim, 2026-09-29).
 */
export function editPartGate(access: PartsAccess, component: boolean): PartsGate {
  // Somebody who can add is pointed at the way they CAN help, not at an admin.
  const mine = partsRightsFor(access.roles);
  const denied =
    mine.addParts || mine.addComponents
      ? "Existing parts can only be edited by parts editors. Use Suggest a correction to send a fix to the reviewing engineers and the SAP admin."
      : `Existing parts can only be edited by parts editors. ${ASK}`;
  return gate(access, (r) => (component ? r.editComponents : r.editParts), denied);
}

/**
 * May this person upload a MISSING datasheet from a part's page? Anyone who
 * can edit the part, or add parts to its list (Tim, 2026-09-29): an upload
 * never replaces a file (api/datasheets.ts), so adding one that isn't there
 * changes nothing anyone relied on — and it's how the Add role retries an
 * upload that failed when they added the part. The 722 list stays with parts
 * editors, as adding to it does.
 */
export function addDatasheetGate(access: PartsAccess, prefix: string, component: boolean): PartsGate {
  const edit = editPartGate(access, component);
  if (edit.allowed || edit.resolving) return edit;
  // Refused: the add gate's reason is the specific one (722, or no role).
  return addPartGate(access, prefix, component);
}

/**
 * May this person send a correction for a part they can't edit — a typo, a
 * wrong rating — to the reviewing engineers and the SAP admin? Anyone who can
 * ADD parts but not edit this one (Tim, 2026-09-29). Somebody who can edit
 * just fixes it, and somebody with no role isn't Engineering.
 */
export function suggestCorrectionGate(access: PartsAccess, component: boolean): PartsGate {
  return gate(
    access,
    (r) => (r.addParts || r.addComponents) && !(component ? r.editComponents : r.editParts),
    `Only Engineering can suggest corrections. ${ASK}`,
  );
}

/**
 * May this person delete a part number? The SAP admin only (Tim, 2026-09-28)
 * — on both lists. A deleted number is handed out again for a new part, so a
 * delete changes what the number means to every drawing, BOM and SAP record
 * that points at it; that is the SAP side's call.
 */
export function deletePartGate(access: PartsAccess): PartsGate {
  return gate(access, (r) => r.approveSap, `Only the SAP admin can delete a part number. ${ASK}`);
}

/**
 * May this person change the Description / Type / SIL category dropdowns a
 * new component is described with? The SAP admin and the reviewing engineers
 * (Tim, 2026-09-28) — the people who approve components, so the people who
 * see a missing option first.
 */
export function manageDescriptionOptionsGate(access: PartsAccess): PartsGate {
  return gate(
    access,
    (r) => r.approveSap || r.approveEngineering,
    `Only the SAP admin and the reviewing engineers can change the description lists. ${ASK}`,
  );
}

// -----------------------------------------------------------------------------
// The approval chain
// -----------------------------------------------------------------------------

/** Where a NEW part starts. */
export function initialSignOff(component: boolean): string {
  return component ? COMPONENT_SIGN_OFF_STATUSES[0] : PART_SIGN_OFF_STATUSES[0];
}

/**
 * The status an approval moves a part to, or null when there is nothing to
 * approve — Approved, or blank (a part loaded from the old app, which never
 * went through this chain and must not be dragged into it).
 */
export function nextSignOff(status: string | null): string | null {
  if (status === "Pending Engineering Review") return "Pending SAP";
  if (status === "Pending SAP") return "Approved";
  return null;
}

/** What the approval of a step is called in the history and emails. */
export function approvalStepLabel(status: string | null): string {
  if (status === "Pending Engineering Review") return "Engineering review approved";
  if (status === "Pending SAP") return "Added to SAP — approved";
  return "Approved";
}

// -----------------------------------------------------------------------------
// The SAP step's three answers (Tim, 2026-09-29) — the old Power Automate
// approval's three buttons. EVERY one approves the part; they differ only in
// what the history says and what the engineer who added it is told.
// -----------------------------------------------------------------------------

export const SAP_RESPONSES = ["added", "not-needed", "more-info"] as const;
export type SapResponse = (typeof SAP_RESPONSES)[number];

export const SAP_RESPONSE_LABELS: Record<SapResponse, string> = {
  added: "Added to SAP",
  "not-needed": "Does not need to be added to SAP",
  "more-info": "Will be added to SAP but requires more information",
};

/** Read a response off a URL (`?sap=added`); anything else is no response. */
export function parseSapResponse(raw: string | null | undefined): SapResponse | null {
  return (SAP_RESPONSES as readonly string[]).includes(raw ?? "") ? (raw as SapResponse) : null;
}

/**
 * "More information" is the one answer that means nothing without saying WHAT
 * is needed — the engineer can't act on it otherwise — so it needs a comment.
 */
export function sapResponseNeedsComment(response: SapResponse | null): boolean {
  return response === "more-info";
}

/**
 * The history record an approval writes into Communication — the step (or,
 * at the SAP step, the answer given), then the approver's comment if any. The
 * comment is escaped and kept as plain paragraphs; the author and time come
 * from the record itself.
 */
export function approvalRecordHtml(status: string | null, comment: string, response: SapResponse | null = null): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const paragraphs = comment
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const step =
    status === "Pending SAP" && response ? `${SAP_RESPONSE_LABELS[response]} — approved` : approvalStepLabel(status);
  return `<p><strong>${step}.</strong></p>${paragraphs}`;
}

/** May this person approve the step this part is waiting on? */
export function approveGate(access: PartsAccess, status: string | null): PartsGate {
  if (status === "Pending Engineering Review") {
    return gate(access, (r) => r.approveEngineering, "Waiting on a reviewing engineer.");
  }
  if (status === "Pending SAP") {
    return gate(access, (r) => r.approveSap, "Waiting on the SAP admin to add it to SAP.");
  }
  return { allowed: false, resolving: false, hint: "" };
}
