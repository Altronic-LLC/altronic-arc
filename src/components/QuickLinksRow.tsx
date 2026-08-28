import { ExternalLink, Link2 } from "lucide-react";
import type { QuickLink } from "@/types/task";

// =============================================================================
// The Quick Links subsection above a Dashboard department's cards.
//
// Boxed and labelled on purpose — a bare row of buttons sitting between the
// department's divider heading and its card grid read as stray controls that
// wandered onto the page, not a deliberate part of it. The small "Quick
// Links" eyebrow + a faintly-bordered shelf is the same visual language the
// rest of the app uses for a titled group of controls (see SidebarGroup on
// the FAIT detail page), so this reads as "a section", not "some buttons".
//
// Renders nothing at all when the department has none — an empty subsection
// would be clutter on every department nobody has configured one for yet,
// the same call as PlaceholderCard ordering elsewhere on this page.
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
    <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-surface-2/50 px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        <Link2 className="h-3 w-3" />
        Quick Links
      </span>
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
    </div>
  );
}
