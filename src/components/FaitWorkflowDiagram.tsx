import { FAIT_NEW_ALERTS, FAIT_SQE_REVIEWERS } from "@/api/config";
import { FaitStatusChip } from "@/components/faitAtoms";
import { WorkflowDiagram, type WorkflowGate, type WorkflowStep } from "@/components/WorkflowDiagram";
import { nameList, parseRecipientList } from "@/lib/recipientList";
import {
  FAIT_STATUS_CLOSED,
  FAIT_STATUS_WITH_ENG,
  FAIT_STATUS_WITH_KAM,
  FAIT_STATUS_WITH_SQE,
} from "@/lib/faitSignOff";

// =============================================================================
// The FAIT workflow — the SQE → Engineering → KAM sign-off chain — drawn for
// the User Manual. The rules live in lib/faitSignOff.ts (which sign-off moves
// the status, when a KAM is owed, when Notify Initiator may close it) and the
// emails in lib/faitAlerts.ts; if either changes, change this with it.
//
// The intake and SQE lists are read from config, the same values the emails
// are sent to, so a re-pointed list can't leave the manual naming the old one.
// =============================================================================

const INTAKE = nameList(parseRecipientList(FAIT_NEW_ALERTS), "the FAIT intake list");
const SQE_REVIEWERS = nameList(parseRecipientList(FAIT_SQE_REVIEWERS), "the SQE reviewers");

export const FAIT_FLOW: (WorkflowStep | WorkflowGate)[] = [
  {
    kind: "step",
    who: "Initiator",
    title: "Raise the FAIT",
    status: "Open",
    detail:
      "New FAIT, with the part, the supplier, the project and what's being requested. You're the Initiator and a watcher automatically.",
    emails: `${INTAKE}, the intake list`,
  },
  {
    kind: "step",
    who: "Supply Chain",
    title: "Receive the part and assign people",
    status: "FAIT Part Received",
    detail:
      "Set Status when the part arrives. Pick the Assigned Engineer, and a KAM if the part has OEM Impact — each is added as a watcher.",
    emails: "The engineer and KAM, a heads-up that says no action is needed yet",
  },
  {
    kind: "step",
    who: "Supply Chain",
    title: "Send it to SQE",
    status: FAIT_STATUS_WITH_SQE,
    detail: "Set Status to This is with SQE once the part is ready to inspect.",
    emails: `${SQE_REVIEWERS}, asking for the SQE sign-off`,
  },
  {
    kind: "step",
    who: "SQE",
    title: "Inspect and sign off",
    status: FAIT_STATUS_WITH_ENG,
    detail:
      "Record the inspection and results, then set SQE Sign Off to Approved. The status moves on by itself.",
    emails: "The assigned engineer, asking for the Engineering sign-off",
    branches: [
      {
        when: "If SQE Sign Off is Failed:",
        detail:
          "The FAIT goes back. The status doesn't move and the engineer isn't asked for anything. Put the reason in SQE Approval Notes.",
        emails: "The initiator",
      },
    ],
  },
  {
    kind: "step",
    who: "Assigned engineer",
    title: "Engineering sign-off",
    status: FAIT_STATUS_WITH_KAM,
    detail: "Set Eng Sign Off to Approved. The status moves on by itself if a KAM sign-off is owed.",
    emails: "The KAM, asking for the KAM sign-off",
    branches: [
      {
        when: "If no KAM sign-off is owed:",
        detail: "The chain finishes here and the status stays where it is. The FAIT is ready to close.",
        goesTo: "Close it with Notify Initiator",
      },
    ],
  },
  { kind: "gate", prefix: "Only when:", label: "OEM Impact is Yes and a KAM is assigned" },
  {
    kind: "step",
    who: "KAM",
    title: "KAM sign-off",
    detail: "Set KAM Sign Off to Approved.",
  },
  { kind: "gate", label: "Every sign-off the FAIT owes is Approved" },
  {
    kind: "step",
    who: "Anyone working it",
    title: "Close it with Notify Initiator",
    status: FAIT_STATUS_CLOSED,
    detail:
      "Tick Notify Initiator on the Sign-off card. It won't save until every sign-off owed is Approved. Setting Status to Closed works too.",
    emails: `The initiator and watchers, plus ${INTAKE}`,
  },
];

export function FaitWorkflowDiagram() {
  return (
    <WorkflowDiagram
      title="FAIT workflow"
      tracks={[{ items: FAIT_FLOW }]}
      renderStatus={(s) => <FaitStatusChip status={s} />}
      sections={[
        {
          heading: "Good to know",
          body: (
            <p className="text-xs text-fg-muted">
              Every status change emails the watchers, the initiator, the engineer and the
              KAM. A Status you pick yourself always wins over the one the sign-offs would
              set, and editing the sign-offs on a closed FAIT never reopens it. With OEM
              Impact set to No, the KAM fields are hidden and no KAM sign-off is owed.
            </p>
          ),
        },
      ]}
    />
  );
}
