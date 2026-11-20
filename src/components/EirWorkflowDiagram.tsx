import {
  EIR_RESPONSE_ACCEPTED_ALERTS,
  EIR_TRIAGE_ASSIGNERS,
  EIR_TRIAGE_PROJECT_REVIEWERS,
} from "@/api/config";
import { EirStatusBadge } from "@/components/atoms";
import { joinNames, WorkflowDiagram, type WorkflowStep } from "@/components/WorkflowDiagram";
import { EIR_PROJECT_REFERENCE_EDITORS } from "@/lib/eirProjectReference";
import { nameList, parseRecipientList } from "@/lib/recipientList";
import type { EirStatus } from "@/types/task";

// =============================================================================
// The EIR workflow, drawn for the User Manual: triage (a project, then an
// engineer), the engineer's response, and the accept / reject loop that ends
// in Closed.
//
// The rules live in lib/eirTriage.ts (the triage emails),
// lib/eirStatusAlerts.ts (Response Accepted / Not Accepted / Resolved) and
// lib/eirProjectReference.ts (who may set the project). Every list of people
// here is read from the same config the emails are sent to, so a re-pointed
// list can't leave the manual naming the old one.
// =============================================================================

const names = (raw: string, fallback: string) => nameList(parseRecipientList(raw), fallback);

const PROJECT_REVIEWERS = names(EIR_TRIAGE_PROJECT_REVIEWERS, "the project reviewers");
const ASSIGNERS = names(EIR_TRIAGE_ASSIGNERS, "the assigners");
const CLOSERS = names(EIR_RESPONSE_ACCEPTED_ALERTS, "the EIR closers");
const PROJECT_EDITORS = joinNames(
  parseRecipientList(EIR_PROJECT_REFERENCE_EDITORS.join(", ")).map((p) => p.displayName),
  "or",
);

/** A step whose status is a real EIR status. */
type FlowStep = WorkflowStep & { status?: EirStatus };

export const EIR_FLOW: FlowStep[] = [
  {
    kind: "step",
    who: "Reporter",
    title: "Raise the EIR",
    status: "Under Review",
    detail:
      "New EIR, with a Subject, Description, Requested Priority and Request Type. It's numbered EIR_YYYY-#### automatically.",
    emails: `If it has no project: ${PROJECT_REVIEWERS}, asking for one`,
    branches: [
      {
        when: "If it's raised with a project already:",
        detail: "It skips straight to assigning an engineer.",
        emails: `${ASSIGNERS}, asking for an engineer`,
        goesTo: "Assign an engineer",
      },
    ],
  },
  {
    kind: "step",
    who: PROJECT_EDITORS,
    title: "Add the project reference",
    detail: `Once an EIR is raised, only ${PROJECT_EDITORS} can change its Project Reference. It shows in the Needs Assigned tab until an engineer is picked.`,
    emails: `${ASSIGNERS}, asking for an engineer (not if one is already assigned)`,
  },
  {
    kind: "step",
    who: ASSIGNERS,
    title: "Assign an engineer",
    detail: "Pick the engineer under Assigned in the sidebar. They're added as a watcher.",
  },
  {
    kind: "step",
    who: "Assigned engineer",
    title: "Respond and resolve",
    detail: "Write the Engineering Response, then set Resolution to Resolved.",
    emails: `${ASSIGNERS}, asking them to review the response`,
    branches: [
      {
        when: "If it needs engineering work:",
        detail:
          "Promote to Task creates a linked task carrying the discussion, files and watchers. Completing that task asks for a final resolution, which is added to the Engineering Response and sets the EIR to Resolved and Closed.",
        status: "Closed",
      },
    ],
  },
  {
    kind: "step",
    who: ASSIGNERS,
    title: "Accept or reject the response",
    status: "Response Accepted",
    detail: "Set the Status to Response Accepted if the answer is good enough.",
    emails: `${CLOSERS}, asking for it to be closed`,
    branches: [
      {
        when: "If it isn't good enough:",
        detail: "Set the Status to Response Not Accepted.",
        status: "Response Not Accepted",
        emails:
          "The assigned engineers, asking for a more detailed response (the assigners, if no engineer can be reached)",
        goesTo: "Respond and resolve",
      },
    ],
  },
  {
    kind: "step",
    who: CLOSERS,
    title: "Close it",
    status: "Closed",
    detail: "Set the Status to Closed.",
    emails: "Watchers, the assigned engineers and the reporter (the usual status note)",
  },
];

export function EirWorkflowDiagram() {
  return (
    <WorkflowDiagram
      title="EIR workflow"
      tracks={[{ items: EIR_FLOW }]}
      renderStatus={(s) => <EirStatusBadge status={s as EirStatus} />}
      sections={[
        {
          heading: "Good to know",
          body: (
            <p className="text-xs text-fg-muted">
              <EirStatusBadge status="EIR Not Accepted" /> rejects the request itself rather
              than the engineer&apos;s answer, so it asks nobody to revisit anything. Every
              status change emails the watchers, the assigned engineers and the reporter, and
              whoever made a change is left off their own alert. On the Board, dragging a card
              to another column sets its status the same way.
            </p>
          ),
        },
      ]}
    />
  );
}
