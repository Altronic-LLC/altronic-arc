import { PRICING_ROLES, type PricingRequestStatus, type PricingRole } from "@/types/pricing";

// =============================================================================
// Who may do what in Sales Pricing — the ONE place the rules live. Every
// greyed control and every gated `mutationFn` asks these gates, so a disabled
// button and the write behind it can't disagree (the Quote Roles arrangement).
//
//   | Right                                              | requester | manager | admin |
//   |----------------------------------------------------|-----------|---------|-------|
//   | See requests and final prices, raise, comment      | yes       | yes     | yes   |
//   | See cost, margin, comparables and price history    | —         | yes     | yes   |
//   | Price, re-price; New Product Pricing worksheets    | —         | yes     | yes   |
//   | Added to SAP                                       | —         | —       | yes   |
//   | Manage the Pricing Roles list                      | —         | —       | yes   |
//
// Each tag implies the ones before it (admin ⊃ manager ⊃ requester).
//
// `new products` stands ALONE (Ray, 2026-10-22): it opens New Product Pricing
// — see and work worksheets — and NOTHING else in Pricing: no requests, no
// customer quotes, no calculator, no roles. Managers and admins have New
// Products already. `canOpen` is "may open the Pricing tool at all" (the
// Dashboard card and the menu); `canAccess` stays the REQUEST side.
//
//   * **NO ROLE = NO ACCESS** (Ray, 2026-10-13: both roles live on the list,
//     and anyone not on it gets nothing) — the Quote Roles rule.
//   * **An ARC admin gets ONLY `canManageRoles`**, so a list nobody holds
//     `admin` on is never locked from the inside. Being an ARC admin is not a
//     reason to see cost.
//   * **The PREVIEW list wins over everything** while the tool is in review:
//     somebody not on it has no access whatever their role (see `previewAllows`).
//
// Hiding cost from a requester is NOT only UI here: cost lives on lists a
// requester has no SharePoint permission to read. ARC's gating decides what
// is offered; SharePoint decides what can be read.
// =============================================================================

/** Parse a stored Roles value — CSV, array, single string or nothing. */
export function parsePricingRoles(raw: unknown): PricingRole[] {
  const pieces: unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;]/) : [];
  const found = new Set<string>();
  for (const piece of pieces) if (typeof piece === "string") found.add(piece.trim().toLowerCase());
  return PRICING_ROLES.filter((r) => found.has(r));
}

/** Lowercase CSV in canonical order — what's written to the `Roles` column. */
export function serializePricingRoles(roles: readonly PricingRole[]): string {
  return PRICING_ROLES.filter((r) => roles.includes(r)).join(",");
}

export interface PricingRights {
  /** May open the Pricing tool at all — any role, `new products` included. */
  canOpen: boolean;
  /** The request side: raise and see requests, comment, the calculator. */
  canAccess: boolean;
  /** See and work New Product Pricing worksheets. */
  canNewProducts: boolean;
  canSeeCost: boolean;
  canPrice: boolean;
  canAddToSap: boolean;
  canManageRoles: boolean;
}

export const NO_PRICING_RIGHTS: PricingRights = {
  canOpen: false,
  canAccess: false,
  canNewProducts: false,
  canSeeCost: false,
  canPrice: false,
  canAddToSap: false,
  canManageRoles: false,
};

/** Collapse role tags (plus ARC admin standing) into rights. */
export function pricingRightsFrom(roles: readonly PricingRole[], opts: { isArcAdmin: boolean }): PricingRights {
  const admin = roles.includes("admin");
  const manager = admin || roles.includes("manager");
  const requester = manager || roles.includes("requester");
  const newProducts = manager || roles.includes("new products");
  return {
    canOpen: requester || newProducts,
    canAccess: requester,
    canNewProducts: newProducts,
    canSeeCost: manager,
    canPrice: manager,
    canAddToSap: admin,
    canManageRoles: admin || opts.isArcAdmin,
  };
}

/**
 * The review gate: while the tool is not live, only the preview list is let
 * in, whatever the roles list says. `live` true (or an empty list, which
 * would lock everybody out) lets the roles decide.
 */
export function previewAllows(args: { live: boolean; previewEmails: readonly string[]; myEmails: readonly string[] }): boolean {
  if (args.live || args.previewEmails.length === 0) return true;
  const mine = new Set(args.myEmails.map((e) => e.trim().toLowerCase()));
  return args.previewEmails.some((e) => mine.has(e.trim().toLowerCase()));
}

/** The signed-in user's rights, plus whether the roles list has answered. */
export interface PricingAccess {
  rights: PricingRights;
  resolving: boolean;
  failed: boolean;
}

export interface PricingGate {
  allowed: boolean;
  /** Unknown yet — `allowed` is false, but the hint must be neutral. */
  resolving: boolean;
  hint: string;
}

const CHECKING = "Checking your access…";
const FAILED = "Couldn't check your pricing role — try again.";

function decide(access: PricingAccess, held: (r: PricingRights) => boolean, allowedHint: string, refusal: string): PricingGate {
  if (access.resolving) return { allowed: false, resolving: true, hint: CHECKING };
  if (access.failed) return { allowed: false, resolving: false, hint: FAILED };
  if (held(access.rights)) return { allowed: true, resolving: false, hint: allowedHint };
  return { allowed: false, resolving: false, hint: refusal };
}

/** May they open Sales Pricing, raise a request and comment? (Any role.) */
export function accessPricingGate(access: PricingAccess): PricingGate {
  return decide(
    access,
    (r) => r.canAccess,
    "You can raise pricing requests.",
    "Pricing is limited to people with a pricing role. Ask a pricing admin to add you on the Pricing Roles list.",
  );
}

/** May they see cost, margin, comparables and the price history? */
export function seePricingCostGate(access: PricingAccess): PricingGate {
  return decide(
    access,
    (r) => r.canSeeCost,
    "You can see cost and margin.",
    "Only pricing managers and admins can see cost and margin.",
  );
}

/** May they set or change a price, and work New Product Pricing worksheets? */
export function priceGate(access: PricingAccess): PricingGate {
  return decide(access, (r) => r.canPrice, "You can set prices.", "Only pricing managers and admins can set prices.");
}

/** May they see and work New Product Pricing worksheets? (`new products`, manager or admin.) */
export function newProductsGate(access: PricingAccess): PricingGate {
  return decide(
    access,
    (r) => r.canNewProducts,
    "You can work New Product Pricing worksheets.",
    "New Product Pricing is for pricing managers, admins and the New Products role.",
  );
}

/** May they press Added to SAP? */
export function addedToSapGate(access: PricingAccess): PricingGate {
  return decide(
    access,
    (r) => r.canAddToSap,
    "You can confirm a part was added to SAP.",
    "Only a pricing admin can confirm a part was added to SAP.",
  );
}

/** May they manage the Pricing Roles list? (A pricing admin, or an ARC admin.) */
export function managePricingRolesGate(access: PricingAccess): PricingGate {
  return decide(
    access,
    (r) => r.canManageRoles,
    "You can manage pricing roles.",
    "Only a pricing admin or an ARC admin can manage pricing roles.",
  );
}

/**
 * May they cancel this request? The person who raised it may withdraw their
 * own before it is priced; a manager or admin may cancel any that isn't
 * already Cancelled.
 */
export function cancelRequestGate(
  access: PricingAccess,
  request: { status: PricingRequestStatus; isMine: boolean },
): PricingGate {
  if (request.status === "Cancelled") {
    return { allowed: false, resolving: false, hint: "This request is already cancelled." };
  }
  if (request.isMine && request.status !== "Priced") {
    return decide(access, (r) => r.canAccess, "You can withdraw your request.", "");
  }
  return decide(
    access,
    (r) => r.canPrice,
    "You can cancel this request.",
    request.isMine
      ? "This request is priced — ask a pricing manager to cancel it."
      : "Only the person who raised it, or a pricing manager, can cancel a request.",
  );
}
