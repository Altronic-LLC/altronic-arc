/**
 * Utilities for detecting @-mentions in comment HTML.
 *
 * Mentions are stored as:
 *   <span class="mention" data-email="user@domain.com">@Display Name</span>
 *
 * We extract mentioned emails and check if the current user is among them.
 */

/**
 * Extract all mentioned email addresses from a comment's HTML body.
 * Returns a Set of lowercase email addresses.
 */
export function extractMentionedEmails(bodyHtml: string): Set<string> {
  const mentioned = new Set<string>();

  if (!bodyHtml || typeof bodyHtml !== "string") {
    return mentioned;
  }

  // Match <span class="mention" data-email="..."> tags
  const regex = /<span\s+class="mention"\s+data-email="([^"]+)"/gi;
  let match;

  while ((match = regex.exec(bodyHtml)) !== null) {
    const email = match[1]?.toLowerCase();
    if (email) {
      mentioned.add(email);
    }
  }

  return mentioned;
}

/**
 * Check if a user (by email) is mentioned in a comment's HTML body.
 */
export function isUserMentionedInComment(
  bodyHtml: string,
  userEmail: string
): boolean {
  if (!userEmail) return false;
  const mentionedEmails = extractMentionedEmails(bodyHtml);
  return mentionedEmails.has(userEmail.toLowerCase());
}

/**
 * Check if a user is mentioned in any comment of an item.
 * Returns true if at least one comment mentions them.
 */
export function isUserMentionedInComments(
  comments: Array<{ bodyHtml: string }>,
  userEmail: string
): boolean {
  if (!userEmail || !Array.isArray(comments)) return false;
  return comments.some((c) => isUserMentionedInComment(c.bodyHtml, userEmail));
}
