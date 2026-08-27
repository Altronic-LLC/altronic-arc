import { ExternalLink } from "lucide-react";
import type { QuickLink } from "@/types/task";

// =============================================================================
// The row of admin-managed link buttons above a Dashboard department's cards.
// Renders nothing at all when the department has none — an empty "Quick
// Links" heading would be clutter on every department nobody has configured
// one for yet, the same call as PlaceholderCard ordering elsewhere on this
// page.
//
// Reading is open to any signed-in user; managing the list is admin-only, at
// /admin/quick-links (see useQuickLinks.ts).
// =============================================================================

/** Only http(s) opens — an admin-typed value that isn't a real URL (a bare
 *  "sharepoint.com", or something pasted wrong) shouldn't become a clickable
 *  button that goes nowhere useful, or worse, a non-http scheme. */
function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export function QuickLinksRow({ links }: { links: QuickLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {links.map((link) => {
        const href = safeHref(link.url);
        return (
          <a
            key={link.id}
            href={href ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={href ? undefined : true}
            title={href ? undefined : "This link's URL doesn't look valid — ask an admin to fix it"}
            className={
              href
                ? "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg shadow-sm transition-colors hover:border-accent hover:text-accent"
                : "inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-dashed border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted opacity-60"
            }
          >
            {link.label || link.url}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        );
      })}
    </div>
  );
}
