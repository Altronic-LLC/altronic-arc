import { SignOffChip } from "@/components/partsAtoms";
import {
  joinNames,
  WorkflowDiagram,
  type WorkflowStep,
  type WorkflowTrack,
} from "@/components/WorkflowDiagram";
import { COMPONENT_PREFIX_CATEGORY } from "@/lib/altronicPartMapper";
import { SAP_RESPONSES, SAP_RESPONSE_LABELS } from "@/lib/partsRoles";

// =============================================================================
// The Parts List approval chain, drawn for the User Manual. Two tracks: a new
// HCO component is reviewed by an engineer before it reaches the SAP admin; a
// new Part List part goes straight to the SAP admin.
//
// The rules live in lib/partsRoles.ts (initialSignOff / nextSignOff, the
// gates, the three SAP answers) and the emails in lib/partsAlerts.ts; if
// either changes, change this with it. People are named by their Parts Roles
// role, never by name — who holds a role is data on that list, not code.
// =============================================================================

/** "601, 611, 701, 711, 712 or 722" — the prefixes that are components. */
export const COMPONENT_PREFIXES = joinNames(Object.keys(COMPONENT_PREFIX_CATEGORY).sort(), "or");

const SAP_STEP: WorkflowStep = {
  kind: "step",
  who: "SAP admin",
  title: "Add it to SAP and approve",
  status: "Approved",
  detail:
    "Pick one of the three answers below, from the email's buttons or Approve on the part's page. Every answer approves the part; nothing is approved until Approve is clicked in ARC.",
  emails: "Whoever added the part, with the answer given",
};

export const PARTS_APPROVAL_TRACKS: WorkflowTrack[] = [
  {
    label: `A new component (${COMPONENT_PREFIXES})`,
    items: [
      {
        kind: "step",
        who: "Add role or above",
        title: "Add the component",
        status: "Pending Engineering Review",
        detail:
          "New part on the list. Its Description and Type are picked, and the next free number is filled in. Adding to 722 needs Parts editor or above.",
        emails: "The reviewing engineers, with every field",
      },
      {
        kind: "step",
        who: "Reviewing engineer",
        title: "Engineering review",
        status: "Pending SAP",
        detail:
          "Correct anything wrong with Edit, then Approve with an optional comment. The comment is kept in the Approval history.",
        emails: "The SAP admins, with every field and the reviewer's comment",
      },
      SAP_STEP,
    ],
  },
  {
    label: "A new Part List part (every other prefix)",
    items: [
      {
        kind: "step",
        who: "Add role or above",
        title: "Add the part",
        status: "Pending SAP",
        detail:
          "New part on the list; the next free number is filled in. Only the SAP admin can add the first part of a new list.",
        emails: "The SAP admins, with every field",
      },
      SAP_STEP,
    ],
  },
];

export function PartsApprovalWorkflowDiagram() {
  return (
    <WorkflowDiagram
      title="Parts approval workflow"
      tracks={PARTS_APPROVAL_TRACKS}
      renderStatus={(s) => <SignOffChip status={s} />}
      statusLabel="Sign-off becomes"
      sections={[
        {
          heading: "The SAP admin's three answers",
          body: (
            <>
              <ul className="list-disc pl-5 text-xs text-fg-muted">
                {SAP_RESPONSES.map((r) => (
                  <li key={r}>{SAP_RESPONSE_LABELS[r]}</li>
                ))}
              </ul>
              <p className="text-xs text-fg-muted">
                Each one approves the part. &ldquo;Requires more information&rdquo; needs a
                note saying what&apos;s missing, which goes in the email to whoever added it.
              </p>
            </>
          ),
        },
        {
          heading: "Off the main path",
          body: (
            <p className="text-xs text-fg-muted">
              Editing an approved part doesn&apos;t send it back for approval, but the SAP
              admins are emailed what changed. Someone who can add but not edit uses Suggest a
              correction, which emails the reviewing engineers and the SAP admins. The SAP admin
              can delete a part number (sign-off <SignOffChip status="Deleted" />); the number is
              reused for the next part on that list, which starts again at step 1. Parts
              loaded from the old app show <SignOffChip status={null} showUntracked /> and have
              no approval to give.
            </p>
          ),
        },
      ]}
    />
  );
}
