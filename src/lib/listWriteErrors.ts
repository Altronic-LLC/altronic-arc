// =============================================================================
// Turning a failed SharePoint list write into a sentence somebody can act on.
//
// Hailey Sturtz tried to remove a customer from the Open Orders list and got
// the raw Graph error in a toast — `Graph 403 Forbidden at
// https://graph.microsoft.com/v1.0/sites/coopermachineryservices…/items/5:
// {"error":{"code":"accessDenied"…}}` (2026-08-25). That tells her nothing she
// can do anything about, and it doesn't tell whoever she asks what to change.
//
// The distinction that matters: ARC's own role gating is UI-level, but the
// SharePoint permission is the real boundary — so a write CAN fail after the
// app has happily offered the button. When it does, the message has to name
// the likely cause, the person to ask, and anything the user can do instead.
// =============================================================================

/** Was this the SharePoint permission boundary, rather than a bug or a blip? */
export function isPermissionDenied(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status === 403) return true;
  const body = (err as { body?: string } | null)?.body ?? "";
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /accessdenied|access denied|unauthorized/i.test(`${body} ${message}`);
}

/** Did the row disappear underneath us — usually somebody else got there first? */
export function isGone(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status === 404) return true;
  const body = (err as { body?: string } | null)?.body ?? "";
  return /itemnotfound|does not exist/i.test(body);
}

export interface WriteFailureContext {
  /** What was being attempted, lower case: "remove this customer". */
  action: string;
  /** Which SharePoint site, for the "ask an admin about X" sentence. */
  site: string;
  /** Something the user could do instead that needs less permission. */
  alternative?: string;
}

/**
 * A message for a failed list write.
 *
 * Deliberately does NOT claim to know which of the two permission layers said
 * no — the app's `Sites.Selected` grant on the site, or the signed-in user's
 * own SharePoint role. From the browser they are indistinguishable, and
 * guessing wrong sends somebody to change the wrong setting. It names both and
 * gives the one test that separates them.
 */
export function describeListWriteFailure(err: unknown, ctx: WriteFailureContext): string {
  if (isGone(err)) {
    return (
      `Couldn't ${ctx.action} — it isn't on the list any more. ` +
      "Somebody else may have removed it already; the list has been refreshed."
    );
  }

  if (isPermissionDenied(err)) {
    const parts = [
      `SharePoint wouldn't let you ${ctx.action}.`,
      `Your account may have read-only access to the ${ctx.site} site, or ARC's own access to it may not include deleting.`,
    ];
    if (ctx.alternative) parts.push(ctx.alternative);
    parts.push("If you need this, ask an admin to check both.");
    return parts.join(" ");
  }

  // Anything else: pass the real message through rather than inventing a
  // reason. A wrong explanation is worse than a raw one.
  return err instanceof Error ? `Couldn't ${ctx.action}: ${err.message}` : `Couldn't ${ctx.action}.`;
}
