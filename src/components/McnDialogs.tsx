import { useMemo, useState } from "react";
import type { Person } from "@/types/task";
import { MCN_DISTRIBUTION_ROLES, type Mcn, type McnItem, type McnScopeLine } from "@/types/mcn";
import { useMaintenanceDepartments } from "@/hooks/useMaintenanceReferenceLists";
import { useMcnDistributionGroups } from "@/hooks/useMcnRoles";
import { MCN_ANSWERS, mcnItemsIn, type McnItemGroup } from "@/lib/mcnFields";
import { distributionRecipients, emptyDistributionRoles } from "@/lib/mcnAlerts";
import { personKey } from "@/lib/people";
import { fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { ChoicePills } from "./ChoicePills";
import { DateField } from "./DateField";
import { PersonMultiField } from "./PersonMultiField";
import { RichTextEditor } from "./RichTextEditor";
import { McnDialog, McnDistributionChecks, McnField, McnScopeEditor } from "./McnFields";

// =============================================================================
// The dialogs on an MCN's page: one per card editor that FieldEditModal can't
// express (rich text, the scope table, the Yes / No lines, the distribution
// ticks), and one per workflow step that needs input (approve, reject or
// reopen, implement). Each hands its result back; the page's hooks write it.
// =============================================================================

export function McnDescriptionDialog({ mcn, onClose, onSave }: { mcn: Mcn; onClose: () => void; onSave: (html: string) => void }) {
  const [html, setHtml] = useState(mcn.description);
  return (
    <McnDialog title="Edit description" onClose={onClose} submitLabel="Save" onSubmit={() => { onSave(html); onClose(); }} wide>
      <RichTextEditor value={html} onChange={setHtml} minHeight="10rem" aria-label="Description and/or reason of change" />
    </McnDialog>
  );
}

export function McnScopeDialog({ mcn, onClose, onSave }: { mcn: Mcn; onClose: () => void; onSave: (lines: McnScopeLine[]) => void }) {
  const { data: departments = [] } = useMaintenanceDepartments();
  const [lines, setLines] = useState<McnScopeLine[]>(mcn.scope.map((l) => ({ ...l })));
  return (
    <McnDialog title="Edit departments, processes and equipment" onClose={onClose} submitLabel="Save" onSubmit={() => { onSave(lines); onClose(); }} wide>
      <McnScopeEditor lines={lines} onChange={setLines} departments={departments} />
    </McnDialog>
  );
}

export function McnItemsDialog({
  mcn,
  group,
  onClose,
  onSave,
}: {
  mcn: Mcn;
  group: McnItemGroup;
  onClose: () => void;
  onSave: (items: Record<string, McnItem>) => void;
}) {
  const fields = mcnItemsIn(group);
  const [items, setItems] = useState<Record<string, McnItem>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, { ...(mcn.items[f.key] ?? { answer: "", reference: "" }) }])),
  );
  return (
    <McnDialog
      title={group === "requires" ? "Edit Requires…" : "Edit Incorporate into"}
      onClose={onClose}
      submitLabel="Save"
      onSubmit={() => { onSave(items); onClose(); }}
      wide
    >
      <div className="flex flex-col gap-4">
        {fields.map((f) => (
          <div key={f.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-start">
            <McnField label={f.label} plain>
              <ChoicePills
                label={f.label}
                name={`mcn-item-${f.key}`}
                options={MCN_ANSWERS}
                value={items[f.key].answer}
                onChange={(answer) => setItems((s) => ({ ...s, [f.key]: { ...s[f.key], answer: answer as McnItem["answer"] } }))}
                allowUnset
              />
            </McnField>
            {f.referenceColumn && (
              <McnField label="Reference">
                <input
                  value={items[f.key].reference}
                  onChange={(e) => setItems((s) => ({ ...s, [f.key]: { ...s[f.key], reference: e.target.value } }))}
                  placeholder={f.referenceHint}
                  className="input"
                />
              </McnField>
            )}
          </div>
        ))}
      </div>
    </McnDialog>
  );
}

export function McnDistributionDialog({ mcn, onClose, onSave }: { mcn: Mcn; onClose: () => void; onSave: (roles: string[]) => void }) {
  const [roles, setRoles] = useState<string[]>([...mcn.distribution]);
  return (
    <McnDialog title="Edit distribution" onClose={onClose} submitLabel="Save" onSubmit={() => { onSave(roles); onClose(); }}>
      <McnDistributionChecks value={roles} onChange={setRoles} roles={MCN_DISTRIBUTION_ROLES} />
    </McnDialog>
  );
}

/**
 * Approve and send. The ticked groups' people are prefilled; the approver can
 * remove anybody and add anybody from the staff directory, then approves and
 * sends in one step. The record keeps the final list — and the Implemented
 * email later goes to the same people.
 */
export function McnApproveDialog({
  mcn,
  people,
  me,
  busy,
  onClose,
  onApprove,
}: {
  mcn: Mcn;
  people: Person[];
  me: Person;
  busy: boolean;
  onClose: () => void;
  onApprove: (recipients: Person[]) => void;
}) {
  const { data: groups = [], isLoading } = useMcnDistributionGroups();
  const prefill = useMemo(() => distributionRecipients(groups, mcn.distribution), [groups, mcn.distribution]);
  const [edited, setEdited] = useState<Person[] | null>(null);
  const recipients = edited ?? prefill;
  const unstaffed = emptyDistributionRoles(groups, mcn.distribution);
  const includesMe = recipients.some((p) => personKey(p) === personKey(me));

  function toggle(person: Person) {
    const key = personKey(person);
    setEdited(recipients.some((p) => personKey(p) === key) ? recipients.filter((p) => personKey(p) !== key) : [...recipients, person]);
  }

  return (
    <McnDialog
      title={`Approve ${mcn.mcnNumber}`}
      subtitle="Approving locks the content and emails everyone below."
      busy={busy}
      onClose={onClose}
      submitLabel={`Approve and send to ${recipients.length}`}
      submitDisabled={recipients.length === 0 || isLoading}
      onSubmit={() => onApprove(recipients)}
      wide
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg">
          Ticked for distribution:{" "}
          <span className="font-medium">{mcn.distribution.length ? mcn.distribution.join(", ") : "nothing"}</span>
        </p>
        {unstaffed.length > 0 && (
          <p className="rounded-md border border-ajax-yellow/50 bg-ajax-yellow/10 px-3 py-2 text-sm text-fg">
            Nobody is set up to receive for {unstaffed.join(", ")}. Add the right people below, and ask an MCN admin to
            fill the group in MCN Settings.
          </p>
        )}
        <McnField label="Send to" plain hint={includesMe ? "You won't be emailed yourself — you're the one approving it." : undefined}>
          {isLoading ? (
            <p className="text-sm text-fg-muted">Loading the distribution groups…</p>
          ) : (
            <PersonMultiField
              value={recipients}
              allPeople={people}
              onToggle={toggle}
              emptyLabel="Nobody yet — add someone"
              searchPlaceholder="Add anyone from the staff directory…"
            />
          )}
        </McnField>
      </div>
    </McnDialog>
  );
}

/** Reject or reopen — both need a reason, which goes on the record. */
export function McnReasonDialog({
  mcn,
  action,
  busy,
  onClose,
  onConfirm,
}: {
  mcn: Mcn;
  action: "reject" | "reopen";
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const reject = action === "reject";
  return (
    <McnDialog
      title={reject ? `Reject ${mcn.mcnNumber}` : `Reopen ${mcn.mcnNumber} to Draft`}
      subtitle={
        reject
          ? "It stays on record. The originator and the engineer are emailed the reason."
          : "Its approval no longer applies — it has to be submitted and approved again."
      }
      busy={busy}
      onClose={onClose}
      submitLabel={reject ? "Reject" : "Reopen to Draft"}
      submitDisabled={!reason.trim()}
      onSubmit={() => onConfirm(reason)}
    >
      <McnField label="Reason" required>
        <AutoGrowTextarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          style={{ minHeight: "5rem" }}
          className="input resize-y"
          disabled={busy}
        />
      </McnField>
    </McnDialog>
  );
}

export function McnImplementDialog({
  mcn,
  busy,
  onClose,
  onConfirm,
}: {
  mcn: Mcn;
  busy: boolean;
  onClose: () => void;
  onConfirm: (args: { dateImplemented: Date | null; affected: string }) => void;
}) {
  const [date, setDate] = useState(() => toDateInputValue(mcn.dateImplemented ?? new Date()));
  const [affected, setAffected] = useState(mcn.affected);
  return (
    <McnDialog
      title={`Mark ${mcn.mcnNumber} implemented`}
      subtitle={`The ${mcn.distributedTo.length} people it was sent to are emailed.`}
      busy={busy}
      onClose={onClose}
      submitLabel="Mark implemented"
      submitDisabled={!date}
      onSubmit={() => onConfirm({ dateImplemented: fromDateInputValue(date), affected })}
    >
      <div className="flex flex-col gap-4">
        <McnField label="Date implemented" required plain>
          <DateField value={date} onChange={setDate} disabled={busy} aria-label="Date implemented" />
        </McnField>
        <McnField label="Date codes / serial numbers affected">
          <AutoGrowTextarea
            value={affected}
            onChange={(e) => setAffected(e.target.value)}
            rows={2}
            style={{ minHeight: "3.5rem" }}
            className="input resize-y"
            disabled={busy}
          />
        </McnField>
      </div>
    </McnDialog>
  );
}
