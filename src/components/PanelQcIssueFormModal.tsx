import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, Eye, EyeOff, Loader2, Paperclip, Plus, Printer, Trash2, Upload, X } from "lucide-react";
import { ChoiceSelect } from "./SearchableSelect";
import { DateField } from "./DateField";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { PersonMultiField } from "./PersonMultiField";
import { AttachmentsSection } from "./AttachmentsSection";
import { CommentComposer } from "./CommentComposer";
import { CommentThread } from "./CommentThread";
import { useFileDrop } from "./useFileDrop";
import { fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import {
  useAddPanelQcIssueComment,
  useCreatePanelQcDefect,
  useCreatePanelQcIssue,
  useEditPanelQcIssueComment,
  usePanelQcDefects,
  usePanelQcIssues,
  usePanelQcRepairDefectChoices,
  usePanelQcStatusChoices,
  useSetPanelQcIssueWatchers,
  useUnwatchPanelQcIssue,
  useUpdatePanelQcIssue,
  useWatchPanelQcIssue,
} from "@/hooks/usePanelQcIssues";
import { uploadAttachment } from "@/api/attachments";
import type { Comment, PanelQcIssue, PanelQcIssueInput, Person } from "@/types/task";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople } from "@/lib/people";
import { pushToast } from "./Toast";
import { cn } from "@/lib/cn";

const emptyInput: PanelQcIssueInput = {
  panelSerialNumber: "", panelPartNumber: "", date: null, subComponentPartNumber: "", partDescription: "",
  subComponentSerialNumber: "", defectCategory: null, failureReported: "", panelsResolution: "",
  repairTechnician: "", repairDefectCategory: null, repairIssueFound: "", repairResolution: "",
  status: "Created", watchers: [], tagNumber: "",
};

function localTodayAsSpDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12));
}

interface Props { issue?: PanelQcIssue; onClose: () => void; }

export function PanelQcIssueFormModal({ issue, onClose }: Props) {
  const create = useCreatePanelQcIssue();
  const update = useUpdatePanelQcIssue();
  const addDefect = useCreatePanelQcDefect();
  const { data: defects = [], error: defectsError } = usePanelQcDefects();
  const { data: statusChoices = [] } = usePanelQcStatusChoices();
  const { data: repairDefectChoices = [] } = usePanelQcRepairDefectChoices();
  const { data: allIssues = [] } = usePanelQcIssues();
  const currentUser = useCurrentUser();
  const directory = useDirectoryPeople();
  const setWatchers = useSetPanelQcIssueWatchers();
  const watchIssue = useWatchPanelQcIssue();
  const unwatchIssue = useUnwatchPanelQcIssue();
  const addComment = useAddPanelQcIssueComment();
  const editComment = useEditPanelQcIssueComment();
  const [draft, setDraft] = useState<PanelQcIssueInput>(() => issue ? { ...issue } : { ...emptyInput, date: localTodayAsSpDate() });
  const [error, setError] = useState<string | null>(null);
  const [newDefect, setNewDefect] = useState("");
  const [addingDefect, setAddingDefect] = useState(false);
  // Staged attachments for the New Issue form — there's no item id to attach
  // to until the create actually succeeds, so files wait here and upload
  // right after (see submit() below). Edit mode has a real id already and
  // uses the normal AttachmentsSection instead.
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [savingAttachments, setSavingAttachments] = useState(false);
  const pendingFileInput = useRef<HTMLInputElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const busy = create.isPending || update.isPending || addDefect.isPending || savingAttachments;

  // Live issue — reflects watcher/comment mutations immediately, unlike
  // `draft` (a one-shot snapshot the whole-form Save button writes back).
  const live = issue ? allIssues.find((entry) => entry.id === issue.id) ?? issue : null;

  const mentionCandidates: Person[] = useMemo(() => {
    const map = new Map<string, Person>();
    const note = (p?: Person | null) => {
      if (!p?.displayName) return;
      const key = (p.email ?? p.displayName).toLowerCase();
      if (!map.has(key)) map.set(key, p);
    };
    for (const entry of allIssues) entry.watchers.forEach(note);
    note(currentUser);
    return mergePeople([...map.values()], directory);
  }, [allIssues, currentUser, directory]);

  const draftAllPeople = mergePeople(directory, draft.watchers);

  useEffect(() => { firstFieldRef.current?.focus(); }, []);

  function set<K extends keyof PanelQcIssueInput>(key: K, value: PanelQcIssueInput[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  async function addCategory() {
    if (!newDefect.trim()) return;
    const created = await addDefect.mutateAsync(newDefect);
    set("defectCategory", created.name);
    setNewDefect("");
  }

  function addPendingFiles(files: File[]) {
    if (files.length > 0) setPendingAttachments((prev) => [...prev, ...files]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (issue) {
        await update.mutateAsync({ id: issue.id, input: draft });
      } else {
        const created = await create.mutateAsync(draft);
        if (pendingAttachments.length > 0) {
          setSavingAttachments(true);
          try {
            const results = await Promise.allSettled(
              pendingAttachments.map((file) => uploadAttachment("panelQcIssue", created.id, file)),
            );
            const failed = results.filter((r) => r.status === "rejected").length;
            if (failed > 0) {
              pushToast({
                message: `Issue ${created.tagNumber || created.id} was created, but ${failed} of ${pendingAttachments.length} attachment${pendingAttachments.length > 1 ? "s" : ""} couldn't be uploaded. Open the issue to retry.`,
                variant: "error",
              });
            }
          } finally {
            setSavingAttachments(false);
          }
        }
      }
      onClose();
    } catch { setError("Could not save the issue. The error message above has more detail."); }
  }

  function handleWatcherToggle(person: Person) {
    if (!live) return;
    const key = (person.email ?? person.displayName).toLowerCase();
    const has = live.watchers.some((watcher) => (watcher.email ?? watcher.displayName).toLowerCase() === key);
    const next = has
      ? live.watchers.filter((watcher) => (watcher.email ?? watcher.displayName).toLowerCase() !== key)
      : [...live.watchers, person];
    setWatchers.mutate({ id: live.id, people: next });
  }

  function handleAddComment(bodyHtml: string) {
    if (!live) return;
    addComment.mutate({ id: live.id, comment: { authorName: currentUser.displayName, authorEmail: currentUser.email ?? "", bodyHtml } });
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string, renotify: boolean) {
    if (!live) return;
    await editComment.mutateAsync({ id: live.id, target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail }, newBodyHtml, renotify });
  }

  const isWatching = !!live && live.watchers.some(
    (w) => (w.email ?? "").toLowerCase() === (currentUser.email ?? "").toLowerCase() && !!currentUser.email,
  );

  const footerBar = (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-5 py-3 shadow-sm">
      <div>
        {/* Status has no place on the New Issue form (it always starts
            "Created") — only shown once the issue exists, and bundled into
            the same whole-form Save as everything else rather than an
            immediate-write field like Watchers, since it's a normal part
            of the record rather than a subscription. */}
        {issue && (
          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Status
            <ChoiceSelect value={draft.status} onChange={(value) => set("status", value)} options={statusChoices} emptyLabel="Created" clearable={false} disabled={busy} />
          </label>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50">Cancel</button>
        <button type="submit" form="panel-qc-issue-form" disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-60">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{issue ? "Save changes" : "Add issue"}</button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 py-5 sm:px-6 sm:py-8">
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-5 py-3 shadow-sm">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
          <ClipboardCheck className="h-4 w-4 text-accent" />
          {issue ? <><span>Edit Panel QC Issue</span><span className="ml-2 font-mono text-xs font-normal text-fg-muted">{issue.tagNumber || "No TAG"}</span></> : "New Panel QC Issue"}
          {live && <span className="ml-2 text-xs font-normal text-fg-muted">Current Status: <span className="font-semibold text-fg">{live.status || "Created"}</span></span>}
        </h2>
        <div className="flex items-center gap-1">
          {live && (
            <button
              type="button"
              onClick={() => (isWatching ? unwatchIssue.mutate({ id: live.id, person: currentUser }) : watchIssue.mutate({ id: live.id, person: currentUser }))}
              className={cn(
                "mr-1 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                isWatching ? "border-accent bg-accent/10 text-accent hover:bg-accent/20" : "border-border bg-surface text-fg hover:bg-surface-2",
              )}
              title={isWatching ? "You'll receive email updates about this issue" : "Add yourself to the watchers list"}
            >
              {isWatching ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {isWatching ? "Watching" : "Watch"}
            </button>
          )}
          <button type="button" onClick={() => issue && window.open(`${import.meta.env.BASE_URL}panels/qc-issues/${issue.id}/print`, "_blank", "noopener,noreferrer")} disabled={busy || !issue} title="Print 2 × 2 label" aria-label="Print 2 × 2 label" className="rounded-md p-1 text-fg-muted hover:bg-surface-2 disabled:opacity-50"><Printer className="h-4 w-4" /></button>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="rounded-md p-1 text-fg-muted hover:bg-surface-2 disabled:opacity-50"><X className="h-4 w-4" /></button>
        </div>
      </div>

      {/* `contents` keeps the cards below as direct siblings in this column's
          layout, while still being ONE <form> — so Enter-to-submit and the
          single Save/Add button (linked by `form=` further down) cover every
          department's fields together. Split into Panel Department / Repair
          Department to match the SharePoint columns each department owns
          (renamed 2026-09-03 — see CLAUDE.md) and the Watchers/Attachments/
          Communication cards below. */}
      <form id="panel-qc-issue-form" onSubmit={submit} className="contents">
        <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
          <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Panel Department</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Panel Serial Number"><input ref={firstFieldRef} value={draft.panelSerialNumber} onChange={(e) => set("panelSerialNumber", e.target.value)} className="input" /></Field>
            <Field label="Panel Part Number"><input value={draft.panelPartNumber} onChange={(e) => set("panelPartNumber", e.target.value)} className="input" /></Field>
            <Field label="Date"><DateField value={toDateInputValue(draft.date)} onChange={(value) => set("date", fromDateInputValue(value))} disabled={busy} /></Field>
            <Field label="Defect Category" action={<button type="button" onClick={() => { setAddingDefect((open) => !open); setNewDefect(""); }} disabled={busy} aria-label={addingDefect ? "Cancel adding defect category" : "Add defect category"} title={addingDefect ? "Cancel" : "Add defect category"} className="rounded-md p-0.5 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50">{addingDefect ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}</button>}>
              <ChoiceSelect value={draft.defectCategory ?? ""} onChange={(value) => set("defectCategory", value || null)} options={defects.map((defect) => defect.name)} emptyLabel="Not set" disabled={busy} />
              {defectsError && <p className="mt-1 text-xs font-normal normal-case tracking-normal text-cooper-red">Could not load defect categories.</p>}
              {addingDefect && <div className="mt-2 flex flex-wrap gap-2"><input value={newDefect} onChange={(e) => setNewDefect(e.target.value)} placeholder="New category" className="input min-w-0 flex-1" disabled={busy} /><button type="button" onClick={addCategory} disabled={busy || !newDefect.trim()} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-fg hover:bg-surface-2 disabled:opacity-50"><Plus className="h-3.5 w-3.5" />Add</button><button type="button" onClick={() => { setAddingDefect(false); setNewDefect(""); }} disabled={busy} className="rounded-md border border-border px-2.5 text-xs font-medium text-fg-muted hover:bg-surface-2 disabled:opacity-50">Cancel</button></div>}
            </Field>
            <Field label="Sub Component Part Number"><input value={draft.subComponentPartNumber} onChange={(e) => set("subComponentPartNumber", e.target.value)} className="input" /></Field>
            <Field label="Sub Component Serial Number"><input value={draft.subComponentSerialNumber} onChange={(e) => set("subComponentSerialNumber", e.target.value)} className="input" /></Field>
            <Field label="Part Description"><input value={draft.partDescription} onChange={(e) => set("partDescription", e.target.value)} className="input" /></Field>
            {/* Watchers are create-only here — once the issue exists, the live
                Watch button + card below own that field so a mention-driven
                auto-watch can't be clobbered by this draft going stale. */}
            {!issue && <Field label="Watchers"><PersonMultiField value={draft.watchers} allPeople={draftAllPeople} onToggle={(person) => set("watchers", draft.watchers.some((watcher) => (watcher.email ?? watcher.displayName) === (person.email ?? person.displayName)) ? draft.watchers.filter((watcher) => (watcher.email ?? watcher.displayName) !== (person.email ?? person.displayName)) : [...draft.watchers, person])} emptyLabel="No watchers" searchPlaceholder="Search people…" /></Field>}
            <Field label="Failure Reported" className="sm:col-span-2"><AutoGrowTextarea value={draft.failureReported} onChange={(e) => set("failureReported", e.target.value)} rows={3} className="input resize-y" /></Field>
            <Field label="Panels Resolution" className="sm:col-span-2"><AutoGrowTextarea value={draft.panelsResolution} onChange={(e) => set("panelsResolution", e.target.value)} rows={3} className="input resize-y" /></Field>
          </div>
        </div>

        {/* Hidden on the New Issue form (Ray, 2026-09-03) — the repair team
            fills this in once the panel department has raised the issue and
            it exists to be repaired. */}
        {issue && (
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Repair Department</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Repair Technician"><input value={draft.repairTechnician} onChange={(e) => set("repairTechnician", e.target.value)} className="input" /></Field>
              <Field label="Repair Defect Category">
                <ChoiceSelect value={draft.repairDefectCategory ?? ""} onChange={(value) => set("repairDefectCategory", value || null)} options={repairDefectChoices} emptyLabel="Not set" disabled={busy} />
              </Field>
              <Field label="Repair Issue Found" className="sm:col-span-2"><AutoGrowTextarea value={draft.repairIssueFound} onChange={(e) => set("repairIssueFound", e.target.value)} rows={2} className="input resize-y" /></Field>
              <Field label="Repair Resolution" className="sm:col-span-2"><AutoGrowTextarea value={draft.repairResolution} onChange={(e) => set("repairResolution", e.target.value)} rows={2} className="input resize-y" /></Field>
            </div>
          </div>
        )}
      </form>

      {error && <p className="text-sm text-cooper-red">{error}</p>}

      {/* Edit mode keeps the Save bar right after the form, same as before.
          New Issue mode moves it below Attachments (Ray, 2026-09-03) — see
          `footerBar` below, rendered in two different spots. */}
      {issue && footerBar}

      {/* New Issue: no item id exists yet, so files are staged locally and
          uploaded right after the create succeeds (see submit() above). */}
      {!issue && (
        <PendingAttachmentsCard
          files={pendingAttachments}
          onAdd={addPendingFiles}
          onRemove={(index) => setPendingAttachments((prev) => prev.filter((_, i) => i !== index))}
          disabled={busy}
          fileInputRef={pendingFileInput}
        />
      )}

      {!issue && footerBar}

      {live && (
        <>
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Watchers</h2>
            <PersonMultiField value={live.watchers} allPeople={mentionCandidates} onToggle={handleWatcherToggle} emptyLabel="Nobody is watching this issue" searchPlaceholder="Search people…" />
          </div>

          <AttachmentsSection parent="panelQcIssue" itemId={live.id} />

          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Communication</h2>
            <CommentComposer onSubmit={handleAddComment} mentionablePeople={mentionCandidates} />
            <div className="mt-5">
              <CommentThread
                comments={live.comments}
                currentUserEmail={currentUser.email}
                currentUserName={currentUser.displayName}
                mentionablePeople={mentionCandidates}
                onEdit={handleEditComment}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, required, className = "", action, children }: { label: string; required?: boolean; className?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <label className={`flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-fg-muted ${className}`}><span className="flex items-center justify-between">{label}{required && <span className="text-cooper-red"> *</span>}{action}</span>{children}</label>;
}

/**
 * A lightweight stand-in for AttachmentsSection, for the New Issue form —
 * that component needs a real item id to talk to SharePoint's attachment
 * store, which doesn't exist until the create succeeds. Files picked here
 * are held in memory only and uploaded by submit() once the new issue's id
 * is known; there's no drag-and-drop paste-image naming flow (unlike the
 * real AttachmentsSection) to keep this scoped to what a brand-new record
 * actually needs.
 */
function PendingAttachmentsCard({
  files,
  onAdd,
  onRemove,
  disabled,
  fileInputRef,
}: {
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  disabled: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
}) {
  const { dragging, dropProps } = useFileDrop(onAdd, disabled);
  return (
    <div {...dropProps} className={cn("rounded-lg border bg-surface p-4 sm:p-5", dragging ? "border-accent ring-2 ring-accent/30" : "border-border")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          <Paperclip className="h-4 w-4" />
          Attachments
          {files.length > 0 && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold tabular-nums text-fg">{files.length}</span>}
        </h2>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:border-fg-muted disabled:opacity-50">
          <Upload className="h-3.5 w-3.5" />Add file
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { onAdd(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </div>
      {files.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-fg-muted">
          No files yet. Drag files here or click "Add file" — they'll upload once you save this issue.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="truncate text-fg">{file.name}</span>
              <button type="button" onClick={() => onRemove(index)} disabled={disabled} aria-label={`Remove ${file.name}`} className="shrink-0 rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
