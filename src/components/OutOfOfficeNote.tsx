import { Plane } from "lucide-react";
import { outOfOfficeHeadline, type OutOfOffice } from "@/lib/outOfOffice";

/**
 * "Glenn Terry is out of office until Dec 2 — I'm away this week…", above a
 * comment box, before it's sent (Altronic-LLC/BusinessIT#4). Their own
 * automatic replies go to ARC's shared mailbox, never to the commenter, so
 * this is the only place they'd find out. Renders nothing when nobody is away.
 */
export function OutOfOfficeNote({ away }: { away: OutOfOffice[] }) {
  if (away.length === 0) return null;
  return (
    <div
      role="status"
      aria-label="Out of office"
      className="mb-2 space-y-1.5 rounded-md border border-ajax-yellow/40 bg-ajax-yellow/10 px-2.5 py-1.5 text-xs"
    >
      {away.map((p) => (
        <div key={p.email} className="flex items-start gap-1.5">
          <Plane className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
          <div className="min-w-0">
            <span className="font-medium text-fg">{outOfOfficeHeadline(p)}</span>
            {p.message && (
              <span className="line-clamp-2 text-fg-muted" title={p.message}>
                “{p.message}”
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
