import { ArrowRight } from "lucide-react";
import type { BuildRequestPartStatus, BuildRequestStatus } from "@/types/task";
import { BuildRequestStatusBadge, PartStatusBadge } from "@/components/buildRequestAtoms";
import { WorkflowDiagram, type WorkflowGate, type WorkflowStep } from "@/components/WorkflowDiagram";

// =============================================================================
// The Build Request workflow, drawn for the User Manual on the shared
// WorkflowDiagram. Steps are DATA, so a change to the process is an edit to
// the arrays below. The rules they describe live in
// lib/buildRequestProduction.ts (the request's two gates),
// lib/buildRequestPartProduction.ts (each part's buttons) and
// lib/buildRequestAlerts.ts (the emails) — if any of them changes, change
// this with it.
//
// Status chips reuse the real badges from buildRequestAtoms, so a colour on
// this page is the colour people see on the request itself.
// =============================================================================

/** A step whose status is a real Build Request status. */
type FlowStep = WorkflowStep & { status?: BuildRequestStatus };

export const BUILD_REQUEST_FLOW: (FlowStep | WorkflowGate)[] = [
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
    who: "Sheila Horn or admin",
    title: "Press Mark Build Request Complete",
    status: "Complete",
    detail: "Sheila reviews the request and closes it. Every part must still be Production Complete. A task the request was raised from can be completed after this.",
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
  return (
    <WorkflowDiagram
      title="Build request workflow"
      tracks={[{ items: BUILD_REQUEST_FLOW }]}
      renderStatus={(s) => <BuildRequestStatusBadge status={s as BuildRequestStatus} />}
      statusLabel="Request status becomes"
      sections={[
        { heading: "Each part's status", body: <PartStatusStrip /> },
        { heading: "Off the main path", body: <OffPath /> },
      ]}
    />
  );
}

function PartStatusStrip() {
  return (
    <>
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
    </>
  );
}

function OffPath() {
  return (
    <p className="text-xs text-fg-muted">
      The request itself can be set to{" "}
      {SIDE_STATUSES.map((s, i) => (
        <span key={s}>
          {i > 0 && (i === SIDE_STATUSES.length - 1 ? " or " : ", ")}
          <BuildRequestStatusBadge status={s} />
        </span>
      ))}{" "}
      on older requests, but there is no Status dropdown in ARC any more: the buttons
      above and on each part move a request along. To set one of these, change it in
      SharePoint.
    </p>
  );
}
