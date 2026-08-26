import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Building2, DollarSign, Gauge, Pencil, Plus, User, Users } from "lucide-react";
import {
  collectCustomerNotePeople,
  useAddCustomerNoteComment,
  useCustomerNote,
  useCustomerNotes,
  useDeleteCustomerNote,
  useEditCustomerNoteComment,
  useUpdateCustomerNoteDetails,
  useUpdateCustomerNotePeople,
  useUpdateCustomerNoteText,
} from "@/hooks/useCustomerNotes";
import { useContactsFor } from "@/hooks/useCustomerContacts";
import { usePricingFor } from "@/hooks/useSpecialPricing";
import { useCapacityFor } from "@/hooks/useCapacity";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Comment, CustomerContact, CapacityEntry, SpecialPricingEntry } from "@/types/task";
import { CUSTOMER_GROUPS, CUSTOMER_TYPES } from "@/types/task";
import { mergePeople, personKey } from "@/lib/people";
import { looksLikeHtml } from "@/lib/descriptionChecklist";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import { toPlainTextForEditing, toStoredRichText } from "@/lib/richText";
import { FieldEditModal, type EditableFieldSpec } from "@/components/FieldEditModal";
import { PersonMultiField } from "@/components/PersonMultiField";
import { ChoiceSelect, MultiSelect, SingleSelect } from "@/components/SearchableSelect";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { CustomerContactFormModal } from "@/components/CustomerContactFormModal";
import { SpecialPricingFormModal } from "@/components/SpecialPricingFormModal";
import { CapacityFormModal } from "@/components/CapacityFormModal";

// =============================================================================
// One customer — the CRM tool's "customer 360" page. General/Compliance Notes
// and Group/Type are a card each with its own Edit button (the shared
// read-then-write rule); CSR/KAM write immediately on pick, the same as a
// task's Assigned field. Contacts, Special Pricing and Capacity each get their
// own section scoped to this customer — the reason those three lists have no
// top-level screen of their own (Ray, 2026-08-26).
// =============================================================================

export function CustomerNoteDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const customerId = id ? parseInt(id, 10) : null;
  const { data: note, isLoading } = useCustomerNote(customerId);
  const { data: notes = [] } = useCustomerNotes();
  const currentUser = useCurrentUser();
  const directory = useDirectoryPeople();

  const updateDetails = useUpdateCustomerNoteDetails();
  const updatePeople = useUpdateCustomerNotePeople();
  const updateText = useUpdateCustomerNoteText();
  const deleteNote = useDeleteCustomerNote();
  const addComment = useAddCustomerNoteComment();
  const editComment = useEditCustomerNoteComment();

  const { data: contacts = [] } = useContactsFor(customerId);
  const { data: pricing = [] } = usePricingFor(customerId);
  const { data: capacity = [] } = useCapacityFor(customerId);

  const [editingCard, setEditingCard] = useState<"Details" | "General Notes" | "Compliance Notes" | null>(null);
  const [contactModal, setContactModal] = useState<CustomerContact | "new" | null>(null);
  const [pricingModal, setPricingModal] = useState<SpecialPricingEntry | "new" | null>(null);
  const [capacityModal, setCapacityModal] = useState<CapacityEntry | "new" | null>(null);

  const allPeople = useMemo(
    () => mergePeople(collectCustomerNotePeople(notes), directory),
    [notes, directory],
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <LoadingTasks noun="the customer" />
      </div>
    );
  }

  if (!note) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-10 text-center sm:px-6">
        <p className="text-sm text-fg-muted">That customer doesn't exist.</p>
        <button
          onClick={() => navigate("/sales/customers")}
          className="mt-3 text-sm text-accent underline-offset-2 hover:underline"
        >
          Back to Customers
        </button>
      </div>
    );
  }

  function handleAddComment(bodyHtml: string) {
    if (!note) return;
    addComment.mutate({
      id: note.id,
      comment: { authorName: currentUser.displayName, authorEmail: currentUser.email ?? "", bodyHtml },
    });
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string) {
    if (!note) return;
    await editComment.mutateAsync({
      id: note.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      bodyHtml: newBodyHtml,
      previousBodyHtml: comment.bodyHtml,
    });
  }

  async function handleDelete() {
    if (!note) return;
    if (!window.confirm(`Remove ${note.customerName || "this customer"}? This can't be undone.`)) return;
    await deleteNote.mutateAsync(note.id);
    navigate("/sales/customers");
  }

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Customers" listTo="/sales/customers" />

      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <Building2 className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            {note.customerName || `Customer #${note.id}`}
          </h1>
          <p className="text-sm text-fg-muted">
            {note.sapCustomerNumber ? `SAP #${note.sapCustomerNumber}` : "No SAP number"}
            {note.oldCustomerNumber ? ` · Old #${note.oldCustomerNumber}` : ""}
          </p>
        </div>
        <button
          onClick={handleDelete}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:border-cooper-red/40 hover:text-cooper-red"
        >
          Remove customer
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
                General Notes
              </h2>
              <EditButton label="General Notes" onClick={() => setEditingCard("General Notes")} />
            </div>
            <RichTextBlock value={note.generalNotes} />
          </section>

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
                Compliance Notes
              </h2>
              <EditButton label="Compliance Notes" onClick={() => setEditingCard("Compliance Notes")} />
            </div>
            <RichTextBlock value={note.complianceNotes} />
          </section>

          <ListSection
            icon={<Users className="h-4 w-4" />}
            title="Contacts"
            count={contacts.length}
            onAdd={() => setContactModal("new")}
          >
            {contacts.length === 0 ? (
              <EmptyRow>No contacts yet.</EmptyRow>
            ) : (
              contacts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setContactModal(c)}
                  className="flex w-full flex-col items-start gap-0.5 border-t border-border px-4 py-2.5 text-left transition-colors first:border-t-0 hover:bg-surface-2"
                >
                  <span className="text-sm font-medium text-fg">{c.name || "Unnamed"}</span>
                  <span className="text-xs text-fg-muted">
                    {[c.jobTitle, c.email, c.phoneNumber].filter(Boolean).join(" · ") || "No details"}
                  </span>
                </button>
              ))
            )}
          </ListSection>

          <ListSection
            icon={<DollarSign className="h-4 w-4" />}
            title="Special Pricing"
            count={pricing.length}
            onAdd={() => setPricingModal("new")}
          >
            {pricing.length === 0 ? (
              <EmptyRow>No special pricing on record.</EmptyRow>
            ) : (
              pricing.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPricingModal(p)}
                  className="flex w-full flex-col items-start gap-0.5 border-t border-border px-4 py-2.5 text-left transition-colors first:border-t-0 hover:bg-surface-2"
                >
                  <span className="text-sm font-medium text-fg">{p.title || "Untitled"}</span>
                  <span className="line-clamp-1 text-xs text-fg-muted">
                    {p.pricingNotes || "No notes"}
                  </span>
                </button>
              ))
            )}
          </ListSection>

          <ListSection
            icon={<Gauge className="h-4 w-4" />}
            title="Capacity"
            count={capacity.length}
            onAdd={() => setCapacityModal("new")}
          >
            {capacity.length === 0 ? (
              <EmptyRow>No capacity commitments on record.</EmptyRow>
            ) : (
              capacity.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCapacityModal(c)}
                  className="flex w-full flex-col items-start gap-0.5 border-t border-border px-4 py-2.5 text-left transition-colors first:border-t-0 hover:bg-surface-2"
                >
                  <span className="text-sm font-medium text-fg">
                    {c.partNumber || "Untitled"}
                    {c.weeklyMax !== null && (
                      <span className="ml-2 text-xs font-normal text-fg-muted">
                        {c.weeklyMax.toLocaleString()}/week
                      </span>
                    )}
                  </span>
                  <span className="line-clamp-1 text-xs text-fg-muted">
                    {c.description || "No description"}
                  </span>
                </button>
              ))
            )}
          </ListSection>

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-1 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Comments
            </h2>
            <p className="mb-3 text-[11px] text-fg-muted">
              Posting here emails anyone you @-mention. There are no watchers on this list.
            </p>
            <CommentComposer onSubmit={handleAddComment} mentionablePeople={allPeople} />
            <div className="mt-5">
              <CommentThread
                comments={note.comments}
                currentUserEmail={currentUser.email}
                currentUserName={currentUser.displayName}
                mentionablePeople={allPeople}
                onEdit={handleEditComment}
              />
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Details
            </span>
            <EditButton label="Details" onClick={() => setEditingCard("Details")} />
          </div>

          <SidebarField label="Group">
            <ChoiceSelect
              value={note.group ?? ""}
              onChange={(v) =>
                updateDetails.mutate({
                  id: note.id,
                  changed: { group: (v || null) as (typeof CUSTOMER_GROUPS)[number] | null },
                })
              }
              options={CUSTOMER_GROUPS}
              emptyLabel="Not set"
              searchPlaceholder="Search groups…"
            />
          </SidebarField>

          <SidebarField label="Customer Type">
            <MultiSelect
              allLabel="Not set"
              options={CUSTOMER_TYPES.map((t) => ({ value: t, label: t }))}
              selected={note.customerTypes}
              onChange={(next) =>
                updateDetails.mutate({
                  id: note.id,
                  changed: { customerTypes: next as (typeof CUSTOMER_TYPES)[number][] },
                })
              }
            />
          </SidebarField>

          <SidebarField label="CSR" icon={<Users className="h-3.5 w-3.5" />}>
            <PersonMultiField
              value={note.csr}
              allPeople={allPeople}
              emptyLabel="No CSR assigned"
              onToggle={(p) => {
                const key = personKey(p);
                const next = note.csr.some((x) => personKey(x) === key)
                  ? note.csr.filter((x) => personKey(x) !== key)
                  : [...note.csr, p];
                updatePeople.mutate({ id: note.id, people: { csr: next } });
              }}
            />
          </SidebarField>

          <SidebarField label="KAM" icon={<User className="h-3.5 w-3.5" />}>
            <SingleSelect
              allLabel="No KAM assigned"
              searchPlaceholder="Search people…"
              options={allPeople.map((p) => ({ value: personKey(p), label: p.displayName }))}
              selected={note.kam ? personKey(note.kam) : null}
              onChange={(key) => {
                const person = key ? allPeople.find((p) => personKey(p) === key) ?? null : null;
                updatePeople.mutate({ id: note.id, people: { kam: person } });
              }}
            />
          </SidebarField>

          <div className="border-t border-border pt-3 text-[11px] text-fg-muted">
            Added {note.createdAt.toLocaleDateString()} · last edited{" "}
            {note.modifiedAt.toLocaleDateString()}
          </div>
        </aside>
      </div>

      {editingCard === "Details" && (
        <FieldEditModal
          title="Edit Details"
          fields={detailsFields()}
          values={{
            customerName: note.customerName,
            oldCustomerNumber: note.oldCustomerNumber,
            sapCustomerNumber: note.sapCustomerNumber,
          }}
          onClose={() => setEditingCard(null)}
          onSave={(changed) => updateDetails.mutate({ id: note.id, changed })}
        />
      )}

      {(editingCard === "General Notes" || editingCard === "Compliance Notes") && (
        <FieldEditModal
          title={`Edit ${editingCard}`}
          fields={[{ key: "value", label: editingCard, kind: "richText" }]}
          values={{
            value: toPlainTextForEditing(
              editingCard === "General Notes" ? note.generalNotes : note.complianceNotes,
            ),
          }}
          onClose={() => setEditingCard(null)}
          onSave={(changed) => {
            if (!("value" in changed)) return;
            const html = toStoredRichText(changed.value);
            updateText.mutate({
              id: note.id,
              changed:
                editingCard === "General Notes"
                  ? { generalNotes: html }
                  : { complianceNotes: html },
            });
          }}
        />
      )}

      {contactModal === "new" && (
        <CustomerContactFormModal customerId={note.id} onClose={() => setContactModal(null)} />
      )}
      {contactModal && contactModal !== "new" && (
        <CustomerContactFormModal
          customerId={note.id}
          contact={contactModal}
          onClose={() => setContactModal(null)}
        />
      )}

      {pricingModal === "new" && (
        <SpecialPricingFormModal customerId={note.id} onClose={() => setPricingModal(null)} />
      )}
      {pricingModal && pricingModal !== "new" && (
        <SpecialPricingFormModal
          customerId={note.id}
          entry={pricingModal}
          onClose={() => setPricingModal(null)}
        />
      )}

      {capacityModal === "new" && (
        <CapacityFormModal customerId={note.id} onClose={() => setCapacityModal(null)} />
      )}
      {capacityModal && capacityModal !== "new" && (
        <CapacityFormModal
          customerId={note.id}
          entry={capacityModal}
          onClose={() => setCapacityModal(null)}
        />
      )}
    </div>
  );
}

function detailsFields(): EditableFieldSpec[] {
  return [
    { key: "customerName", label: "Customer Name", kind: "text" },
    { key: "sapCustomerNumber", label: "SAP Customer Number", kind: "text" },
    { key: "oldCustomerNumber", label: "Old Customer Number", kind: "text" },
  ];
}

function RichTextBlock({ value }: { value: string }) {
  if (!value) return <p className="text-sm text-fg-muted">Not set</p>;
  if (looksLikeHtml(value)) {
    return (
      <div
        className="comment-html text-sm leading-relaxed text-fg"
        dangerouslySetInnerHTML={{ __html: sanitiseHtml(value) }}
      />
    );
  }
  return <p className="whitespace-pre-wrap text-sm text-fg">{value}</p>;
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

function ListSection({
  icon,
  title,
  count,
  onAdd,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
        <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          {icon}
          {title} ({count})
        </h2>
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      </div>
      {children}
    </section>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 text-center text-sm text-fg-muted">{children}</div>;
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
