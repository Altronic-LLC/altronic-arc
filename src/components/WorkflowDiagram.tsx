import type { ReactNode } from "react";
import { ArrowRight, CornerDownRight, Lock, Mail, Undo2 } from "lucide-react";

// =============================================================================
// A workflow drawn for the User Manual — numbered steps down a line, with the
// conditions the app enforces between them ("gates") and the side roads a step
// can take ("branches": a failed sign-off, a rejected response, a skipped
// step).
//
// Hand-built React rather than Mermaid, for the reason AboutView gives: the
// Mermaid parser kept choking. Each department's diagram is DATA passed in
// here, kept beside the rules it describes, so a change to a process is an
// edit to an array. The status chip is the department's own badge
// (`renderStatus`), so a colour in the manual is the colour on the record.
// =============================================================================

/** One step somebody takes. */
export interface WorkflowStep {
  kind: "step";
  /** Who takes it — a role or named people. */
  who: string;
  title: string;
  /** The record's status once this step is done. */
  status?: string;
  detail: string;
  /** Who is emailed when it happens. */
  emails?: string;
  /** Where else this step can go. */
  branches?: WorkflowBranch[];
}

/** A side road off a step: "If SQE fails it → back to the initiator". */
export interface WorkflowBranch {
  /** The condition, e.g. "If SQE Sign Off is Failed:". */
  when: string;
  detail: string;
  status?: string;
  emails?: string;
  /** Title of an earlier (or later) step in the same track this leads to. */
  goesTo?: string;
}

/** A condition the app enforces before the next step. */
export interface WorkflowGate {
  kind: "gate";
  label: string;
  /** Defaults to "Unlocks when:". */
  prefix?: string;
}

export type WorkflowItem = WorkflowStep | WorkflowGate;

/** One path through the process. Most workflows have one; Parts has two. */
export interface WorkflowTrack {
  /** Shown above the track when there is more than one. */
  label?: string;
  items: WorkflowItem[];
}

/** A note under the steps — part statuses, statuses off the main path, … */
export interface WorkflowSection {
  heading: string;
  body: ReactNode;
}

/** "A", "A and B", "A, B and C" — or "or" in place of "and". */
export function joinNames(names: string[], conjunction: "and" | "or" = "and"): string {
  const clean = names.filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? "";
  return `${clean.slice(0, -1).join(", ")} ${conjunction} ${clean[clean.length - 1]}`;
}

/** The 1-based number of each step in a track, keyed by title. */
export function stepNumbers(items: WorkflowItem[]): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const item of items) {
    if (item.kind === "step") out.set(item.title, ++n);
  }
  return out;
}

export function WorkflowDiagram({
  title,
  tracks,
  renderStatus,
  statusLabel = "Status becomes",
  sections = [],
}: {
  /** Caption, and the accessible name of the step list. */
  title: string;
  tracks: WorkflowTrack[];
  renderStatus: (status: string) => ReactNode;
  /** Screen-reader wording before each status chip. */
  statusLabel?: string;
  sections?: WorkflowSection[];
}) {
  const several = tracks.length > 1;

  return (
    <figure className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <figcaption className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
        {title}
      </figcaption>

      {tracks.map((track, t) => (
        <div key={track.label ?? t} className={several && t > 0 ? "border-t border-border pt-3" : undefined}>
          {several && track.label && (
            <div className="mb-2 text-sm font-semibold text-fg">{track.label}</div>
          )}
          <Track
            name={several && track.label ? `${title}: ${track.label}` : title}
            items={track.items}
            renderStatus={renderStatus}
            statusLabel={statusLabel}
          />
        </div>
      ))}

      {sections.map((s) => (
        <div key={s.heading} className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{s.heading}</div>
          {s.body}
        </div>
      ))}
    </figure>
  );
}

function Track({
  name,
  items,
  renderStatus,
  statusLabel,
}: {
  name: string;
  items: WorkflowItem[];
  renderStatus: (status: string) => ReactNode;
  statusLabel: string;
}) {
  const numbers = stepNumbers(items);

  return (
    <ol aria-label={name} className="flex flex-col">
      {items.map((item, i) => {
        const last = i === items.length - 1;

        if (item.kind === "gate") {
          return (
            <li key={`gate-${i}`} className="flex gap-3">
              {/* Keeps the gate on the same vertical line as the step numbers. */}
              <div className="flex w-7 shrink-0 flex-col items-center">
                <div className="w-px flex-1 bg-border" />
                <Lock aria-hidden className="my-1 h-3.5 w-3.5 text-fg-muted" />
                <div className="w-px flex-1 bg-border" />
              </div>
              <div className="my-1 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-fg-muted">
                <span className="font-semibold text-fg">{item.prefix ?? "Unlocks when:"}</span> {item.label}
              </div>
            </li>
          );
        }

        return (
          <li key={item.title} className="flex gap-3">
            <div className="flex w-7 shrink-0 flex-col items-center">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
                {numbers.get(item.title)}
              </span>
              {!last && <div className="w-px flex-1 bg-border" />}
            </div>
            <div className={last ? "min-w-0 flex-1" : "min-w-0 flex-1 pb-4"}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-fg">{item.title}</span>
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-fg-muted">
                  {item.who}
                </span>
              </div>
              <p className="mt-1 text-sm text-fg-muted">{item.detail}</p>
              <Outcome
                status={item.status}
                emails={item.emails}
                renderStatus={renderStatus}
                statusLabel={statusLabel}
              />
              {item.branches?.map((b) => (
                <div
                  key={b.when}
                  className="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted"
                >
                  <div className="flex items-start gap-1.5">
                    <CornerDownRight aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      <span className="font-semibold text-fg">{b.when}</span> {b.detail}
                    </span>
                  </div>
                  <Outcome
                    status={b.status}
                    emails={b.emails}
                    renderStatus={renderStatus}
                    statusLabel={statusLabel}
                  />
                  {b.goesTo && numbers.has(b.goesTo) && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Undo2 aria-hidden className="h-3 w-3" />
                      <span>
                        Goes to step {numbers.get(b.goesTo)}: {b.goesTo}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The status a step lands in, and who is emailed. */
function Outcome({
  status,
  emails,
  renderStatus,
  statusLabel,
}: {
  status?: string;
  emails?: string;
  renderStatus: (status: string) => ReactNode;
  statusLabel: string;
}) {
  return (
    <>
      {status && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-fg-muted">
          <ArrowRight aria-hidden className="h-3 w-3" />
          <span className="sr-only">{statusLabel}</span>
          {renderStatus(status)}
        </div>
      )}
      {emails && (
        <div className="mt-1.5 flex items-start gap-1.5 text-xs text-fg-muted">
          <Mail aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            <span className="sr-only">Emails: </span>
            {emails}
          </span>
        </div>
      )}
    </>
  );
}
