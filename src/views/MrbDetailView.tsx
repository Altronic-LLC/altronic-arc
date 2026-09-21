import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Archive, ClipboardX, Pencil, TriangleAlert } from "lucide-react";
import {
  collectMrbPeople,
  useAddMrbComment,
  useEditMrbComment,
  useMrbEntries,
  useMrbEntry,
  useSetMrbWatchers,
  useUpdateMrbEntry,
} from "@/hooks/useMrb";
import { mrbWatchersAvailable } from "@/api/mrb";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useCommentFileUpload } from "@/hooks/useAttachments";
import { mergePeople } from "@/lib/people";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { PersonMultiField } from "@/components/PersonMultiField";
import type { Comment, MrbEntry, MrbEntryInput, Person } from "@/types/task";
import { MRB_DISPOSITIONS, MRB_WHERE_CAUSED } from "@/types/task";
import {
  expectedPricePerIssue,
  formatMoney,
  formatQuantity,
  isArchivedMrbEntry,
  mrbEntryInput,
  pricePerIssueDisagrees,
} from "@/lib/mrbMapper";
import {
  MRB_FIELD_BY_KEY,
  mrbChoiceOptions,
  provenanceToShow,
} from "@/lib/mrbFields";
import { formatSpDate, fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import {
  FieldEditModal,
  type EditableFieldSpec,
} from "@/components/FieldEditModal";
import { MrbArchiveChip, MrbDispositionChip } from "@/components/mrbAtoms";

// =============================================================================
// One MRB entry.
//
// The page READS and each card's Edit button WRITES, through the shared
// `FieldEditModal` — the house rule, and here it does real work: the modal
// hands back ONLY the fields that changed, which is what keeps the 734 rows
// holding an undeclared choice value saveable at all (see `buildMrbFields`).
//
// There is no comment thread and no watchers anywhere on this page: the list
// has neither column. `field_11`, labelled "Comments", is a plain notes field
// and lives on the Nonconformance card with everything else.
// =============================================================================

type CardId = "Part" | "Nonconformance" | "Cost";

/** A field's user-facing label, from the one table that owns it. */
function label(key: string): string {
  return MRB_FIELD_BY_KEY[key].label;
}

export function MrbDetailView() {
  const { id } = useParams<{ id: string }>();
  const entryId = id ? parseInt(id, 10) : null;
  const { data: entry, isLoading } = useMrbEntry(entryId);
  const { data: entries = [] } = useMrbEntries();
  const update = useUpdateMrbEntry();
  const currentUser = useCurrentUser();
  const directory = useDirectoryPeople();
  const addComment = useAddMrbComment();
  const editComment = useEditMrbComment();
  const setWatchers = useSetMrbWatchers();
  // Called above the early returns below — a hook cannot be conditional, and
  // it takes a nullable id for exactly this.
  const uploadCommentFile = useCommentFileUpload("mrb", entryId);
  const [editing, setEditing] = useState<CardId | null>(null);

  const mentionCandidates = useMemo(
    () => mergePeople(directory, collectMrbPeople(entries), [currentUser]),
    [directory, entries, currentUser],
  );

  // False only once a read has actually been refused for the column — see
  // api/mrb.ts. Until the script has been run the picker says so rather
  // than offering a control whose save can only fail.
  const watchersReady = mrbWatchersAvailable();

  // Archive rows only — see provenanceToShow. A live entry has no source
  // workbook worth explaining, even though it carries a row number.
  const provenance = useMemo(() => (entry ? provenanceToShow(entry) : []), [entry]);

  if (isLoading) return <LoadingTasks noun="this MRB entry" />;

  if (!entry) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <DetailTopBar category="MRB" listTo="/supply-chain/mrb" />
        <p className="text-sm text-fg-muted">MRB entry not found.</p>
      </div>
    );
  }

  const archived = isArchivedMrbEntry(entry);

  function saveCard(changed: Record<string, string>) {
    if (!entry) return;
    update.mutate({ id: entry.id, input: applyChanges(entry, changed) });
  }

  function handleAddComment(bodyHtml: string) {
    if (!entry) return;
    addComment.mutate({
      id: entry.id,
      comment: {
        authorName: currentUser.displayName,
        authorEmail: currentUser.email ?? "",
        bodyHtml,
      },
    });
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string) {
    if (!entry) return;
    await editComment.mutateAsync({
      id: entry.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      bodyHtml: newBodyHtml,
      previousBodyHtml: comment.bodyHtml,
    });
  }

  /** Add or remove one watcher — the picker toggles, the write replaces. */
  function handleWatcherToggle(person: Person) {
    if (!entry) return;
    const key = (person.email ?? person.displayName).toLowerCase();
    const watching = entry.watchers.some(
      (w) => (w.email ?? w.displayName).toLowerCase() === key,
    );
    const people = watching
      ? entry.watchers.filter((w) => (w.email ?? w.displayName).toLowerCase() !== key)
      : [...entry.watchers, person];
    setWatchers.mutate({ id: entry.id, people });
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="MRB" listTo="/supply-chain/mrb" />

      <header className="mb-5 flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
          <ClipboardX className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            {entry.sapNumber || `MRB #${entry.id}`}
          </h1>
          <p className="text-sm text-fg-muted">
            {entry.description || entry.reason || "No description"}
            {entry.mrbDate && ` · ${formatSpDate(entry.mrbDate)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {archived && <MrbArchiveChip />}
          <MrbDispositionChip disposition={entry.disposition} archived={archived} />
        </div>
      </header>

      {archived && (
        <p className="mb-5 flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted">
          <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Retained history imported from the old Excel workbooks — not a live
            entry. It is kept so it stays searchable. Editing it is possible but
            rarely what you want.
          </span>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Labels come from the descriptor table, never hand-typed here —
            the list, this card and the Edit modal all read the same string,
            so renaming a field can't leave two screens disagreeing about
            what it's called. */}
        <Card title="Part" onEdit={() => setEditing("Part")}>
          <Row label={label("sapNumber")} value={entry.sapNumber} />
          <Row label={label("oldPartNumber")} value={entry.oldPartNumber} />
          <Row label={label("description")} value={entry.description} />
          <Row label={label("vendorName")} value={entry.vendorName} />
          <Row label={label("mrbDate")} value={formatSpDate(entry.mrbDate)} />
        </Card>

        <Card title="Nonconformance" onEdit={() => setEditing("Nonconformance")}>
          <Row label={label("reason")} value={entry.reason} multiline />
          <Row label={label("whereCaused")} value={entry.whereCaused} />
          <Row
            label={label("disposition")}
            node={
              <MrbDispositionChip disposition={entry.disposition} archived={archived} />
            }
          />
          <Row label={label("notes")} value={entry.notes} multiline />
        </Card>

        <Card title="Cost" onEdit={() => setEditing("Cost")}>
          <Row label={label("quantity")} value={formatQuantity(entry.quantity)} />
          <Row label={label("pricePerUnit")} value={formatMoney(entry.pricePerUnit)} />
          <Row
            label={label("pricePerIssue")}
            node={
              <span className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums">{formatMoney(entry.pricePerIssue)}</span>
                {pricePerIssueDisagrees(entry) && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] text-cooper-red"
                    title="Price Per Unit × Quantity gives a different total. Both figures are shown as stored — nothing has been recalculated."
                  >
                    <TriangleAlert className="h-3 w-3" />
                    unit × qty ={" "}
                    {formatMoney(
                      expectedPricePerIssue(entry.pricePerUnit, entry.quantity),
                    )}
                  </span>
                )}
              </span>
            }
          />
        </Card>

        {/* A direct grid child, so it fills the cell beside Cost rather than
            sitting full-width underneath — the Cost card is short and left an
            obvious hole to its right (Tim, 2026-09-21). NOT wrapped in a card
            of its own: AttachmentsSection already draws one, and nesting them
            renders a box inside a box. */}
        <AttachmentsSection parent="mrb" itemId={entry.id} />

        {provenance.length > 0 && (
          <Card title="From the source workbook">
            <p className="mb-2 text-[11px] text-fg-muted">
              Read-only. These columns came from the Excel import and ARC never
              writes them.
            </p>
            {provenance.map((field) => (
              <Row
                key={field.key}
                label={field.label}
                value={entry.provenance[field.key] ?? ""}
                multiline={field.kind === "multiline"}
              />
            ))}
          </Card>
        )}
      </div>

      <section className="mt-4 rounded-xl border border-border bg-surface p-4 sm:p-5">
        {/* "Discussion", not "Comments" — the ONE page in ARC where the
            thread isn't called Comments, because `field_11`'s own SharePoint
            label is "Comments" and it renders as a field on the
            Nonconformance card above. Two things called Comments on one page,
            one of which notifies people and one of which doesn't, is a trap;
            a test query tripped over the same ambiguity. */}
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          Discussion
        </h2>

        {/* Watchers gets its OWN row, not a slot in the header's right-hand
            corner. The dropdown panel is `absolute left-0 right-0` — exactly
            as wide as its trigger (see SearchableSelect) — so a chip-sized
            trigger truncated every name in a 200+ person directory to
            "Aaron P…" (Tim, 2026-09-21). Gray Market gets away with the same
            control only because its sidebar is wide. */}
        <div className="mb-4 max-w-md">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Watchers
          </span>
          {watchersReady ? (
            <PersonMultiField
              value={entry.watchers}
              allPeople={mentionCandidates}
              onToggle={handleWatcherToggle}
              emptyLabel="No watchers"
            />
          ) : (
            <span
              className="text-xs text-fg-muted"
              title="The MRB list has no Watchers column yet — run scripts/add-mrb-watchers-column.ps1. Comments still post and still notify anyone @-mentioned."
            >
              Not set up yet
            </span>
          )}
        </div>
        <CommentComposer
          draftKey={`mrb:${entryId}`}
          uploadFile={uploadCommentFile}
          onSubmit={handleAddComment}
          mentionablePeople={mentionCandidates}
        />
        <div className="mt-5">
          <CommentThread
            uploadFile={uploadCommentFile}
            comments={entry.comments}
            currentUserEmail={currentUser.email}
            currentUserName={currentUser.displayName}
            mentionablePeople={mentionCandidates}
            onEdit={handleEditComment}
          />
        </div>
      </section>

      {editing && (
        <FieldEditModal
          title={`Edit ${editing}`}
          fields={editableFields(editing, entry)}
          values={editableValues(editing, entry)}
          busy={update.isPending}
          onClose={() => setEditing(null)}
          onSave={saveCard}
        />
      )}
    </div>
  );
}

/**
 * The fields on one card, as `FieldEditModal` specs.
 *
 * The two choice fields go through `mrbChoiceOptions`, which keeps whatever
 * this row already holds in the option list. Without it, a row carrying
 * `"Unclassified (Legacy)"` — not one of its own column's declared choices —
 * shows as blank in the picker and gets silently reassigned on save.
 */
function editableFields(card: CardId, entry: MrbEntry): EditableFieldSpec[] {
  const spec = (key: string, extra: Partial<EditableFieldSpec> = {}): EditableFieldSpec => {
    const field = MRB_FIELD_BY_KEY[key];
    return {
      key,
      label: field.label,
      kind:
        field.kind === "currency"
          ? "number"
          : field.kind === "choice"
            ? "choice"
            : field.kind,
      hint: field.hint,
      ...extra,
    };
  };

  if (card === "Part") {
    return [
      spec("sapNumber"),
      spec("oldPartNumber"),
      spec("description"),
      spec("vendorName"),
      spec("mrbDate"),
    ];
  }
  if (card === "Nonconformance") {
    return [
      spec("reason"),
      spec("whereCaused", {
        choices: mrbChoiceOptions(MRB_WHERE_CAUSED, entry.whereCaused),
      }),
      spec("disposition", {
        choices: mrbChoiceOptions(MRB_DISPOSITIONS, entry.disposition),
      }),
      spec("notes"),
    ];
  }
  return [
    spec("quantity"),
    spec("pricePerUnit"),
    spec("pricePerIssue", {
      hint: `Price Per Unit × Quantity = ${formatMoney(
        expectedPricePerIssue(entry.pricePerUnit, entry.quantity),
      )}. Saved exactly as typed.`,
    }),
  ];
}

/** Current values for one card, as the modal's string map. */
function editableValues(card: CardId, entry: MrbEntry): Record<string, string> {
  const num = (v: number | null) => (v === null ? "" : String(v));
  if (card === "Part") {
    return {
      sapNumber: entry.sapNumber,
      oldPartNumber: entry.oldPartNumber,
      description: entry.description,
      vendorName: entry.vendorName,
      mrbDate: toDateInputValue(entry.mrbDate),
    };
  }
  if (card === "Nonconformance") {
    return {
      reason: entry.reason,
      whereCaused: entry.whereCaused,
      disposition: entry.disposition,
      notes: entry.notes,
    };
  }
  return {
    quantity: num(entry.quantity),
    pricePerUnit: num(entry.pricePerUnit),
    pricePerIssue: num(entry.pricePerIssue),
  };
}

/**
 * Fold a card's changed values back into a whole `MrbEntryInput`.
 *
 * The API diffs this against the row it started from, so sending the whole
 * shape here is safe — and is what lets one modal edit any card without each
 * one needing its own patch builder.
 *
 * An emptied number box is `null` ("not recorded"), never 0 — deliberately
 * not `Number(v) || null`, which would also turn a genuine 0 into null.
 */
export function applyChanges(
  entry: MrbEntry,
  changed: Record<string, string>,
): MrbEntryInput {
  const input = mrbEntryInput(entry);
  const num = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  };

  for (const [key, value] of Object.entries(changed)) {
    switch (key) {
      case "mrbDate":
        input.mrbDate = fromDateInputValue(value);
        break;
      case "quantity":
        input.quantity = num(value);
        break;
      case "pricePerUnit":
        input.pricePerUnit = num(value);
        break;
      case "pricePerIssue":
        input.pricePerIssue = num(value);
        break;
      default:
        if (key in input) {
          (input as unknown as Record<string, string>)[key] = value;
        }
    }
  }
  return input;
}

function Card({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="font-display text-sm font-semibold text-fg">{title}</h2>
        {onEdit && (
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        )}
      </div>
      <dl className="divide-y divide-border">{children}</dl>
    </section>
  );
}

function Row({
  label,
  value,
  node,
  multiline,
}: {
  label: string;
  value?: string;
  node?: React.ReactNode;
  multiline?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 px-4 py-2 text-sm">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </dt>
      <dd className={`col-span-2 text-fg ${multiline ? "whitespace-pre-wrap" : ""}`}>
        {node ?? (value ? value : <span className="text-fg-muted">—</span>)}
      </dd>
    </div>
  );
}
