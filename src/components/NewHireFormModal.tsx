import { useMemo, useState } from "react";
import { EMPLOYMENT_TYPES, type EmploymentType, type NewHire, type NewHireInput } from "@/types/hr";
import {
  NEW_HIRE_DEPARTMENT_SUGGESTIONS,
  changedNewHireFields,
  defaultNewHireEmail,
  displayNameFor,
  emptyNewHireInput,
  inputOf,
  missingForSubmit,
} from "@/lib/newHire";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useCreateNewHire, useNewHires, useUpdateNewHire } from "@/hooks/useNewHires";
import { DateField } from "./DateField";
import { ChoicePills } from "./ChoicePills";
import { YesNoField, YES } from "./YesNoField";
import { SuggestInput, distinctValues } from "./SuggestInput";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { HrDialog, HrField, HrPersonPicker } from "./hrAtoms";

// =============================================================================
// New hire — create, and edit the whole record (Tim, 2026-11-17: anyone with
// access edits everything). The HR spreadsheet's columns, in three groups.
//
//   * **Display name and email are worked out from the names** — the
//     spreadsheet's "calculated" columns. Email is a suggestion: it follows the
//     names until somebody types in it (two people can share a name, and IT
//     decides the real address). An edit never re-suggests a saved address.
//   * **The manager is picked from the staff directory**, never typed — that
//     IS their email, so the spreadsheet's calculated Manager Email is gone.
//   * **No browser draft.** Every other create form in ARC keeps one; this one
//     holds personal data, and a shared PC would keep it for a week.
//   * An edit sends only what changed.
// =============================================================================

export function NewHireFormModal({
  hire,
  onClose,
  onCreated,
}: {
  /** Absent = a new hire. */
  hire?: NewHire;
  onClose: () => void;
  onCreated?: (id: number) => void;
}) {
  const editing = !!hire;
  const [draft, setDraft] = useState<NewHireInput>(() => (hire ? inputOf(hire) : emptyNewHireInput()));
  const [emailTouched, setEmailTouched] = useState(editing);
  const [tried, setTried] = useState(false);
  const people = useDirectoryPeople();
  const { data: hires = [] } = useNewHires();
  const create = useCreateNewHire();
  const update = useUpdateNewHire();
  const busy = create.isPending || update.isPending;

  const departments = useMemo(
    () => distinctValues([...NEW_HIRE_DEPARTMENT_SUGGESTIONS, ...hires.map((h) => h.department)]).sort(),
    [hires],
  );
  const deskLocations = useMemo(() => distinctValues(hires.map((h) => h.deskLocation)), [hires]);

  function set<K extends keyof NewHireInput>(key: K, value: NewHireInput[K]) {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      if (!emailTouched && (key === "legalFirstName" || key === "preferredFirstName" || key === "lastName")) {
        next.email = defaultNewHireEmail(next);
      }
      return next;
    });
  }

  const missing = missingForSubmit(draft);
  const displayName = displayNameFor(draft);

  async function submit() {
    setTried(true);
    if (missing.length > 0) return;
    if (hire) {
      const patch = changedNewHireFields(inputOf(hire), draft);
      if (Object.keys(patch).length === 0) return onClose();
      await update.mutateAsync({ id: hire.id, patch });
      onClose();
      return;
    }
    const created = await create.mutateAsync(draft);
    onClose();
    onCreated?.(created.id);
  }

  return (
    <HrDialog
      title={editing ? `Edit ${hire!.displayName || "new hire"}` : "New hire"}
      subtitle={
        editing
          ? undefined
          : "Submitting emails the people who add new hires to SAP and raise the IT ticket, and the manager."
      }
      busy={busy}
      wide
      onClose={onClose}
      submitLabel={editing ? "Save" : "Submit new hire"}
      onSubmit={() => void submit().catch(() => undefined)}
      footerNote={
        tried && missing.length > 0 ? <span className="text-cooper-red">Still needed: {missing.join(", ")}.</span> : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-fg">Person</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <HrField label="Legal first name" required>
              <input
                className="input"
                value={draft.legalFirstName}
                onChange={(e) => set("legalFirstName", e.target.value)}
                autoFocus={!editing}
              />
            </HrField>
            <HrField label="Preferred first name" hint="Only if different.">
              <input className="input" value={draft.preferredFirstName} onChange={(e) => set("preferredFirstName", e.target.value)} />
            </HrField>
            <HrField label="Last name" required>
              <input className="input" value={draft.lastName} onChange={(e) => set("lastName", e.target.value)} />
            </HrField>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <HrField label="Display name" plain hint="From the preferred (else legal) first name and the last name.">
              <div className="flex h-9 items-center rounded-md border border-dashed border-border px-3 text-sm text-fg">
                {displayName || <span className="text-fg-muted">—</span>}
              </div>
            </HrField>
            <HrField
              label="Email"
              required
              hint={emailTouched ? "Typed — it no longer follows the name." : "Follows the name until you type in it."}
            >
              <input
                className="input"
                type="email"
                value={draft.email}
                onChange={(e) => {
                  setEmailTouched(true);
                  set("email", e.target.value);
                }}
              />
            </HrField>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-fg">Job</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <HrField label="Start date" required plain>
              <DateField value={draft.startDate} onChange={(v) => set("startDate", v)} aria-label="Start date" />
            </HrField>
            <HrField label="Job title" required>
              <input className="input" value={draft.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
            </HrField>
            <HrField label="Department" required plain>
              <SuggestInput
                value={draft.department}
                onChange={(v) => set("department", v)}
                options={departments}
                ariaLabel="Department"
              />
            </HrField>
            <HrField label="Manager" required plain hint="Picked from the staff directory.">
              <HrPersonPicker
                value={draft.manager}
                people={people}
                onChange={(p) => set("manager", p)}
                ariaLabel="Manager"
                emptyLabel="Pick the manager"
              />
            </HrField>
          </div>
          <HrField label="Permanent / Intern / Contractor" required plain>
            <ChoicePills
              label="Permanent / Intern / Contractor"
              name="employment-type"
              options={EMPLOYMENT_TYPES}
              value={draft.employmentType ?? ""}
              onChange={(v) => set("employmentType", (v || null) as EmploymentType | null)}
            />
          </HrField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <HrField label="FAB number">
              <input className="input" value={draft.fabNumber} onChange={(e) => set("fabNumber", e.target.value)} />
            </HrField>
            <HrField label="Personal #">
              <input className="input" value={draft.personalNumber} onChange={(e) => set("personalNumber", e.target.value)} />
            </HrField>
            <HrField label="EMP number" hint="Usually filled in once they're in SAP.">
              <input className="input" value={draft.empNumber} onChange={(e) => set("empNumber", e.target.value)} />
            </HrField>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-fg">Equipment and IT</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <HrField label="Computer needed" required plain>
              <YesNoField
                label="Computer needed"
                name="needs-computer"
                noValue="no"
                allowUnset
                value={draft.needsComputer === null ? "" : draft.needsComputer ? YES : "No"}
                onChange={(v) => set("needsComputer", v === "" ? null : v === YES)}
              />
            </HrField>
            <HrField label="Desk location" plain>
              <SuggestInput
                value={draft.deskLocation}
                onChange={(v) => set("deskLocation", v)}
                options={deskLocations}
                ariaLabel="Desk location"
              />
            </HrField>
            <HrField label="Cooper IT ticket #" hint="IT fills this in once it's raised.">
              <input className="input" value={draft.itTicketNumber} onChange={(e) => set("itTicketNumber", e.target.value)} />
            </HrField>
            <HrField label="Ticket link">
              <input
                className="input"
                type="url"
                placeholder="https://…"
                value={draft.itTicketLink}
                onChange={(e) => set("itTicketLink", e.target.value)}
              />
            </HrField>
          </div>
        </section>

        <HrField label="Additional notes">
          <AutoGrowTextarea className="input" value={draft.notes} onChange={(e) => set("notes", e.target.value)} style={{ minHeight: "4rem" }} />
        </HrField>
      </div>
    </HrDialog>
  );
}
