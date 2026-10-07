import { ArrowRight, Lock, Mail } from "lucide-react";
import type { BuildRequestPartStatus, BuildRequestStatus } from "@/types/task";
import { BuildRequestStatusBadge, PartStatusBadge } from "@/components/buildRequestAtoms";

// =============================================================================
// The Build Request workflow, drawn for the User Manual.
//
// Hand-built React rather than Mermaid, for the reason AboutView gives: the
// Mermaid parser kept choking. Steps are DATA, so a change to the process is
// an edit to the arrays below. The rules they describe live in
// lib/buildRequestProduction.ts (the request's two gates),
// lib/buildRequestPartProduction.ts (each part's buttons) and
// lib/buildRequestAlerts.ts (the emails) — if any of them changes, change
// this with it.
//
// Status chips reuse the real badges from buildRequestAtoms, so a colour on
// this page is the colour people see on the request itself.
// =============================================================================

interface FlowStep {
  kind: "step";
  who: string;
  title: string;
  /** The request's status once this step is done. */
  status?: BuildRequestStatus;
  detail: string;
  emails?: string;
}

/** A condition the app enforces before the next step can be taken. */
interface FlowGate {
  kind: "gate";
  label: string;
}

export const BUILD_REQUEST_FLOW: (FlowStep | FlowGate)[] = [
  {
    kind: "step",
    who: "Requestor",
    title: "Raise the build request",
    status: "Submitted",
    detail:
      "New Build Request on the list, or Create Build Request on a task. The requestor is set as a watcher automatically.",
  },
  {
    kind: "step",
    who: "Engineer",
    title: "Add parts and prepare each one",
    status: "In-process",
    detail:
      "Add Part for each part. Tick its whole checklist (PCB and Harness parts), or fill in Part Number, Qty, Part Description, Part Type and Disposition (other parts), then press Mark as Ready for Production on it. Set the request to In-process from the Status picker while this happens.",
  },
  { kind: "gate", label: "Every part is Ready for Production or further (and there is at least one)" },
  {
    kind: "step",
    who: "Assigned engineer or admin",
    title: "Press Ready for Production",
    status: "Ready for Production",
    detail: "Hands the build request to production.",
    emails: "Amanda Hoagland, Sheila Horn, the engineer, watchers, the requestor",
  },
  {
    kind: "step",
    who: "Amanda Hoagland or admin",
    title: "Build each part",
    detail:
      "On each part: Mark as In Production when work starts, then Mark as Production Complete when it's built. Put On Hold pauses a part.",
    emails: "Each part: the engineer, request and part watchers, the requestor",
  },
  { kind: "gate", label: "Every part is Production Complete" },
  {
    kind: "step",
    who: "Amanda Hoagland or admin",
    title: "Press Build Request Production Complete",
    status: "Production Complete",
    detail: "Production signs off that the build is done.",
    emails: "Sheila Horn, asking her to review it (watchers get the usual status note)",
  },
  {
    kind: "step",
    who: "Sheila Horn",
    title: "Review and close",
    status: "Complete",
    detail: "Sets the request's Status to Complete.",
    emails: "Watchers, Amanda Hoagland, the engineer, the requestor",
  },
];

/**
 * A part's own status, in the order its buttons move it. A new part has no
 * status until Mark as Ready for Production is pressed, so the strip starts
 * with a plain "not ready yet" chip rather than a stored status.
 */
export const PART_STATUS_FLOW: BuildRequestPartStatus[] = [
  "Ready for Production",
  "In Production",
  "Production Complete",
];

/** Request statuses that can be set at any point, outside the main path. */
export const SIDE_STATUSES: BuildRequestStatus[] = ["Information Needed", "Blocked", "On Hold"];

export function BuildRequestWorkflowDiagram() {
  let stepNumber = 0;

  return (
    <figure className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <figcaption className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
        Build request workflow
      </figcaption>

      <ol aria-label="Build request workflow" className="flex flex-col">
        {BUILD_REQUEST_FLOW.map((item, i) => {
          const last = i === BUILD_REQUEST_FLOW.length - 1;

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
                  <span className="font-semibold text-fg">Unlocks when:</span> {item.label}
                </div>
              </li>
            );
          }

          stepNumber += 1;
          return (
            <li key={item.title} className="flex gap-3">
              <div className="flex w-7 shrink-0 flex-col items-center">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
                  {stepNumber}
                </span>
                {!last && <div className="w-px flex-1 bg-border" />}
              </div>
              <div className={last ? "flex-1" : "flex-1 pb-4"}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-fg">{item.title}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-fg-muted">
                    {item.who}
                  </span>
                </div>
                <p className="mt-1 text-sm text-fg-muted">{item.detail}</p>
                {item.status && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-fg-muted">
                    <ArrowRight aria-hidden className="h-3 w-3" />
                    <span className="sr-only">Request status becomes</span>
                    <BuildRequestStatusBadge status={item.status} />
                  </div>
                )}
                {item.emails && (
                  <div className="mt-1.5 flex items-start gap-1.5 text-xs text-fg-muted">
                    <Mail aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      <span className="sr-only">Emails: </span>
                      {item.emails}
                    </span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Each part&apos;s status
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
            Not ready yet
          </span>
          {PART_STATUS_FLOW.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <ArrowRight aria-hidden className="h-3 w-3 text-fg-muted" />
              <PartStatusBadge status={s} />
            </span>
          ))}
        </div>
        <p className="text-xs text-fg-muted">
          Each step is a button on the part, not a dropdown. Anyone can press Mark as Ready
          for Production once the part is ready; the rest are for Amanda Hoagland or an
          admin. A part in production can be put <PartStatusBadge status="On Hold" />, then
          moved back into production or straight to Production Complete.
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Off the main path
        </div>
        <p className="text-xs text-fg-muted">
          The request itself can be set to{" "}
          {SIDE_STATUSES.map((s, i) => (
            <span key={s}>
              {i > 0 && (i === SIDE_STATUSES.length - 1 ? " or " : ", ")}
              <BuildRequestStatusBadge status={s} />
            </span>
          ))}{" "}
          from the Status picker at any time. The two production statuses can&apos;t be
          picked there until their gate above is unlocked.
        </p>
      </div>
    </figure>
  );
}
