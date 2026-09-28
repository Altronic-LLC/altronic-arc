import { useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, Cpu, ExternalLink, FileText, History, Info, Loader2, Lock, Pencil, Trash2, Upload, X } from "lucide-react";
import { deletionReason, isDeletedPart, partEvent } from "@/lib/partLifecycle";
import { useDatasheet, useUploadDatasheet } from "@/hooks/useDatasheet";
import { datasheetFileName, datasheetFileProblem } from "@/api/datasheets";
import { describeListWriteFailure, isPermissionDenied } from "@/lib/listWriteErrors";
import { DetailTopBar } from "@/components/DetailTopBar";
import { PartKindChip, PartsDataGate, SignOffChip } from "@/components/partsAtoms";
import { FieldEditModal, type EditableFieldSpec } from "@/components/FieldEditModal";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { pushToast } from "@/components/Toast";
import { useOverlayDismiss } from "@/components/useOverlayDismiss";
import {
  useAltronicComponent,
  useAltronicPart,
  useApproveAltronicComponent,
  useApproveAltronicPart,
  useDeleteAltronicComponent,
  useDeleteAltronicPart,
  useUpdateAltronicComponent,
  useUpdateAltronicPart,
} from "@/hooks/useAltronicParts";
import { useMyPartsAccess } from "@/hooks/usePartsRoles";
import { partPrefix } from "@/lib/altronicPartMapper";
import { ratingLabelsFor } from "@/lib/componentRatings";
import {
  COMPONENT_FIELDS,
  PART_FIELDS,
  displayValue,
  formValues,
  isRequired,
  patchFromForm,
  type PartFieldSpec,
} from "@/lib/partFields";
import { approvalStepLabel, approveGate, deletePartGate, editPartGate, nextSignOff, type PartsGate } from "@/lib/partsRoles";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import type { AltronicComponent, AltronicPart, Comment, ItemAuthor } from "@/types/task";

// =============================================================================
// One Altronic part — `/engineering/parts/part/:id` (Part List) or
// `/engineering/parts/component/:id` (Component List). Keyed by the SharePoint
// item id rather than the part number: the legacy data held duplicated part
// numbers, and a page that can only ever show one of two is a page that hides
// the other.
//
// The page READS; each card's Edit button writes (FieldEditModal), the house
// rule for detail pages. Who may edit and approve comes from Parts Roles
// (lib/partsRoles.ts) — the same gate the mutation re-checks.
//
// An edit does NOT send a part back for approval (Tim, 2026-09-28); the SAP
// admins are emailed what changed instead. Approving a step records who, when
// and any comment in the part's history.
// =============================================================================

export function PartDetailView() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const itemId = Number(id);
  if (kind === "component") return <ComponentDetail id={itemId} />;
  if (kind === "part") return <PartDetail id={itemId} />;
  return (
    <DetailShell>
      <NotFound />
    </DetailShell>
  );
}

function PartDetail({ id }: { id: number }) {
  const query = useAltronicPart(id);
  const part = query.part;
  return (
    <DetailShell>
      <PartsDataGate queries={[query]} listNames="Altronic Part List" noun="part">
        {!part ? <NotFound /> : isDeletedPart(part) ? <DeletedNotice part={part} /> : <PartBody part={part} />}
      </PartsDataGate>
    </DetailShell>
  );
}

function ComponentDetail({ id }: { id: number }) {
  const query = useAltronicComponent(id);
  const component = query.component;
  return (
    <DetailShell>
      <PartsDataGate queries={[query]} listNames="Altronic Component List" noun="component">
        {!component ? (
          <NotFound />
        ) : isDeletedPart(component) ? (
          <DeletedNotice part={component} />
        ) : (
          <ComponentBody component={component} />
        )}
      </PartsDataGate>
    </DetailShell>
  );
}

/**
 * A link to a DELETED part number — from an old email, a bookmark, a search
 * result somebody sent. Says so, rather than showing a page of blanks or
 * "not found": the number exists, it's just free to be used again.
 */
function DeletedNotice({ part }: { part: { partNumber: string; comments: Comment[] } }) {
  const record = partEvent(part.comments, "deleted");
  const reason = record ? deletionReason(record) : "";
  const prefix = partPrefix(part.partNumber);
  return (
    <section className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-fg-muted">
      <Trash2 className="mx-auto mb-3 h-6 w-6" />
      <p className="font-mono text-lg font-semibold text-fg">{part.partNumber}</p>
      <p className="mt-1 font-medium text-fg">This part number was deleted.</p>
      {record && (
        <p className="mt-1">
          Deleted by {record.authorName || record.authorEmail} on {record.timestamp.toLocaleDateString()}.
        </p>
      )}
      {reason && <p className="mx-auto mt-2 max-w-md whitespace-pre-wrap italic">“{reason}”</p>}
      <p className="mx-auto mt-3 max-w-md">
        The number is free to reuse: <strong className="text-fg">Next free</strong> on a new part in
        {prefix ? ` list ${prefix}` : " its list"} offers it before a new number.
      </p>
      {prefix && (
        <Link to={`/engineering/parts/list/${prefix}`} className="mt-3 inline-block text-accent hover:underline">
          Open list {prefix}
        </Link>
      )}
    </section>
  );
}

function DetailShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Parts List" listTo="/engineering/parts" />
      {children}
    </div>
  );
}

function NotFound() {
  return (
    <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-fg-muted">
      <p className="font-medium text-fg">That part isn't on the list.</p>
      <p className="mt-1">
        It may have been removed, or the link is out of date.{" "}
        <Link to="/engineering/parts/search" className="text-accent hover:underline">
          Search for it
        </Link>
        .
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Editing, shared by both kinds
// -----------------------------------------------------------------------------

type AnySpec = PartFieldSpec<Record<string, unknown>>;

function toEditable(spec: AnySpec, label: string): EditableFieldSpec {
  const kind = spec.kind === "multiline" ? "multiline" : spec.kind;
  return { key: spec.key, label, kind, choices: spec.choices };
}

/** A card's fields in an edit modal, refusing to blank a required one. */
function useCardEditor<T>(record: T, specs: PartFieldSpec<T>[], save: (patch: Partial<T>) => void) {
  const [editing, setEditing] = useState<string | null>(null);
  const values = formValues(specs, record);

  function modal(labelFor: (spec: PartFieldSpec<T>) => string) {
    if (!editing) return null;
    const cardSpecs = specs.filter((s) => s.card === editing);
    return (
      <FieldEditModal
        title={`Edit ${editing}`}
        fields={cardSpecs.map((s) => toEditable(s as unknown as AnySpec, labelFor(s)))}
        values={values}
        onClose={() => setEditing(null)}
        onSave={(changed) => {
          // FieldEditModal can't know which fields are required, so it is
          // refused here rather than written as a blank a later reader trips on.
          const merged = { ...values, ...changed };
          const blanked = cardSpecs.filter((s) => s.key in changed && isRequired(s, merged) && !changed[s.key].trim());
          if (blanked.length > 0) {
            pushToast({
              message: `${blanked.map((s) => s.label).join(", ")} can't be left blank — nothing was saved.`,
              variant: "error",
            });
            return;
          }
          save(patchFromForm(cardSpecs, changed));
        }}
      />
    );
  }
  return { editing, setEditing, modal };
}

// -----------------------------------------------------------------------------

function PartBody({ part }: { part: AltronicPart }) {
  const access = useMyPartsAccess();
  const edit = editPartGate(access, false);
  const update = useUpdateAltronicPart();
  const approve = useApproveAltronicPart();
  const remove = useDeleteAltronicPart();
  const cards = useCardEditor(part, PART_FIELDS, (patch) => update.mutate({ id: part.id, patch }));

  const field = (key: keyof AltronicPart, mono?: boolean) => {
    const spec = PART_FIELDS.find((s) => s.key === key)!;
    return <Field key={key} label={spec.label} value={displayValue(spec, part[key])} mono={mono} />;
  };

  return (
    <>
      <Heading
        partNumber={part.partNumber}
        description={part.description}
        kindLabel="Part List"
        signOffStatus={part.signOffStatus}
      />
      <ApprovalPanel
        status={part.signOffStatus}
        pending={approve.isPending}
        onApprove={(comment) => approve.mutate({ id: part.id, expected: part.signOffStatus ?? "", comment })}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Part" onEdit={edit.allowed ? () => cards.setEditing("Part") : undefined}>
          {field("description")}
        </Card>
        <Card title="Drawing" onEdit={edit.allowed ? () => cards.setEditing("Drawing") : undefined}>
          {field("dateAssigned")}
          {field("assignedBy")}
          {field("drawingSize")}
          {field("dateDrawing")}
          {field("prototypeOrProduction")}
        </Card>
        <Card title="Purchasing" onEdit={edit.allowed ? () => cards.setEditing("Purchasing") : undefined}>
          {field("purchased")}
          {field("manufacturer")}
          {field("mfgPartNumber", true)}
          {field("sapNumber", true)}
          {field("itemValue")}
          {/* The Part List has no Has Data Sheet column, so the folder is the
              whole answer here (Tim, 2026-09-28). */}
          <DatasheetField partNumber={part.partNumber} canUpload={edit.allowed} />
        </Card>
        <NotesCard notes={part.notes} onEdit={edit.allowed ? () => cards.setEditing("Notes") : undefined} />
        <HistoryCard comments={part.comments} />
        <RecordCard
          signOffStatus={part.signOffStatus}
          legacySource={part.legacySource}
          createdBy={part.createdBy}
          createdAt={part.createdAt}
          modifiedAt={part.modifiedAt}
          editGate={edit}
          remove={{
            partNumber: part.partNumber,
            pending: remove.isPending,
            onConfirm: (reason) => remove.mutate({ id: part.id, partNumber: part.partNumber, reason }, { onSuccess: deletedToast }),
          }}
        />
      </div>
      {cards.modal((s) => s.label)}
    </>
  );
}

function ComponentBody({ component }: { component: AltronicComponent }) {
  const access = useMyPartsAccess();
  const edit = editPartGate(access, true);
  const update = useUpdateAltronicComponent();
  const approve = useApproveAltronicComponent();
  const remove = useDeleteAltronicComponent();
  const cards = useCardEditor(component, COMPONENT_FIELDS, (patch) => update.mutate({ id: component.id, patch }));
  const labels = ratingLabelsFor(component.description);

  const field = (key: keyof AltronicComponent, mono?: boolean) => {
    const spec = COMPONENT_FIELDS.find((s) => s.key === key)!;
    return <Field key={key} label={spec.label} value={displayValue(spec, component[key])} mono={mono} />;
  };

  return (
    <>
      <Heading
        partNumber={component.partNumber}
        description={component.description}
        kindLabel={component.category ?? "Component"}
        signOffStatus={component.signOffStatus}
      />
      <ApprovalPanel
        status={component.signOffStatus}
        pending={approve.isPending}
        onApprove={(comment) =>
          approve.mutate({ id: component.id, expected: component.signOffStatus ?? "", comment })
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Part" onEdit={edit.allowed ? () => cards.setEditing("Part") : undefined}>
          {field("description")}
        </Card>
        <Card title="Manufacturer" onEdit={edit.allowed ? () => cards.setEditing("Manufacturer") : undefined}>
          {field("mfgName")}
          {field("mfgNumber", true)}
          <DatasheetField
            partNumber={component.partNumber}
            flagged={component.hasDataSheet}
            canUpload={edit.allowed}
            componentId={component.id}
          />
        </Card>
        <Card
          title="Ratings"
          onEdit={edit.allowed ? () => cards.setEditing("Ratings") : undefined}
          note={
            labels.component
              ? `What each rating means for a ${labels.component.toLowerCase()}, from the HCO entry rules.`
              : "This description doesn't name a component type the entry rules cover, so the ratings keep their generic names."
          }
        >
          <RatingField letter="A" meaning={labels.a} value={component.ratingA} />
          <RatingField letter="B" meaning={labels.b} value={component.ratingB} />
          <RatingField letter="C" meaning={labels.c} value={component.ratingC} />
          {field("tolerance")}
          {field("tempMin")}
          {field("tempMax")}
          {field("footprint")}
        </Card>
        <NotesCard notes={component.notes} onEdit={edit.allowed ? () => cards.setEditing("Notes") : undefined} />
        <HistoryCard comments={component.comments} />
        <RecordCard
          signOffStatus={component.signOffStatus}
          legacySource={component.legacySource}
          createdBy={component.createdBy}
          createdAt={component.createdAt}
          modifiedAt={component.modifiedAt}
          editGate={edit}
          remove={{
            partNumber: component.partNumber,
            pending: remove.isPending,
            onConfirm: (reason) =>
              remove.mutate({ id: component.id, partNumber: component.partNumber, reason }, { onSuccess: deletedToast }),
          }}
        />
      </div>
      {cards.modal((s) => {
        const letter = s.key === "ratingA" ? "a" : s.key === "ratingB" ? "b" : s.key === "ratingC" ? "c" : null;
        const meaning = letter ? labels[letter] : null;
        return letter && meaning && labels.component ? `${s.label} — ${meaning}` : s.label;
      })}
    </>
  );
}

// -----------------------------------------------------------------------------
// Approval
// -----------------------------------------------------------------------------

function ApprovalPanel({
  status,
  pending,
  onApprove,
}: {
  status: string | null;
  pending: boolean;
  onApprove: (comment: string) => void;
}) {
  const access = useMyPartsAccess();
  const [open, setOpen] = useState(false);
  const next = nextSignOff(status);
  if (!next) return null;
  const gate = approveGate(access, status);
  const waitingOn = status === "Pending Engineering Review" ? "an engineering review" : "the SAP admin";

  return (
    <section className="mb-4 flex flex-col gap-2 rounded-xl border border-ajax-yellow/50 bg-ajax-yellow/10 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-fg">Waiting on {waitingOn}.</p>
        <p className="text-fg-muted">
          {status === "Pending Engineering Review"
            ? "Check what was entered, correct anything wrong with Edit, then approve — the SAP admin is next."
            : "Add the part to SAP if it's needed, then approve it."}
        </p>
        {!gate.allowed && gate.hint && <p className="mt-1 text-[11px] text-fg-muted">{gate.hint}</p>}
      </div>
      {gate.allowed && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={pending}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Approve
        </button>
      )}
      {open && (
        <ApproveDialog
          step={approvalStepLabel(status)}
          next={next}
          onClose={() => setOpen(false)}
          onConfirm={(comment) => {
            setOpen(false);
            onApprove(comment);
          }}
        />
      )}
    </section>
  );
}

function ApproveDialog({
  step,
  next,
  onClose,
  onConfirm,
}: {
  step: string;
  next: string;
  onClose: () => void;
  onConfirm: (comment: string) => void;
}) {
  const [comment, setComment] = useState("");
  const overlayDismiss = useOverlayDismiss(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" {...overlayDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Approve"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-semibold text-fg">{step}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-fg-muted hover:bg-surface-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          className="flex flex-col gap-3 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(comment);
          }}
        >
          <p className="text-sm text-fg-muted">
            The part moves to <strong className="text-fg">{next}</strong>. Your name, the time and any comment go in its
            history.
          </p>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Comment (optional)
            </span>
            <AutoGrowTextarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              style={{ minHeight: "5rem" }}
              className="input resize-y"
              placeholder="What you changed and why, if anything"
              autoFocus
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-1.5 text-sm text-fg hover:bg-surface-2">
              Cancel
            </button>
            <button type="submit" className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-accent/90">
              Approve
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Presentation
// -----------------------------------------------------------------------------

function Heading({
  partNumber,
  description,
  kindLabel,
  signOffStatus,
}: {
  partNumber: string;
  description: string;
  kindLabel: string;
  signOffStatus: string | null;
}) {
  const prefix = partPrefix(partNumber);
  return (
    <header className="mb-4 flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
        <Cpu className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <h1 className="font-mono text-xl font-semibold text-fg sm:text-2xl">{partNumber || "(no part number)"}</h1>
        <p className="text-sm text-fg">{description || "No description"}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {prefix && (
            <Link
              to={`/engineering/parts/list/${prefix}`}
              className="inline-flex rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-fg-muted hover:border-fg-muted hover:text-fg"
              title={`Open list ${prefix}`}
            >
              List {prefix}
            </Link>
          )}
          <PartKindChip label={kindLabel} />
          <SignOffChip status={signOffStatus} showUntracked />
        </div>
      </div>
    </header>
  );
}

function CardHeader({ title, onEdit }: { title: string; onEdit?: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{title}</h2>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${title}`}
          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-accent hover:bg-surface-2"
        >
          <Pencil className="h-3 w-3" />
          Edit
        </button>
      )}
    </div>
  );
}

function Card({
  title,
  note,
  onEdit,
  children,
}: {
  title: string;
  note?: string;
  onEdit?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <CardHeader title={title} onEdit={onEdit} />
      {note && <p className="px-4 pt-2 text-[11px] text-fg-muted">{note}</p>}
      <dl className="divide-y divide-border px-4">{children}</dl>
    </section>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-fg-muted">{label}</dt>
      <dd className={mono ? "break-all text-right font-mono text-fg" : "text-right text-fg"}>{value || "—"}</dd>
    </div>
  );
}

/**
 * A part's datasheet — found by looking for `<part #>.pdf` in the Datasheets
 * folder, not by trusting a component's Has Data Sheet flag, which is wrong
 * both ways on hundreds of parts (see api/datasheets.ts). When the two
 * disagree the page says so, so the flag can be put right.
 *
 * `flagged` is undefined on a Part List part: that list has no flag column,
 * so there is nothing for the folder to disagree with.
 */
function DatasheetField({
  partNumber,
  flagged,
  canUpload,
  componentId,
}: {
  partNumber: string;
  flagged?: boolean;
  /** The edit gate — only an editor sees Upload. */
  canUpload: boolean;
  /** Set for a component, whose Has Data Sheet flag the upload turns on. */
  componentId?: number;
}) {
  const { data: sheet, isLoading, error } = useDatasheet(partNumber);
  const upload = useUploadDatasheet();
  const picker = useRef<HTMLInputElement>(null);
  let value: ReactNode;
  let note: string | null = null;

  function send(file: File) {
    const problem = datasheetFileProblem(file);
    if (problem) {
      pushToast({ message: problem, variant: "error" });
      return;
    }
    upload.mutate(
      { partNumber, file, via: "edit", componentId },
      {
        onSuccess: ({ flagError }) => {
          pushToast(
            flagError
              ? { message: `The datasheet uploaded, but Has Data Sheet couldn't be set: ${flagError}`, variant: "error" }
              : { message: `${datasheetFileName(partNumber)} uploaded.` },
          );
        },
        onError: (err) => {
          pushToast({
            message: describeListWriteFailure(err, {
              action: "upload the datasheet",
              site: "Altronic_Engineering",
              permission: "editing",
            }),
            variant: "error",
          });
        },
      },
    );
  }
  if (isLoading) {
    value = <span className="text-fg-muted">Checking…</span>;
  } else if (error) {
    value = <span className="text-fg-muted">Couldn't check</span>;
    note = isPermissionDenied(error)
      ? "Your account can't open the Datasheets folder in the Altronic_Engineering documents library."
      : "The Datasheets folder couldn't be read just now — reload to try again.";
  } else if (sheet) {
    value = (
      <a
        href={sheet.webUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
      >
        <FileText className="h-3.5 w-3.5" />
        Open datasheet
        <ExternalLink className="h-3 w-3" />
      </a>
    );
    if (flagged === false) note = `${sheet.name} is in the Datasheets folder, though Has Data Sheet is set to No.`;
  } else {
    value = canUpload ? (
      <>
        <input
          ref={picker}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          aria-label="Datasheet PDF"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) send(file);
          }}
        />
        <button
          type="button"
          onClick={() => picker.current?.click()}
          disabled={upload.isPending}
          className="inline-flex items-center gap-1 font-medium text-accent hover:underline disabled:opacity-60"
        >
          {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {upload.isPending ? "Uploading…" : "Upload datasheet"}
        </button>
      </>
    ) : (
      "No"
    );
    if (flagged) note = `Has Data Sheet is set to Yes, but there's no ${datasheetFileName(partNumber)} in the Datasheets folder.`;
  }
  return (
    <div className="py-2 text-sm">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="shrink-0 text-fg-muted">Datasheet</dt>
        <dd className="text-right text-fg">{value}</dd>
      </div>
      {note && <p className="mt-1 text-right text-[11px] text-fg-muted">{note}</p>}
    </div>
  );
}

/** A rating with what it means for this component, when that is known. */
function RatingField({ letter, meaning, value }: { letter: string; meaning: string | null; value: string }) {
  const unused = meaning === null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-fg-muted">
        {unused ? `Rating ${letter}` : meaning}
        {!unused && meaning !== `Rating ${letter}` && <span className="ml-1 text-[11px]">(Rating {letter})</span>}
      </dt>
      <dd className="text-right text-fg">{value || (unused ? "Not used" : "—")}</dd>
    </div>
  );
}

function NotesCard({ notes, onEdit }: { notes: string; onEdit?: () => void }) {
  return (
    <section className="rounded-xl border border-border bg-surface md:col-span-2">
      <CardHeader title="Notes" onEdit={onEdit} />
      <p className="whitespace-pre-wrap px-4 py-3 text-sm text-fg">{notes || "—"}</p>
    </section>
  );
}

/** Who approved what, and when — written by the Approve button. */
function HistoryCard({ comments }: { comments: Comment[] }) {
  if (comments.length === 0) return null;
  return (
    <section className="rounded-xl border border-border bg-surface md:col-span-2">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <History className="h-3.5 w-3.5 text-fg-muted" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Approval history</h2>
      </div>
      <ol className="divide-y divide-border">
        {comments.map((c, i) => (
          <li key={`${c.timestamp.getTime()}-${i}`} className="px-4 py-3 text-sm">
            <div className="text-xs text-fg-muted">
              <span className="font-medium text-fg">{c.authorName || c.authorEmail}</span> ·{" "}
              {c.timestamp.toLocaleString()}
            </div>
            <div
              className="prose-sm mt-1 text-fg [&_p]:my-1"
              // Stored HTML, sanitised on the way to the DOM like every other
              // comment body in ARC.
              dangerouslySetInnerHTML={{ __html: sanitiseHtml(c.bodyHtml) }}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

function deletedToast(deleted: { partNumber: string }) {
  pushToast({ message: `${deleted.partNumber} was deleted. Next free will offer it for a new part.` });
}

interface RemoveProps {
  partNumber: string;
  pending: boolean;
  onConfirm: (reason: string) => void;
}

function RecordCard({
  signOffStatus,
  legacySource,
  createdBy,
  createdAt,
  modifiedAt,
  editGate,
  remove,
}: {
  signOffStatus: string | null;
  legacySource: string;
  createdBy: ItemAuthor | null;
  createdAt: Date;
  modifiedAt: Date;
  editGate: PartsGate;
  remove: RemoveProps;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface md:col-span-2">
      <CardHeader title="Record" />
      <dl className="divide-y divide-border px-4">
        <Field label="Sign-off status" value={signOffStatus ?? "Not tracked"} />
        <Field label="Loaded from" value={legacySource || "Added in ARC"} mono={!!legacySource} />
        {/* A loaded row's creator is the account that ran the load, which says
            nothing about who assigned the number — so it isn't shown there. */}
        {!legacySource && <Field label="Submitted by" value={createdBy?.displayName ?? ""} />}
        <Field label="Created" value={createdAt.toLocaleString()} />
        <Field label="Last changed" value={modifiedAt.toLocaleString()} />
      </dl>
      {!signOffStatus && legacySource && (
        <p className="flex items-start gap-1.5 px-4 pb-3 text-[11px] text-fg-muted">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" />
          This part came across from the old Parts List app, which didn't record approvals, so it has no sign-off
          status.
        </p>
      )}
      {!editGate.allowed && !editGate.resolving && editGate.hint && (
        <p className="flex items-start gap-1.5 px-4 pb-3 text-[11px] text-fg-muted">
          <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
          {editGate.hint}
        </p>
      )}
      <DeletePartControl {...remove} />
    </section>
  );
}

/**
 * Delete a part number — the SAP admin's alone, and HIDDEN from everybody
 * else rather than greyed (the ECN / Teradyne delete arrangement): the page is
 * read by the whole company. The gate is asked again inside the mutation.
 */
function DeletePartControl({ partNumber, pending, onConfirm }: RemoveProps) {
  const access = useMyPartsAccess();
  const [open, setOpen] = useState(false);
  if (!deletePartGate(access).allowed) return null;
  return (
    <div className="border-t border-border px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-cooper-red/40 px-3 py-1.5 text-sm font-medium text-cooper-red hover:bg-cooper-red/5 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        Delete part number
      </button>
      {open && (
        <DeleteDialog
          partNumber={partNumber}
          onClose={() => setOpen(false)}
          onConfirm={(reason) => {
            setOpen(false);
            onConfirm(reason);
          }}
        />
      )}
    </div>
  );
}

function DeleteDialog({
  partNumber,
  onClose,
  onConfirm,
}: {
  partNumber: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const overlayDismiss = useOverlayDismiss(onClose);
  // Typing the number back is the confirmation: a reused number changes what
  // it means to every drawing, BOM and SAP record that points at it.
  const ready = reason.trim().length > 0 && typed.trim().toLowerCase() === partNumber.trim().toLowerCase();
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" {...overlayDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Delete part number"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-semibold text-fg">Delete {partNumber}?</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-fg-muted hover:bg-surface-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          className="flex flex-col gap-3 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) onConfirm(reason.trim());
          }}
        >
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
            <li>Every field is cleared, and the part leaves every list and search.</li>
            <li>
              The number is <strong className="text-fg">reused</strong>: Next free offers it for the next new part in
              its list. Anything that still points at {partNumber} — a drawing, a BOM, SAP — will then mean that part.
            </li>
            <li>Its datasheet, if any, is moved to Datasheets/Deleted.</li>
            <li>Your name, the time and the reason are kept in its history.</li>
          </ul>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Reason <span className="text-cooper-red">*</span>
            </span>
            <AutoGrowTextarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              style={{ minHeight: "4rem" }}
              className="input resize-y"
              placeholder="e.g. Raised by mistake — never built or bought"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Type {partNumber} to confirm
            </span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} className="input font-mono" aria-label="Confirm part number" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-1.5 text-sm text-fg hover:bg-surface-2">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!ready}
              className="rounded-md bg-cooper-red px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-cooper-red/90 disabled:opacity-50"
            >
              Delete part number
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
