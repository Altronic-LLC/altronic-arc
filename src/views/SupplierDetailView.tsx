import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, Eye, Pencil, Plus, Truck, User, Users } from "lucide-react";
import {
  collectSupplierPeople,
  useAddSupplierComment,
  useEditSupplierComment,
  useSetSupplierWatchers,
  useSupplier,
  useSuppliers,
  useUpdateSupplierAssignedBuyer,
  useUpdateSupplierDetails,
  useUpdateSupplierPointOfContact,
} from "@/hooks/useSuppliers";
import {
  collectSupplierContactPeople,
  useSupplierContactsFor,
} from "@/hooks/useSupplierContacts";
import { collectSupplierIssuePeople, useSupplierIssuesFor } from "@/hooks/useSupplierIssues";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Comment } from "@/types/task";
import { SUPPLIER_CORE_COMPETENCIES, SUPPLIER_STATUSES } from "@/types/task";
import { mergePeople, personKey } from "@/lib/people";
import { supplierContactLabel } from "@/lib/supplierContactMapper";
import { FieldEditModal, type EditableFieldSpec } from "@/components/FieldEditModal";
import { PersonMultiField } from "@/components/PersonMultiField";
import { ChoiceSelect, MultiSelect, SingleSelect } from "@/components/SearchableSelect";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SupplierContactCard } from "@/components/SupplierContactCard";
import { SupplierContactFormModal } from "@/components/SupplierContactFormModal";
import { SupplierIssueCard } from "@/components/SupplierIssueCard";
import { SupplierIssueFormModal } from "@/components/SupplierIssueFormModal";

// =============================================================================
// One supplier — the SRM tool's "supplier 360" page. Details/Notes are a card
// each with its own Edit button; Assigned Buyer, Point of Contact and
// Watchers write immediately on pick, the same as a task's Assigned field.
// Contacts and Issues render as expandable cards scoped to this supplier —
// the same inline-card pattern Build Request Items use — because both need
// their own comment thread, watchers and attachments, which a quick-edit
// modal has no room for.
// =============================================================================

export function SupplierDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const supplierId = id ? parseInt(id, 10) : null;
  const { data: supplier, isLoading } = useSupplier(supplierId);
  const { data: suppliers = [] } = useSuppliers();
  const currentUser = useCurrentUser();
  const directory = useDirectoryPeople();

  const updateDetails = useUpdateSupplierDetails();
  const updateAssignedBuyer = useUpdateSupplierAssignedBuyer();
  const updatePointOfContact = useUpdateSupplierPointOfContact();
  const setWatchers = useSetSupplierWatchers();
  const addComment = useAddSupplierComment();
  const editComment = useEditSupplierComment();

  const { data: contacts = [] } = useSupplierContactsFor(supplierId);
  const { data: issues = [] } = useSupplierIssuesFor(supplierId);

  const [editingCard, setEditingCard] = useState<"Details" | "Notes" | null>(null);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showAddIssue, setShowAddIssue] = useState(false);

  const focusContactId = searchParams.get("contact") ? parseInt(searchParams.get("contact")!, 10) : null;
  const focusIssueId = searchParams.get("issue") ? parseInt(searchParams.get("issue")!, 10) : null;

  const allPeople = useMemo(
    () =>
      mergePeople(
        collectSupplierPeople(suppliers),
        collectSupplierContactPeople(contacts),
        collectSupplierIssuePeople(issues),
        directory,
      ),
    [suppliers, contacts, issues, directory],
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
        <LoadingTasks noun="the supplier" />
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-10 text-center sm:px-6">
        <p className="text-sm text-fg-muted">That supplier doesn't exist.</p>
        <button
          onClick={() => navigate("/supply-chain/suppliers")}
          className="mt-3 text-sm text-accent underline-offset-2 hover:underline"
        >
          Back to Suppliers
        </button>
      </div>
    );
  }

  function handleAddComment(bodyHtml: string) {
    if (!supplier) return;
    addComment.mutate({
      id: supplier.id,
      comment: { authorName: currentUser.displayName, authorEmail: currentUser.email ?? "", bodyHtml },
    });
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string) {
    if (!supplier) return;
    await editComment.mutateAsync({
      id: supplier.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      bodyHtml: newBodyHtml,
      previousBodyHtml: comment.bodyHtml,
    });
  }

  function handleWatcherToggle(p: (typeof allPeople)[number]) {
    if (!supplier) return;
    const key = personKey(p);
    const next = supplier.watchers.some((w) => personKey(w) === key)
      ? supplier.watchers.filter((w) => personKey(w) !== key)
      : [...supplier.watchers, p];
    setWatchers.mutate({ id: supplier.id, people: next });
  }

  const pointOfContact = supplier.pointOfContactId
    ? contacts.find((c) => c.id === supplier.pointOfContactId)
    : undefined;
  // The contact picker isn't scoped to just this supplier's contacts by the
  // API, but a point of contact should be — offer only this supplier's own.
  const supplierContacts = contacts.filter((c) => c.supplierId === supplier.id);

  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Suppliers" listTo="/supply-chain/suppliers" />

      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <Truck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            {supplier.title || `Supplier #${supplier.id}`}
          </h1>
          <p className="text-sm text-fg-muted">
            {supplier.businessPartnerNumber ? `BP #${supplier.businessPartnerNumber}` : "No BP number"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
                Notes
              </h2>
              <EditButton label="Notes" onClick={() => setEditingCard("Notes")} />
            </div>
            {supplier.notes ? (
              <p className="whitespace-pre-wrap text-sm text-fg">{supplier.notes}</p>
            ) : (
              <p className="text-sm text-fg-muted">Not set</p>
            )}
          </section>

          <ListSection
            icon={<Users className="h-4 w-4" />}
            title="Contacts"
            count={supplierContacts.length}
            onAdd={() => setShowAddContact(true)}
          >
            {supplierContacts.length === 0 ? (
              <EmptyRow>No contacts yet.</EmptyRow>
            ) : (
              <div className="flex flex-col gap-2 p-2">
                {supplierContacts.map((c) => (
                  <SupplierContactCard
                    key={c.id}
                    contact={c}
                    mentionCandidates={allPeople}
                    defaultExpanded={focusContactId === c.id}
                  />
                ))}
              </div>
            )}
          </ListSection>

          <ListSection
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Issues"
            count={issues.length}
            onAdd={() => setShowAddIssue(true)}
          >
            {issues.length === 0 ? (
              <EmptyRow>No issues logged.</EmptyRow>
            ) : (
              <div className="flex flex-col gap-2 p-2">
                {issues.map((i) => (
                  <SupplierIssueCard
                    key={i.id}
                    issue={i}
                    mentionCandidates={allPeople}
                    defaultExpanded={focusIssueId === i.id}
                  />
                ))}
              </div>
            )}
          </ListSection>

          <AttachmentsSection parent="supplier" itemId={supplier.id} />

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-1 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Comments
            </h2>
            <CommentComposer onSubmit={handleAddComment} mentionablePeople={allPeople} />
            <div className="mt-5">
              <CommentThread
                comments={supplier.comments}
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

          <SidebarField label="Status">
            <ChoiceSelect
              value={supplier.status ?? ""}
              onChange={(v) =>
                updateDetails.mutate({
                  current: supplier,
                  changed: { status: (v || null) as (typeof SUPPLIER_STATUSES)[number] | null },
                })
              }
              options={SUPPLIER_STATUSES}
              emptyLabel="Not set"
            />
          </SidebarField>

          <SidebarField label="Core Competency">
            <MultiSelect
              allLabel="Not set"
              searchPlaceholder="Search competencies…"
              options={SUPPLIER_CORE_COMPETENCIES.map((c) => ({ value: c, label: c }))}
              selected={supplier.coreCompetencies}
              onChange={(next) =>
                updateDetails.mutate({
                  current: supplier,
                  changed: { coreCompetencies: next as (typeof SUPPLIER_CORE_COMPETENCIES)[number][] },
                })
              }
            />
          </SidebarField>

          <SidebarField label="Assigned Buyer" icon={<User className="h-3.5 w-3.5" />}>
            <SingleSelect
              allLabel="No buyer assigned"
              searchPlaceholder="Search people…"
              options={allPeople.map((p) => ({ value: personKey(p), label: p.displayName }))}
              selected={supplier.assignedBuyer ? personKey(supplier.assignedBuyer) : null}
              onChange={(key) => {
                const person = key ? allPeople.find((p) => personKey(p) === key) ?? null : null;
                updateAssignedBuyer.mutate({ id: supplier.id, person });
              }}
            />
          </SidebarField>

          <SidebarField label="Point of Contact" icon={<User className="h-3.5 w-3.5" />}>
            <SingleSelect
              allLabel="Not set"
              searchPlaceholder="Search contacts…"
              options={supplierContacts.map((c) => ({ value: String(c.id), label: supplierContactLabel(c) }))}
              selected={supplier.pointOfContactId ? String(supplier.pointOfContactId) : null}
              onChange={(v) =>
                updatePointOfContact.mutate({ id: supplier.id, contactId: v ? parseInt(v, 10) : null })
              }
            />
            {pointOfContact === undefined && supplier.pointOfContactId && (
              <p className="mt-1 text-[11px] text-fg-muted">Contact #{supplier.pointOfContactId}</p>
            )}
          </SidebarField>

          <SidebarField label="Watchers" icon={<Eye className="h-3.5 w-3.5" />}>
            <PersonMultiField
              value={supplier.watchers}
              allPeople={allPeople}
              onToggle={handleWatcherToggle}
              emptyLabel="Nobody is watching this supplier"
            />
          </SidebarField>

          {supplier.supplierPerformanceRate !== null && (
            <SidebarField label="Performance">
              <div className="grid grid-cols-1 gap-1 text-sm text-fg">
                <span>Supplier: {supplier.supplierPerformanceRate}%</span>
                {supplier.qualityPerformance !== null && <span>Quality: {supplier.qualityPerformance}%</span>}
                {supplier.logisticalPerformance !== null && (
                  <span>Logistical: {supplier.logisticalPerformance}%</span>
                )}
              </div>
            </SidebarField>
          )}

          <div className="border-t border-border pt-3 text-[11px] text-fg-muted">
            Added {supplier.createdAt.toLocaleDateString()} · last edited{" "}
            {supplier.modifiedAt.toLocaleDateString()}
          </div>
        </aside>
      </div>

      {editingCard === "Details" && (
        <FieldEditModal
          title="Edit Details"
          fields={detailsFields()}
          values={{
            companyName: supplier.companyName,
            businessPartnerNumber: supplier.businessPartnerNumber,
            address: supplier.address,
            website: supplier.website,
            supplierScore: supplier.supplierScore,
            supplierIdentifier: supplier.supplierIdentifier,
          }}
          onClose={() => setEditingCard(null)}
          onSave={(changed) => updateDetails.mutate({ current: supplier, changed })}
        />
      )}

      {editingCard === "Notes" && (
        <FieldEditModal
          title="Edit Notes"
          fields={[{ key: "notes", label: "Notes", kind: "multiline" }]}
          values={{ notes: supplier.notes }}
          onClose={() => setEditingCard(null)}
          onSave={(changed) => updateDetails.mutate({ current: supplier, changed })}
        />
      )}

      {showAddContact && (
        <SupplierContactFormModal supplierId={supplier.id} onClose={() => setShowAddContact(false)} />
      )}
      {showAddIssue && (
        <SupplierIssueFormModal supplierId={supplier.id} onClose={() => setShowAddIssue(false)} />
      )}
    </div>
  );
}

function detailsFields(): EditableFieldSpec[] {
  return [
    { key: "companyName", label: "Company Name", kind: "text" },
    { key: "businessPartnerNumber", label: "Business Partner Number", kind: "text" },
    { key: "address", label: "Address", kind: "text" },
    { key: "website", label: "Website", kind: "text" },
    { key: "supplierScore", label: "Supplier Score", kind: "text" },
    { key: "supplierIdentifier", label: "Supplier Identifier", kind: "text" },
  ];
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
