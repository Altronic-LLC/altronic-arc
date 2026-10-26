import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Person } from "@/types/task";
import { MCN_DISTRIBUTION_ROLES, MCN_PRIORITIES, MCN_PRIORITY_MEANINGS, type McnScopeLine } from "@/types/mcn";
import { MCNS_KEY, collectMcnPeople, useCreateMcn, useMcns } from "@/hooks/useMcns";
import { attachmentsKey } from "@/hooks/useAttachments";
import { uploadAttachments } from "@/api/attachments";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useMaintenanceDepartments } from "@/hooks/useMaintenanceReferenceLists";
import { useFormDraft } from "@/hooks/useFormDraft";
import { nextMcnNumber } from "@/lib/mcnNumber";
import { mergePeople } from "@/lib/people";
import { fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import { ChoicePills } from "./ChoicePills";
import { DateField } from "./DateField";
import { DraftRestoredNotice } from "./DraftRestoredNotice";
import { PendingAttachmentsCard } from "./PendingAttachmentsCard";
import { pushToast } from "./Toast";
import { RichTextEditor } from "./RichTextEditor";
import { McnDialog, McnDistributionChecks, McnField, McnPersonPicker, McnScopeEditor, blankScopeLine } from "./McnFields";

// =============================================================================
// New MCN — MFGFRM-021, raised as a DRAFT.
//
// The number is never typed: MCNyy###, the next one for the year from a FRESH
// read at save time (api/mcns.ts). The line under the title previews it from
// the cached register and says so.
//
// Only Process is needed to save a draft. Priority, the assigned engineer and
// the description are needed to SUBMIT it (lib/mcnWorkflow.ts), which happens
// on the MCN's own page, where the Requires… and Incorporate into lines,
// attachments and the discussion also live.
//
// A half-written MCN survives navigating away — the process and description
// are kept as a draft in this browser (useFormDraft). The pickers aren't.
//
// ATTACHMENTS can be added here (supporting data, a test report, photos):
// they're held in memory and uploaded one at a time once the MCN exists — a
// list-item attachment needs an item id. The MCN is real by then, so a file
// that won't upload is a warning naming what to re-add, never a failed create
// (the New EIR form's arrangement). A File can't go in the draft.
// =============================================================================

type DraftFields = { process: string; description: string };
const EMPTY: DraftFields = { process: "", description: "" };

export function McnFormModal({ onClose, onCreated }: { onClose: () => void; onCreated?: (id: number) => void }) {
  const create = useCreateMcn();
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState<{ index: number; name: string } | null>(null);
  const busy = create.isPending || uploading !== null;
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);
  const me = useCurrentUser();
  const directory = useDirectoryPeople();
  const { data: mcns = [] } = useMcns();
  const { data: departments = [] } = useMaintenanceDepartments();

  const draft = useFormDraft<DraftFields>("newMcn");
  const [text, setText] = useState<DraftFields>({ ...EMPTY, ...draft.initial });
  useEffect(() => {
    draft.save(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const [date, setDate] = useState(() => toDateInputValue(new Date()));
  const [priority, setPriority] = useState("");
  const [originatedBy, setOriginatedBy] = useState<Person | null>(me.email ? me : null);
  const [engineer, setEngineer] = useState<Person | null>(null);
  const [scope, setScope] = useState<McnScopeLine[]>([blankScopeLine()]);
  const [distribution, setDistribution] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const people = useMemo(() => mergePeople(collectMcnPeople(mcns), directory, [me]), [mcns, directory, me]);
  const preview = mcns.length > 0 ? nextMcnNumber(mcns.map((m) => m.mcnNumber)) : null;

  async function submit() {
    if (!text.process.trim()) return setError("Process is required — it's the MCN's title in the register.");
    setError(null);
    try {
      const created = await create.mutateAsync({
        date: fromDateInputValue(date),
        process: text.process,
        priority,
        originatedBy,
        assignedEngineer: engineer,
        description: text.description,
        scope,
        distribution,
        watchers: [],
      });
      draft.clear();
      if (files.length > 0) {
        const { failed } = await uploadAttachments("mcn", created.id, files, (index, file) => {
          if (mounted.current) setUploading({ index, name: file.name });
        });
        void qc.invalidateQueries({ queryKey: attachmentsKey("mcn", created.id) });
        void qc.invalidateQueries({ queryKey: MCNS_KEY });
        if (failed.length > 0) {
          pushToast({
            message:
              `${created.mcnNumber} was created, but ${failed.length === 1 ? "this file" : "these files"} didn't upload: ` +
              `${failed.join(", ")}. Add ${failed.length === 1 ? "it" : "them"} again from the MCN's Attachments card.`,
            variant: "error",
          });
        }
      }
      // Left mid-save: the save finished and said so; don't pull them back.
      if (!mounted.current) return;
      onClose();
      onCreated?.(created.id);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : "Couldn't save — try again.");
    } finally {
      if (mounted.current) setUploading(null);
    }
  }

  return (
    <McnDialog
      title="New MCN"
      subtitle={preview ? `Will be ${preview} — confirmed when you save` : "The MCN number is assigned when you save."}
      busy={busy}
      onClose={onClose}
      submitLabel="Save as draft"
      onSubmit={submit}
      wide
    >
      {draft.restored && (
        <div className="mb-4">
          <DraftRestoredNotice
            note="Only the process and description were kept — re-pick the rest."
            onDiscard={() => {
              draft.clear();
              setText({ ...EMPTY });
            }}
            onKeep={draft.dismissNotice}
          />
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <McnField label="Process" required className="sm:col-span-2" hint="A short title — what is changing.">
          <input
            autoFocus
            value={text.process}
            onChange={(e) => setText((t) => ({ ...t, process: e.target.value }))}
            placeholder="e.g. Wave solder flux change"
            className="input"
            disabled={busy}
          />
        </McnField>
        <McnField label="Date" plain>
          <DateField value={date} onChange={setDate} disabled={busy} aria-label="Date" />
        </McnField>
        <McnField label="Priority" plain hint={priority ? MCN_PRIORITY_MEANINGS[priority as keyof typeof MCN_PRIORITY_MEANINGS] : "Level 1 immediate · 2 by next build · 3 at convenience"}>
          <ChoicePills
            label="Priority"
            name="new-mcn-priority"
            options={MCN_PRIORITIES}
            value={priority}
            onChange={setPriority}
            allowUnset
            disabled={busy}
          />
        </McnField>
        <McnField label="Originated by" plain>
          <McnPersonPicker value={originatedBy} people={people} onChange={setOriginatedBy} ariaLabel="Originated by" disabled={busy} />
        </McnField>
        <McnField label="Assigned engineer" plain hint="Needed before it can be submitted.">
          <McnPersonPicker value={engineer} people={people} onChange={setEngineer} ariaLabel="Assigned engineer" disabled={busy} />
        </McnField>
        <McnField label="Description and/or reason of change" plain className="sm:col-span-2">
          <RichTextEditor
            value={text.description}
            onChange={(html) => setText((t) => ({ ...t, description: html }))}
            disabled={busy}
            minHeight="6rem"
            aria-label="Description and/or reason of change"
          />
        </McnField>
        <McnField label="Departments, processes and equipment" plain className="sm:col-span-2">
          <McnScopeEditor lines={scope} onChange={setScope} departments={departments} disabled={busy} />
        </McnField>
        <McnField label="Distribution" plain className="sm:col-span-2" hint="The approver sees these groups' people when approving, and can add or remove anyone.">
          <McnDistributionChecks value={distribution} onChange={setDistribution} roles={MCN_DISTRIBUTION_ROLES} disabled={busy} />
        </McnField>
      </div>
      <PendingAttachmentsCard className="mt-5" files={files} onChange={setFiles} disabled={busy} itemNoun="MCN" />
      {uploading && (
        <p className="mt-3 text-sm text-fg-muted" role="status">
          Uploading {uploading.index + 1} of {files.length}: {uploading.name}…
        </p>
      )}
      {error && <p className="mt-4 text-sm text-cooper-red">{error}</p>}
      <p className="mt-4 text-[11px] text-fg-muted">
        Saved as a <span className="font-semibold">Draft</span>. You, the originator and the engineer watch it. The
        Requires… and Incorporate into lines and the discussion are on the MCN itself.
      </p>
    </McnDialog>
  );
}
