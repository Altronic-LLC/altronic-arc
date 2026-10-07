import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Megaphone, X } from "lucide-react";
import type { Person, ScnInput } from "@/types/task";
import { SCN_APPROVAL_STATUSES, SCN_CATEGORIES } from "@/types/task";
import { collectScnPeople, useCreateScn, useScns } from "@/hooks/useScns";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useProjects } from "@/hooks/useTasks";
import { scnProjectOptions } from "@/lib/scnProjects";
import { useFormDraft } from "@/hooks/useFormDraft";
import { scnFieldLabel } from "@/lib/scnFields";
import { nextScnNumber } from "@/lib/scnNumber";
import { mergePeople, personKey } from "@/lib/people";
import { ChoiceSelect } from "./SearchableSelect";
import { ChoicePills } from "./ChoicePills";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { PersonMultiField } from "./PersonMultiField";
import { DraftRestoredNotice } from "./DraftRestoredNotice";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// New SCN.
//
// Only what's needed to RAISE one: the product, what the notice is about, who
// is on it, and the part numbers if known. The review checklists, dates,
// disposition and notes are filled in later, on the SCN's own page.
//
// The SCN# is never typed — it is `YYYY-NNNN`, the next number after the
// highest four-digit sequence on the list (lib/scnNumber.ts), computed by the
// API from a fresh read at save time. The line under the title shows what it
// will be, from the cached list, so the person raising it knows the number
// before they press Save. SCN Status starts as WIP and isn't asked for.
//
// Approval Status is REQUIRED by the SharePoint column, so the pills carry no
// "Not set" option: SharePoint refuses a blank, and offering one here would
// turn every save into an error.
// =============================================================================

interface ScnFormModalProps {
  onClose: () => void;
  onCreated?: (id: number) => void;
}

/** The free-text columns the form asks for, by descriptor key. */
const TEXT_KEYS = ["description", "customer", "oldNumber", "sapNumber", "partDescription"] as const;
type TextKey = (typeof TEXT_KEYS)[number];
type DraftFields = Record<"product" | TextKey, string>;

const EMPTY_DRAFT: DraftFields = {
  product: "",
  description: "",
  customer: "",
  oldNumber: "",
  sapNumber: "",
  partDescription: "",
};

export function ScnFormModal({ onClose, onCreated }: ScnFormModalProps) {
  const create = useCreateScn();
  const busy = create.isPending;
  const currentUser = useCurrentUser();
  const directory = useDirectoryPeople();
  const { data: scns = [] } = useScns();
  const { data: projects = [] } = useProjects();

  // Create-only, so a draft can never overwrite a real record. Text only —
  // the pickers and the two person fields are cheap to re-choose.
  const draft = useFormDraft<DraftFields>("newScn");
  const [text, setText] = useState<DraftFields>({ ...EMPTY_DRAFT, ...draft.initial });
  useEffect(() => {
    draft.save(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const [category, setCategory] = useState("");
  // Picked from Engineering's Project References, stored as the title.
  const [projectReference, setProjectReference] = useState("");
  const [approvalStatus, setApprovalStatus] = useState("");
  const [assignedTo, setAssignedTo] = useState<Person[]>([]);
  const [owner, setOwner] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Everyone already on an SCN plus the tenant directory plus whoever is
  // signed in — the same funnel every people picker in ARC goes through.
  const people = useMemo(
    () => mergePeople(collectScnPeople(scns), directory, [currentUser]),
    [scns, directory, currentUser],
  );

  // From the CACHED titles — the API recomputes from a fresh read on save, so
  // this is a preview, and says so when the list hasn't loaded yet.
  const previewNumber = scns.length > 0 ? nextScnNumber(scns.map((s) => s.scnNumber)) : null;

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const overlayDismiss = useOverlayDismiss(onClose, busy);

  function setField(key: keyof DraftFields, value: string) {
    setText((prev) => ({ ...prev, [key]: value }));
  }

  function toggle(list: Person[], setList: (next: Person[]) => void, person: Person) {
    const key = personKey(person);
    setList(
      list.some((p) => personKey(p) === key)
        ? list.filter((p) => personKey(p) !== key)
        : [...list, person],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.product.trim()) return setError("Product is required.");
    if (!text.description.trim()) return setError("Description is required.");
    if (!approvalStatus) return setError("Approval Status is required — pick Approved or Denied.");
    setError(null);

    const values: Record<string, string> = {};
    for (const key of TEXT_KEYS) values[key] = text[key];
    if (projectReference) values.projectReference = projectReference;
    const input: ScnInput = {
      product: text.product,
      category,
      approvalStatus,
      assignedTo,
      owner,
      values,
    };
    try {
      const created = await create.mutateAsync(input);
      // The record exists now, so the draft must go.
      draft.clear();
      onClose();
      onCreated?.(created.id);
    } catch {
      setError("Couldn't save — see the message above the page, and try again.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New SCN"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
              <Megaphone className="h-4 w-4 text-accent" />
              New SCN
            </h2>
            <p className="text-[11px] text-fg-muted">
              {previewNumber
                ? `SCN# will be ${previewNumber}`
                : "The SCN# is assigned on save."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form id="scn-form" onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {draft.restored && (
            <div className="mb-4">
              <DraftRestoredNotice
                note="Only the text fields were kept — re-pick the category, approval and people."
                onDiscard={() => {
                  draft.clear();
                  setText({ ...EMPTY_DRAFT });
                }}
                onKeep={draft.dismissNotice}
              />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={scnFieldLabel("product")} required>
              <input
                ref={firstFieldRef}
                value={text.product}
                onChange={(e) => setField("product", e.target.value)}
                placeholder="e.g. DD-40NTS"
                className="input"
                disabled={busy}
              />
            </Field>

            <Field label={scnFieldLabel("category")}>
              <ChoiceSelect
                value={category}
                onChange={setCategory}
                options={SCN_CATEGORIES}
                emptyLabel="Not set"
                disabled={busy}
              />
            </Field>

            <Field label={scnFieldLabel("description")} required className="sm:col-span-2">
              <AutoGrowTextarea
                style={{ minHeight: "5rem" }}
                value={text.description}
                onChange={(e) => setField("description", e.target.value)}
                rows={3}
                placeholder="What the notice is about, and what has to be decided"
                className="input resize-y"
                disabled={busy}
              />
            </Field>

            {/* Two options and REQUIRED — pills, with no Not set. */}
            <Field label={scnFieldLabel("approvalStatus")} required plain>
              <ChoicePills
                label={scnFieldLabel("approvalStatus")}
                name="new-scn-approval-status"
                options={SCN_APPROVAL_STATUSES}
                value={approvalStatus}
                onChange={setApprovalStatus}
                disabled={busy}
              />
            </Field>

            <Field label={scnFieldLabel("projectReference")} plain>
              <ChoiceSelect
                value={projectReference}
                onChange={setProjectReference}
                options={scnProjectOptions(projects, projectReference)}
                emptyLabel="Not set"
                ariaLabel={scnFieldLabel("projectReference")}
                searchPlaceholder="Search Engineering projects…"
                disabled={busy}
              />
            </Field>

            <Field label={scnFieldLabel("customer")}>
              <input
                value={text.customer}
                onChange={(e) => setField("customer", e.target.value)}
                className="input"
                disabled={busy}
              />
            </Field>

            {/* Pill groups and person pickers label themselves; a <label>
                wrapping them would nest labels and steal the click. */}
            <Field label={scnFieldLabel("assignedTo")} plain>
              <PersonMultiField
                value={assignedTo}
                allPeople={people}
                onToggle={(p) => toggle(assignedTo, setAssignedTo, p)}
                emptyLabel="Nobody yet"
              />
            </Field>

            <Field label={scnFieldLabel("owner")} plain>
              <PersonMultiField
                value={owner}
                allPeople={people}
                onToggle={(p) => toggle(owner, setOwner, p)}
                emptyLabel="Nobody yet"
              />
            </Field>

            <Field label={scnFieldLabel("oldNumber")}>
              <AutoGrowTextarea
                style={{ minHeight: "3.5rem" }}
                value={text.oldNumber}
                onChange={(e) => setField("oldNumber", e.target.value)}
                rows={2}
                placeholder="One part number per line"
                className="input resize-y"
                disabled={busy}
              />
            </Field>

            <Field label={scnFieldLabel("sapNumber")}>
              <AutoGrowTextarea
                style={{ minHeight: "3.5rem" }}
                value={text.sapNumber}
                onChange={(e) => setField("sapNumber", e.target.value)}
                rows={2}
                placeholder="One SAP number per line"
                className="input resize-y"
                disabled={busy}
              />
            </Field>

            <Field label={scnFieldLabel("partDescription")} className="sm:col-span-2">
              <AutoGrowTextarea
                style={{ minHeight: "3.5rem" }}
                value={text.partDescription}
                onChange={(e) => setField("partDescription", e.target.value)}
                rows={2}
                className="input resize-y"
                disabled={busy}
              />
            </Field>
          </div>

          {error && <p className="mt-4 text-sm text-cooper-red">{error}</p>}

          <p className="mt-4 text-[11px] text-fg-muted">
            Starts as <span className="font-semibold">WIP</span>. You, the assignees and the
            owners are added as watchers. The review checklists, dates, disposition,
            attachments and comments are added on the SCN itself.
          </p>
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="scn-form"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Raise SCN
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  className,
  plain,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  /** Render a <div> instead of a <label> — for controls that label themselves. */
  plain?: boolean;
  children: React.ReactNode;
}) {
  const Wrapper = plain ? "div" : "label";
  return (
    <Wrapper className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-1 text-cooper-red">*</span>}
      </span>
      {children}
    </Wrapper>
  );
}
