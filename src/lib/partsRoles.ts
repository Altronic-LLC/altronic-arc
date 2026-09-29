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
//   editor              add + edit Part List parts; add HCO components
//                       (except 722)
//   hco editor          + edit HCO components, and add to 722 (the 2023
//                       guide limited both to Glenn Terry, Brandon Mirto and
//                       Sheila Horn — they now hold this tag)
//   reviewing engineer  + approve a component's Engineering Review step
//   sap admin           + approve the Pending SAP step; edits every field on
//                       both lists (Tim: "Sheila should be able to edit all
//                       fields"); told about new parts and every edit
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
  editor: "Editor",
  "hco editor": "HCO editor",
  "reviewing engineer": "Reviewing engineer",
  "sap admin": "SAP admin (Reviewing Admin)",
};

export const PARTS_ROLE_DESCRIPTIONS: Record<PartsRole, string> = {
  editor: "Adds and edits Part List parts, and adds HCO components (not 722).",
  "hco editor": "Also edits HCO components and adds to the 722 list. Includes Editor.",
  "reviewing engineer": "Approves new HCO components at the Engineering Review step. Includes HCO editor.",
  "sap admin": "Adds new parts to SAP and gives final approval; can edit every field. Emailed about every new part and every edit.",
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
    editParts: editor,
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

/** May this person add a part to this three-digit list? */
export function addPartGate(access: PartsAccess, prefix: string, component: boolean): PartsGate {
  if (component && prefix === "722") {
    return gate(access, (r) => r.addSil, `Only HCO editors can add to the 722 list. ${ASK}`);
  }
  return gate(
    access,
    (r) => (component ? r.addComponents : r.editParts),
    `Adding parts is limited to Engineering. ${ASK}`,
  );
}

/** May this person edit an existing part on this list? */
export function editPartGate(access: PartsAccess, component: boolean): PartsGate {
  if (component) {
    return gate(access, (r) => r.editComponents, `HCO components can only be edited by HCO editors. ${ASK}`);
  }
  return gate(access, (r) => r.editParts, `Editing parts is limited to Engineering. ${ASK}`);
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

/**
 * The history record an approval writes into Communication — the step, then
 * the approver's comment if any. The comment is escaped and kept as plain
 * paragraphs; the author and time come from the record itself.
 */
export function approvalRecordHtml(status: string | null, comment: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const paragraphs = comment
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  return `<p><strong>${approvalStepLabel(status)}.</strong></p>${paragraphs}`;
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
