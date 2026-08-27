import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DollarSign, Pencil, User } from "lucide-react";
import {
  collectCostImpactNoticePeople,
  useAddCostImpactNoticeComment,
  useCostImpactNotice,
  useCostImpactNotices,
  useEditCostImpactNoticeComment,
  useUpdateCostImpactNoticeFields,
} from "@/hooks/useCostImpactNotices";
import type { Comment, CostImpactNotice } from "@/types/task";
import { COST_IMPACT_TIMES } from "@/types/task";
import { looksLikeHtml } from "@/lib/descriptionChecklist";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import { toPlainTextForEditing, toStoredRichText } from "@/lib/richText";
import { mergePeople } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { FieldEditModal, type EditableFieldSpec } from "@/components/FieldEditModal";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { CostImpactDeltaChip } from "@/components/costImpactAtoms";

// =============================================================================
// One Cost Impact Notice.
//
// Part → Cost & Impact → Where Used, one card each, plus Notes. Every card
// edits through the shared FieldEditModal, and the page itself is read-only —
// the same "one Edit button per card" arrangement as Gray Market and ECNs.
//
// The comment thread is the SAME narrower rule ECNs use, and the page says so
// out loud: there are no watchers on this list, so a comment reaches the
// person who raised the notice and anyone @-mentioned. The fixed intake list
// (Keith Brooks, Ray White, David Bell, Matthew Traina, Mark Balent, Katie
// Fleming by default) is told once, on create — see useCostImpactNotices.ts —
// which is a separate mechanism from this comment thread.
// =============================================================================

type Card = "Part" | "Cost & Impact" | "Where Used" | "Notes";

export function CostImpactNoticeDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const noticeId = id ? parseInt(id, 10) : null;
  const { data: notice, isLoading } = useCostImpactNotice(noticeId);
  const { data: notices = [] } = useCostImpactNotices();
  const currentUser = useCurrentUser();
  const directory = useDirectoryPeople();

  const updateFields = useUpdateCostImpactNoticeFields();
  const addComment = useAddCostImpactNoticeComment();
  const editComment = useEditCostImpactNoticeComment();

  const mentionCandidates = useMemo(
    () => mergePeople(collectCostImpactNoticePeople(notices), directory),
    [notices, directory],
  );

  const [editing, setEditing] = useState<Card | null>(null);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <LoadingTasks noun="the cost impact notice" />
      </div>
    );
  }

  if (!notice) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-10 text-center sm:px-6">
        <p className="text-sm text-fg-muted">That cost impact notice doesn't exist.</p>
        <button
          onClick={() => navigate("/supply-chain/cost-impact-notices")}
          className="mt-3 text-sm text-accent underline-offset-2 hover:underline"
        >
          Back to Cost Impact Notices
        </button>
      </div>
    );
  }

  function save(fields: Record<string, unknown>, patch: (n: CostImpactNotice) => CostImpactNotice) {
    if (!notice) return;
    updateFields.mutate({ id: notice.id, fields, patch });
  }

  function savePart(changed: Record<string, string>) {
    const fields: Record<string, unknown> = {};
    if ("title" in changed) fields.Title = changed.title.trim();
    if ("supplier" in changed) fields.Supplier = changed.supplier.trim();
    if ("sapNumber" in changed) fields.SAPNumber = changed.sapNumber.trim();
    if ("oldPartNumber" in changed) fields.OldPartNumber = changed.oldPartNumber.trim();
    if ("mpn" in changed) fields.MPN = changed.mpn.trim();
    if ("eau" in changed) fields.EAU = changed.eau.trim();
    if ("bpReference" in changed) fields.BPReference = changed.bpReference.trim();
    save(fields, (n) => ({
      ...n,
      title: "title" in changed ? changed.title.trim() : n.title,
      supplier: "supplier" in changed ? changed.supplier.trim() : n.supplier,
      sapNumber: "sapNumber" in changed ? changed.sapNumber.trim() : n.sapNumber,
      oldPartNumber: "oldPartNumber" in changed ? changed.oldPartNumber.trim() : n.oldPartNumber,
      mpn: "mpn" in changed ? changed.mpn.trim() : n.mpn,
      eau: "eau" in changed ? changed.eau.trim() : n.eau,
      bpReference: "bpReference" in changed ? changed.bpReference.trim() : n.bpReference,
    }));
  }

  function saveCost(changed: Record<string, string>) {
    const fields: Record<string, unknown> = {};
    if ("originalCost" in changed) fields.OriginalCost = changed.originalCost.trim();
    if ("newCost" in changed) fields.NewCost = changed.newCost.trim();
    if ("timeOfImpact" in changed)
      fields.TimeofImpact = changed.timeOfImpact || null;
    if ("usedOnPanels" in changed) fields.Panels = changed.usedOnPanels || null;
    save(fields, (n) => {
      const next: CostImpactNotice = {
        ...n,
        originalCost: "originalCost" in changed ? changed.originalCost.trim() : n.originalCost,
        newCost: "newCost" in changed ? changed.newCost.trim() : n.newCost,
        timeOfImpact:
          "timeOfImpact" in changed
            ? ((changed.timeOfImpact || null) as CostImpactNotice["timeOfImpact"])
            : n.timeOfImpact,
        usedOnPanels:
          "usedOnPanels" in changed
            ? ((changed.usedOnPanels || null) as CostImpactNotice["usedOnPanels"])
            : n.usedOnPanels,
      };
      // Mirror SharePoint's own calculated column client-side so the sidebar
      // doesn't show a stale delta until the next refetch lands.
      const original = parseFloat(next.originalCost);
      const updated = parseFloat(next.newCost);
      next.deltaCost = Number.isFinite(original) && Number.isFinite(updated) ? updated - original : null;
      return next;
    });
  }

  function saveWhereUsed(changed: Record<string, string>) {
    if (!("whereUsed" in changed)) return;
    save({ WhereUsed: toStoredRichText(changed.whereUsed) }, (n) => ({ ...n, whereUsed: changed.whereUsed }));
  }

  function saveNotes(changed: Record<string, string>) {
    if (!("notes" in changed)) return;
    save({ Comments: changed.notes.trim() }, (n) => ({ ...n, notes: changed.notes.trim() }));
  }

  function handleAddComment(bodyHtml: string) {
    if (!notice) return;
    addComment.mutate({
      id: notice.id,
      comment: { authorName: currentUser.displayName, authorEmail: currentUser.email ?? "", bodyHtml },
    });
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string) {
    if (!notice) return;
    await editComment.mutateAsync({
      id: notice.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      bodyHtml: newBodyHtml,
      previousBodyHtml: comment.bodyHtml,
    });
  }

  const submitter = notice.submittedBy?.displayName;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Cost Impact Notices" listTo="/supply-chain/cost-impact-notices" />

      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <DollarSign className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            {notice.title || `Cost Impact Notice #${notice.id}`}
          </h1>
          <p className="text-sm text-fg-muted">
            {notice.sapNumber ? `SAP ${notice.sapNumber}` : "No SAP number"}
            {notice.supplier ? ` · ${notice.supplier}` : ""}
          </p>
        </div>
        <CostImpactDeltaChip deltaCost={notice.deltaCost} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
                Part
              </h2>
              <EditButton label="Part" onClick={() => setEditing("Part")} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FieldRow label="Title" value={notice.title} />
              <FieldRow label="Supplier" value={notice.supplier} />
              <FieldRow label="SAP Number" value={notice.sapNumber} />
              <FieldRow label="Old Part Number" value={notice.oldPartNumber} />
              <FieldRow label="MPN" value={notice.mpn} />
              <FieldRow label="EAU" value={notice.eau} />
              <FieldRow label="BP Reference" value={notice.bpReference} />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
                Cost &amp; Impact
              </h2>
              <EditButton label="Cost & Impact" onClick={() => setEditing("Cost & Impact")} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FieldRow label="Original Cost" value={formatCost(notice.originalCost)} />
              <FieldRow label="New Cost" value={formatCost(notice.newCost)} />
              <FieldRow
                label="Delta Cost"
                value={notice.deltaCost !== null ? formatCost(notice.deltaCost.toFixed(2)) : ""}
              />
              <FieldRow label="Time of Impact" value={notice.timeOfImpact ?? ""} />
              <FieldRow label="Used on Panels" value={notice.usedOnPanels ?? ""} />
              <FieldRow label="Year Issued" value={notice.yearIssued} />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
                Where Used
              </h2>
              <EditButton label="Where Used" onClick={() => setEditing("Where Used")} />
            </div>
            {notice.whereUsed ? (
              looksLikeHtml(notice.whereUsed) ? (
                <div
                  className="comment-html text-sm leading-relaxed text-fg"
                  dangerouslySetInnerHTML={{ __html: sanitiseHtml(notice.whereUsed) }}
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm text-fg">{notice.whereUsed}</p>
              )
            ) : (
              <p className="text-sm text-fg-muted">Not set</p>
            )}
          </section>

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
                Notes
              </h2>
              <EditButton label="Notes" onClick={() => setEditing("Notes")} />
            </div>
            {notice.notes ? (
              <p className="whitespace-pre-wrap text-sm text-fg">{notice.notes}</p>
            ) : (
              <p className="text-sm text-fg-muted">Not set</p>
            )}
          </section>

          <AttachmentsSection parent="costImpactNotice" itemId={notice.id} />

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-1 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Comments
            </h2>
            <p className="mb-3 text-[11px] text-fg-muted">
              {submitter
                ? `Posting here emails ${submitter}, who raised this notice, and anyone you @-mention. Cost impact notices have no watchers.`
                : "Posting here emails anyone you @-mention. Cost impact notices have no watchers."}
            </p>
            <CommentComposer onSubmit={handleAddComment} mentionablePeople={mentionCandidates} />
            <div className="mt-5">
              <CommentThread
                comments={notice.comments}
                currentUserEmail={currentUser.email}
                currentUserName={currentUser.displayName}
                mentionablePeople={mentionCandidates}
                onEdit={handleEditComment}
              />
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Notice
            </span>
          </div>

          <SidebarField label="Raised by" icon={<User className="h-3.5 w-3.5" />}>
            <p className="px-1 text-sm text-fg">
              {submitter ?? <span className="text-fg-muted">Unknown</span>}
            </p>
          </SidebarField>

          <SidebarField label="Delta Cost">
            <div className="px-1">
              <CostImpactDeltaChip deltaCost={notice.deltaCost} />
            </div>
          </SidebarField>

          <div className="border-t border-border pt-3 text-[11px] text-fg-muted">
            Added {notice.createdAt.toLocaleDateString()} · last edited{" "}
            {notice.modifiedAt.toLocaleDateString()}
          </div>
        </aside>
      </div>

      {editing === "Part" && (
        <FieldEditModal
          title="Edit Part"
          fields={partFields()}
          values={{
            title: notice.title,
            supplier: notice.supplier,
            sapNumber: notice.sapNumber,
            oldPartNumber: notice.oldPartNumber,
            mpn: notice.mpn,
            eau: notice.eau,
            bpReference: notice.bpReference,
          }}
          onClose={() => setEditing(null)}
          onSave={savePart}
        />
      )}

      {editing === "Cost & Impact" && (
        <FieldEditModal
          title="Edit Cost & Impact"
          fields={costFields()}
          values={{
            originalCost: notice.originalCost,
            newCost: notice.newCost,
            timeOfImpact: notice.timeOfImpact ?? "",
            usedOnPanels: notice.usedOnPanels ?? "",
          }}
          onClose={() => setEditing(null)}
          onSave={saveCost}
        />
      )}

      {editing === "Where Used" && (
        <FieldEditModal
          title="Edit Where Used"
          fields={[{ key: "whereUsed", label: "Where Used", kind: "richText" }]}
          values={{ whereUsed: toPlainTextForEditing(notice.whereUsed) }}
          onClose={() => setEditing(null)}
          onSave={saveWhereUsed}
        />
      )}

      {editing === "Notes" && (
        <FieldEditModal
          title="Edit Notes"
          fields={[{ key: "notes", label: "Notes", kind: "multiline" }]}
          values={{ notes: notice.notes }}
          onClose={() => setEditing(null)}
          onSave={saveNotes}
        />
      )}
    </div>
  );
}

function partFields(): EditableFieldSpec[] {
  return [
    { key: "title", label: "Title", kind: "text" },
    { key: "supplier", label: "Supplier", kind: "text" },
    { key: "sapNumber", label: "SAP Number", kind: "text" },
    { key: "oldPartNumber", label: "Old Part Number", kind: "text" },
    { key: "mpn", label: "MPN", kind: "text" },
    { key: "eau", label: "EAU", kind: "text" },
    { key: "bpReference", label: "BP Reference", kind: "text" },
  ];
}

function costFields(): EditableFieldSpec[] {
  return [
    { key: "originalCost", label: "Original Cost", kind: "text" },
    { key: "newCost", label: "New Cost", kind: "text" },
    { key: "timeOfImpact", label: "Time of Impact", kind: "choice", choices: COST_IMPACT_TIMES },
    { key: "usedOnPanels", label: "Used on Panels", kind: "choice", choices: ["Yes", "No"] },
  ];
}

/** `604.5` → `$604.50` — the figures this whole feature exists to surface. */
function formatCost(raw: string): string {
  if (!raw.trim()) return "";
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Edit ${label}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
    >
      <Pencil className="h-3 w-3" />
      Edit
    </button>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      <p className={value ? "text-sm text-fg" : "text-sm text-fg-muted"}>{value || "Not set"}</p>
    </div>
  );
}

function SidebarField({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}
