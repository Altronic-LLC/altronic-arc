import { useEffect, useRef, useState } from "react";
import { ChevronDown, Eye, Trash2 } from "lucide-react";
import { SUPPLIER_CONTACT_STATUSES, type Comment, type Person, type SupplierContact } from "@/types/task";
import {
  useAddSupplierContactComment,
  useDeleteSupplierContact,
  useEditSupplierContactComment,
  useSetSupplierContactWatchers,
  useUpdateSupplierContactFields,
} from "@/hooks/useSupplierContacts";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { supplierContactLabel } from "@/lib/supplierContactMapper";
import { PersonMultiField } from "./PersonMultiField";
import { ChoiceSelect } from "./SearchableSelect";
import { CommentComposer } from "./CommentComposer";
import { CommentThread } from "./CommentThread";
import { AttachmentsSection } from "./AttachmentsSection";
import { cn } from "@/lib/cn";

interface SupplierContactCardProps {
  contact: SupplierContact;
  mentionCandidates: Person[];
  /** Auto-expand (deep link ?contact=<id> from notification emails). */
  defaultExpanded?: boolean;
}

/**
 * One contact on the Supplier detail page. Collapsed: a summary row.
 * Expanded: every field inline-editable, watchers, attachments, and the
 * contact's own comment thread — the same shape as `BuildRequestItemCard`.
 */
export function SupplierContactCard({
  contact,
  mentionCandidates,
  defaultExpanded = false,
}: SupplierContactCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const currentUser = useCurrentUser();
  const updateFields = useUpdateSupplierContactFields();
  const setWatchers = useSetSupplierContactWatchers();
  const deleteContact = useDeleteSupplierContact();
  const addComment = useAddSupplierContactComment();
  const editComment = useEditSupplierContactComment();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (defaultExpanded && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patch(changed: Parameters<typeof updateFields.mutate>[0]["changed"]) {
    updateFields.mutate({ id: contact.id, changed });
  }

  function handleAddComment(bodyHtml: string) {
    addComment.mutate({
      id: contact.id,
      comment: { authorName: currentUser.displayName, authorEmail: currentUser.email ?? "", bodyHtml },
    });
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string) {
    await editComment.mutateAsync({
      id: contact.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      bodyHtml: newBodyHtml,
      previousBodyHtml: comment.bodyHtml,
    });
  }

  function handleWatcherToggle(p: Person) {
    const key = (p.email ?? p.displayName).toLowerCase();
    const has = contact.watchers.some((w) => (w.email ?? w.displayName).toLowerCase() === key);
    const next = has
      ? contact.watchers.filter((w) => (w.email ?? w.displayName).toLowerCase() !== key)
      : [...contact.watchers, p];
    setWatchers.mutate({ id: contact.id, people: next });
  }

  return (
    <div
      ref={cardRef}
      className={cn(
        "rounded-lg border bg-surface transition-colors",
        expanded ? "border-accent/40" : "border-border hover:border-fg-muted",
      )}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left sm:flex-nowrap"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-fg">{supplierContactLabel(contact)}</span>
            {contact.status && (
              <span className="inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                {contact.status}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-sm text-fg-muted">
            {[contact.email, contact.phone].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-fg-muted">
          {contact.comments.length > 0 && <span>{contact.comments.length} 💬</span>}
          <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_18rem]">
            <div className="flex min-w-0 flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InlineText label="First Name" value={contact.firstName} onSave={(v) => patch({ firstName: v })} />
                <InlineText label="Last Name" value={contact.lastName} onSave={(v) => patch({ lastName: v })} />
                <InlineText label="Email" value={contact.email} onSave={(v) => patch({ email: v })} />
                <InlineText label="Phone" value={contact.phone} onSave={(v) => patch({ phone: v })} />
              </div>

              <label className="flex flex-col gap-1 text-xs">
                <span className="font-semibold uppercase tracking-wider text-fg-muted">Status</span>
                <ChoiceSelect
                  value={contact.status ?? ""}
                  onChange={(v) => patch({ status: (v || null) as SupplierContact["status"] })}
                  options={SUPPLIER_CONTACT_STATUSES}
                  emptyLabel="Not set"
                />
              </label>

              <TextAreaField
                label="Contact Notes"
                value={contact.contactNotes}
                onSave={(v) => patch({ contactNotes: v })}
              />

              <AttachmentsSection parent="supplierContact" itemId={contact.id} />

              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  Comments
                </h4>
                <CommentComposer onSubmit={handleAddComment} mentionablePeople={mentionCandidates} />
                <div className="mt-4">
                  <CommentThread
                    comments={contact.comments}
                    currentUserEmail={currentUser.email}
                    currentUserName={currentUser.displayName}
                    mentionablePeople={mentionCandidates}
                    onEdit={handleEditComment}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  <Eye className="h-3.5 w-3.5" /> Watchers
                </div>
                <PersonMultiField
                  value={contact.watchers}
                  allPeople={mentionCandidates}
                  onToggle={handleWatcherToggle}
                  emptyLabel="Nobody is watching this contact"
                />
              </div>

              <button
                onClick={() => {
                  if (window.confirm(`Remove ${supplierContactLabel(contact)}?`)) {
                    deleteContact.mutate(contact.id);
                  }
                }}
                className="mt-auto inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:border-cooper-red hover:text-cooper-red"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove contact
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InlineText({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(value);
        }}
        className="select"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
        rows={2}
        className="w-full resize-y rounded-md border border-border bg-bg p-2.5 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
      />
    </label>
  );
}
