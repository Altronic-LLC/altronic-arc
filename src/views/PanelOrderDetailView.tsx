import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  Building2,
  Eye,
  EyeOff,
  FolderOpen,
  Hash,
  ListChecks,
  ListTodo,
  Loader2,
  Mail,
  Pencil,
  User,
} from "lucide-react";
import {
  useAddPanelOrderComment,
  useEditPanelOrderComment,
  usePanelOrder,
  usePanelOrderChoices,
  usePanelOrders,
  usePanelProjects,
  useSetPanelOrderEngineer,
  useSetPanelOrderProject,
  useSetPanelOrderWatchers,
  useUnwatchPanelOrder,
  useUpdatePanelOrderFields,
  useWatchPanelOrder,
} from "@/hooks/usePanelOrders";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAdmins } from "@/hooks/useAdmins";
import type { Comment, PanelOrder, PanelTask, Person } from "@/types/task";
import { PanelOrderStatusBadge, PanelTaskStatusBadge } from "@/components/panelAtoms";
import { usePanelTasks } from "@/hooks/usePanelTasks";
import { usePanelTaskTemplates } from "@/hooks/usePanelTaskTemplates";
import { useRaiseMissingStandardTasks } from "@/hooks/usePanelOrderTasks";
import { PanelOrderBomsCard } from "@/components/PanelOrderBomsCard";
import { missingTemplates, tasksForOrder } from "@/lib/panelOrderTasks";
import { formatHours } from "@/lib/capacity";
import { CommentComposer } from "@/components/CommentComposer";
import { CommentThread } from "@/components/CommentThread";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { useCommentFileUpload } from "@/hooks/useAttachments";
import { PersonMultiField } from "@/components/PersonMultiField";
import { FieldEditModal, type EditableFieldSpec } from "@/components/FieldEditModal";
import { pushToast } from "@/components/Toast";
import { LoadingTasks } from "@/components/LoadingTasks";
import { DescriptionView } from "@/components/DescriptionView";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { DetailTopBar } from "@/components/DetailTopBar";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople } from "@/lib/people";
import { convertToChecklist, toggleChecklistItem } from "@/lib/descriptionChecklist";
import { cn } from "@/lib/cn";
import { legacyPanelOrderId, OLD_PANEL_ORDER_LIST, panelOrderCreatedAt } from "@/lib/panelOrderArchive";
import { panelProjectLabel, panelProjectPath } from "@/lib/panelProjectDashboard";
import { panelOrderDrawingNumberAvailable } from "@/api/panelOrders";

// =============================================================================
// One Panel Order. READ-ONLY until you press a section's Edit button (Tim,
// from the live demo with Mark, 2026-11-19 — BusinessIT#42): fields used to
// save the moment they were touched, so opening an order to read it was one
// stray click from changing it. Each section (title, Order, Customer, Order
// Notes) has ONE Edit that opens its fields with Save / Cancel — the
// FieldEditModal arrangement the other detail pages use. What stays live:
// Watch / Watchers (a subscription, not the order), comments, attachments,
// ticking an Order Notes checklist, and raising standard tasks. The Project
// Reference reads as a link to that project's Panel Project Dashboard.
// =============================================================================

type EditSection = "title" | "order" | "customer";

export function PanelOrderDetailView() {
  const { id } = useParams<{ id: string }>();
  const orderId = id ? parseInt(id, 10) : null;
  // A screenshot pasted or dropped into a comment goes to the SAME
  // list-item attachment store as the Attachments card, so it survives a
  // refresh. Without this prop the composer discards it silently.
  const uploadCommentFile = useCommentFileUpload("panelOrder", orderId);
  const navigate = useNavigate();

  const currentUser = useCurrentUser();
  const { data: order, isLoading } = usePanelOrder(orderId);
  const { data: allOrders = [] } = usePanelOrders();
  const { data: projects = [] } = usePanelProjects();
  const { data: choices } = usePanelOrderChoices();
  const { data: admins = [] } = useAdmins();

  const updateFields = useUpdatePanelOrderFields();
  const setEngineer = useSetPanelOrderEngineer();
  const setProject = useSetPanelOrderProject();
  const setWatchers = useSetPanelOrderWatchers();
  const watchOrder = useWatchPanelOrder();
  const unwatchOrder = useUnwatchPanelOrder();
  const addComment = useAddPanelOrderComment();
  const editComment = useEditPanelOrderComment();
  const [editing, setEditing] = useState<EditSection | null>(null);

  // People directory: everyone on any panel order + the Admins list, so
  // brand-new people can be picked and @-mentioned (the cold-start lesson).
  const directory = useDirectoryPeople();
  const allPeople: Person[] = useMemo(() => {
    const map = new Map<string, Person>();
    const note = (p: Person | null | undefined) => {
      if (!p || !p.displayName) return;
      const k = (p.email ?? p.displayName).toLowerCase();
      if (!map.has(k)) map.set(k, p);
    };
    for (const o of allOrders) {
      note(o.engineerAssigned);
      note(o.author);
      o.watchers.forEach(note);
    }
    note(currentUser);
    // Fold in the whole staff directory so any Altronic person is assignable
    // / @-mentionable — lookupId-less directory entries are resolved on write.
    return mergePeople([...map.values()], directory);
  }, [allOrders, currentUser, directory]);

  const mentionCandidates: Person[] = useMemo(() => {
    const map = new Map<string, Person>();
    for (const p of allPeople) map.set((p.email ?? p.displayName).toLowerCase(), p);
    for (const a of admins) {
      const key = a.email.toLowerCase();
      if (!map.has(key)) map.set(key, { displayName: a.displayName || a.email, email: a.email });
    }
    return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [allPeople, admins]);

  useEffect(() => {
    if (order) document.title = `${order.title} — ARC`;
    return () => {
      document.title = "ARC — Altronic Resource Center";
    };
  }, [order]);

  if (isLoading && !order) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <LoadingTasks noun="this panel order" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-12 text-center">
        <p className="text-fg-muted">Panel order not found.</p>
        <button
          onClick={() => navigate("/panels/orders")}
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent underline-offset-2 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Panel Orders
        </button>
      </div>
    );
  }

  function patch(fields: Record<string, unknown>) {
    if (!order) return;
    updateFields.mutate({ id: order.id, fields });
  }

  function personByKey(key: string | null): Person | null {
    if (!key) return null;
    return allPeople.find((p) => (p.email ?? p.displayName) === key) ?? null;
  }

  function handleAddComment(bodyHtml: string) {
    if (!order) return;
    // Returned, so a comment that fails to post goes back in the composer.
    return addComment.mutateAsync({
      id: order.id,
      comment: {
        authorName: currentUser.displayName,
        authorEmail: currentUser.email ?? "",
        bodyHtml,
      },
    }).then(() => undefined);
  }

  async function handleEditComment(comment: Comment, newBodyHtml: string, renotify: boolean) {
    if (!order) return;
    await editComment.mutateAsync({
      id: order.id,
      target: { timestamp: comment.timestamp, authorEmail: comment.authorEmail },
      newBodyHtml,
      renotify,
    });
  }

  function handleWatcherToggle(p: Person) {
    if (!order) return;
    const key = (p.email ?? p.displayName).toLowerCase();
    const has = order.watchers.some((w) => (w.email ?? w.displayName).toLowerCase() === key);
    const next = has
      ? order.watchers.filter((w) => (w.email ?? w.displayName).toLowerCase() !== key)
      : [...order.watchers, p];
    setWatchers.mutate({ id: order.id, people: next });
  }

  const isWatching = order.watchers.some(
    (w) =>
      (w.email ?? "").toLowerCase() === (currentUser.email ?? "").toLowerCase() &&
      !!currentUser.email,
  );

  const statuses = choices?.status ?? [];
  const customers = choices?.customer ?? [];

  function projectLabel(lookupId: number, title: string): string {
    const p = projects.find((x) => x.id === lookupId);
    return p ? panelProjectLabel(p) : title || `Project #${lookupId}`;
  }

  const engineerKey = order.engineerAssigned
    ? order.engineerAssigned.email ?? order.engineerAssigned.displayName
    : "";

  // A stored value the live choices no longer offer stays pickable, or
  // saving the section would silently change it.
  const withCurrent = (list: readonly string[], current: string) =>
    current && !list.includes(current) ? [...list, current] : [...list];

  const currentProject = order.projectRef;
  const hasDrawingNumber = panelOrderDrawingNumberAvailable();
  const orderFields: EditableFieldSpec[] = [
    {
      key: "status",
      label: "Status",
      kind: "choice",
      choices: withCurrent(statuses, order.status),
      hint: "On Hold also holds the order's open tasks; taking it off hold puts them back.",
    },
    {
      key: "project",
      label: "Project Reference",
      kind: "select",
      options: [
        ...projects.map((p) => ({ value: String(p.id), label: panelProjectLabel(p) })),
        ...(currentProject && !projects.some((p) => p.id === currentProject.lookupId)
          ? [
              {
                value: String(currentProject.lookupId),
                label: currentProject.title || `Project #${currentProject.lookupId}`,
              },
            ]
          : []),
      ],
    },
    {
      key: "engineer",
      label: "Engineer Assigned",
      kind: "select",
      options: allPeople.map((p) => ({ value: p.email ?? p.displayName, label: p.displayName })),
    },
    { key: "salesOrder", label: "Sales Order", kind: "text" },
    { key: "sapNumber", label: "SAP #", kind: "text", hint: "The job's SAP number — not the Sales Order." },
    // Hidden until Panel Order Headers has the column (scripts/move-panel-orders-to-arc.ps1
    // adds it), so the section never offers a write SharePoint would refuse.
    ...(hasDrawingNumber
      ? [{ key: "drawingNumber", label: "Drawing Number", kind: "text" as const, hint: "e.g. 5900-FLX36-V2-007" }]
      : []),
    { key: "purchaseOrder", label: "Purchase Order", kind: "text" },
  ];
  const orderValues: Record<string, string> = {
    status: order.status,
    project: currentProject ? String(currentProject.lookupId) : "",
    engineer: engineerKey,
    salesOrder: order.salesOrder,
    sapNumber: order.sapNumber,
    drawingNumber: order.drawingNumber,
    purchaseOrder: order.purchaseOrder,
  };

  const customerFields: EditableFieldSpec[] = [
    { key: "customer", label: "Customer", kind: "choice", choices: withCurrent(customers, order.customer) },
    { key: "customerReference", label: "Customer Reference", kind: "text", hint: "e.g. field unit or site" },
    { key: "customerContactEmail", label: "Customer Contact Email", kind: "text", hint: "name@customer.com" },
  ];
  const customerValues: Record<string, string> = {
    customer: order.customer,
    customerReference: order.customerReference,
    customerContactEmail: order.customerContactEmail,
  };

  /**
   * One section's Save. The plain columns go in ONE PATCH; the project and
   * the engineer have writes of their own (the engineer's emails them), run
   * one after another so two optimistic patches never race. Each hook rolls
   * its own change back and says so if it's refused, so a failure here
   * needs nothing more than not stopping the rest.
   */
  async function saveSection(changed: Record<string, string>) {
    if (!order) return;
    const id = order.id;
    const fields: Record<string, unknown> = {};
    if ("title" in changed) {
      const title = changed.title.trim();
      if (title) fields.Title = title;
      else pushToast({ message: "An order needs a title — the title wasn't changed.", variant: "error" });
    }
    // Status always holds a value; clearing it in the picker changes nothing.
    if (changed.status) fields.Status = changed.status;
    if ("salesOrder" in changed) fields.SalesOrder = changed.salesOrder.trim();
    if ("sapNumber" in changed) fields.SAPNumber = changed.sapNumber.trim();
    if ("drawingNumber" in changed) fields.DrawingNumber = changed.drawingNumber.trim();
    if ("purchaseOrder" in changed) fields.PurchaseOrder = changed.purchaseOrder.trim();
    if ("customer" in changed) fields.Customer = changed.customer;
    if ("customerReference" in changed) fields.CustomerReference = changed.customerReference.trim();
    if ("customerContactEmail" in changed) fields.CustomerContactEmail = changed.customerContactEmail.trim();
    try {
      if (Object.keys(fields).length > 0) await updateFields.mutateAsync({ id, fields });
    } catch {
      /* reverted and toasted by the hook */
    }
    try {
      if ("project" in changed) {
        await setProject.mutateAsync({
          id,
          projectLookupId: changed.project ? parseInt(changed.project, 10) : null,
        });
      }
    } catch {
      /* reverted and toasted by the hook */
    }
    try {
      if ("engineer" in changed) {
        await setEngineer.mutateAsync({ id, person: personByKey(changed.engineer || null) });
      }
    } catch {
      /* reverted and toasted by the hook */
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Panel Orders" listTo="/panels/orders" keepOpenLabel={order.title} />

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Header card */}
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <PanelOrderStatusBadge status={order.status} />
              {order.archived && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                  <Archive className="h-3 w-3" />
                  Archived
                </span>
              )}
              {order.projectRef && (
                <Link
                  to={panelProjectPath(order.projectRef.lookupId)}
                  title="Open this project's dashboard"
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg hover:border-accent hover:text-accent"
                >
                  <FolderOpen className="h-3 w-3" />
                  {order.projectRef.title || `Project #${order.projectRef.lookupId}`}
                </Link>
              )}
              <button
                onClick={() =>
                  isWatching
                    ? unwatchOrder.mutate({ id: order.id, person: currentUser })
                    : watchOrder.mutate({ id: order.id, person: currentUser })
                }
                className={cn(
                  "ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  isWatching
                    ? "border-accent bg-accent/10 text-accent hover:bg-accent/20"
                    : "border-border bg-surface text-fg hover:bg-surface-2",
                )}
                title={
                  isWatching
                    ? "You'll receive email updates about this panel order"
                    : "Add yourself to the watchers list"
                }
              >
                {isWatching ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                {isWatching ? "Watching" : "Watch"}
              </button>
            </div>
            <div className="flex items-start gap-2">
              <h1 className="flex-1 font-display text-xl font-semibold leading-tight text-fg sm:text-2xl">
                {order.title}
              </h1>
              <EditButton label="title" onClick={() => setEditing("title")} />
            </div>
            {order.legacySource && (
              <p className="mt-2 text-xs text-fg-muted">
                {order.archived ? "Archived — a finished order moved" : "Moved"} from the old{" "}
                {OLD_PANEL_ORDER_LIST} list
                {legacyPanelOrderId(order) !== null ? ` (item ${legacyPanelOrderId(order)})` : ""}.
              </p>
            )}
          </div>

          <OrderTasksCard order={order} />

          <PanelOrderBomsCard orderId={order.id} />

          {/* Order Notes — supports `- [ ]` checklists (stamps + confirm on uncheck). */}
          <OrderNotesCard
            value={order.orderNotes}
            checklistUserName={currentUser.displayName}
            onSave={(next) => patch({ OrderNotes: next })}
          />

          <AttachmentsSection parent="panelOrder" itemId={order.id} />

          {/* Comments */}
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
              Comments
            </h2>
            <CommentComposer
              draftKey={`panelOrder:${orderId}`} onSubmit={handleAddComment} mentionablePeople={mentionCandidates} uploadFile={uploadCommentFile} />
            <div className="mt-5">
              <CommentThread
                uploadFile={uploadCommentFile}
                comments={order.comments}
                currentUserEmail={currentUser.email}
                currentUserName={currentUser.displayName}
                mentionablePeople={mentionCandidates}
                onEdit={handleEditComment}
                onReply={handleAddComment}
                draftKey={`panelOrder:${orderId}`}
              />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-full shrink-0 lg:w-80">
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            {/* grid-cols-1 (= minmax(0,1fr)) keeps the single column from
                growing to its widest child (e.g. a long project chip). A bare
                `grid` uses an auto column, which overflows the card. */}
            <div className="grid grid-cols-1 gap-4">
              <SideSection title="Order" onEdit={() => setEditing("order")}>
                <SideField label="Status">
                  <div>
                    <PanelOrderStatusBadge status={order.status} />
                  </div>
                </SideField>
                <SideField label="Project Reference" icon={<FolderOpen />}>
                  {order.projectRef ? (
                    <Link
                      to={panelProjectPath(order.projectRef.lookupId)}
                      title="Open this project's dashboard"
                      className="break-words text-sm font-medium text-accent hover:underline"
                    >
                      {projectLabel(order.projectRef.lookupId, order.projectRef.title)}
                    </Link>
                  ) : (
                    <ReadValue value="" empty="No project" />
                  )}
                </SideField>
                <SideField label="Engineer Assigned" icon={<User />}>
                  <ReadValue value={order.engineerAssigned?.displayName ?? ""} empty="Unassigned" />
                </SideField>
                <SideField label="Sales Order" icon={<Hash />}>
                  <ReadValue value={order.salesOrder} />
                </SideField>
                <SideField label="SAP #" icon={<Hash />}>
                  <ReadValue value={order.sapNumber} />
                </SideField>
                {hasDrawingNumber && (
                  <SideField label="Drawing Number" icon={<Hash />}>
                    <ReadValue value={order.drawingNumber} />
                  </SideField>
                )}
                <SideField label="Purchase Order" icon={<Hash />}>
                  <ReadValue value={order.purchaseOrder} />
                </SideField>
              </SideSection>

              <SideSection title="Customer" onEdit={() => setEditing("customer")}>
                <SideField label="Customer" icon={<Building2 />}>
                  <ReadValue value={order.customer} />
                </SideField>
                <SideField label="Customer Reference">
                  <ReadValue value={order.customerReference} />
                </SideField>
                <SideField label="Customer Contact Email" icon={<Mail />}>
                  {order.customerContactEmail ? (
                    <a
                      href={`mailto:${order.customerContactEmail}`}
                      className="break-all text-sm text-accent hover:underline"
                    >
                      {order.customerContactEmail}
                    </a>
                  ) : (
                    <ReadValue value="" />
                  )}
                </SideField>
              </SideSection>

              <SideField label="Watchers" icon={<Eye />}>
                <PersonMultiField
                  value={order.watchers}
                  allPeople={mentionCandidates}
                  onToggle={handleWatcherToggle}
                  emptyLabel="Nobody is watching this order"
                />
              </SideField>

              <div className="border-t border-border pt-3 text-[11px] leading-relaxed text-fg-muted">
                Created{" "}
                {panelOrderCreatedAt(order).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {order.legacyCreatedAt
                  ? ` on ${OLD_PANEL_ORDER_LIST}`
                  : order.author?.displayName
                    ? ` by ${order.author.displayName}`
                    : ""}
                <br />
                Modified{" "}
                {order.modifiedAt.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
            </div>
          </div>
        </aside>
      </div>

      {editing === "title" && (
        <FieldEditModal
          title="Edit title"
          fields={[{ key: "title", label: "Title", kind: "text" }]}
          values={{ title: order.title }}
          onClose={() => setEditing(null)}
          onSave={(changed) => void saveSection(changed)}
        />
      )}
      {editing === "order" && (
        <FieldEditModal
          title="Edit order"
          fields={orderFields}
          values={orderValues}
          onClose={() => setEditing(null)}
          onSave={(changed) => void saveSection(changed)}
        />
      )}
      {editing === "customer" && (
        <FieldEditModal
          title="Edit customer"
          fields={customerFields}
          values={customerValues}
          onClose={() => setEditing(null)}
          onSave={(changed) => void saveSection(changed)}
        />
      )}
    </div>
  );
}

// ---- file-local helpers (EirDetailView convention) --------------------------

/**
 * Order Notes card — editable free text with checklist support, mirroring
 * EirDetailView's Description EditableTextCard: `- [ ]` lines render as
 * clickable checkboxes (who/when stamps, confirm-on-uncheck) and the edit
 * mode has a "Turn into checklist" helper.
 */
function OrderNotesCard({
  value,
  checklistUserName,
  onSave,
}: {
  value: string;
  checklistUserName: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  return (
    <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          Order Notes
        </h2>
        {!editing ? (
          <EditButton
            label="order notes"
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
          />
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDraft((d) => convertToChecklist(d))}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent underline-offset-2 hover:underline"
              title='Adds "- [ ] " checklist items you can check off on the detail page'
            >
              <ListChecks className="h-3 w-3" />
              Turn into checklist
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-fg-muted underline-offset-2 hover:underline"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onSave(draft);
                setEditing(false);
              }}
              className="text-xs font-medium text-accent underline-offset-2 hover:underline"
            >
              Save
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <AutoGrowTextarea
          style={{ minHeight: "8rem" }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          className="w-full resize-y rounded-md border border-border bg-bg p-3 text-base text-fg focus:border-accent focus:outline-hidden focus:ring-2 focus:ring-accent/20 sm:text-sm"
        />
      ) : value ? (
        <DescriptionView
          text={value}
          onToggle={(lineIndex) => onSave(toggleChecklistItem(value, lineIndex, checklistUserName))}
        />
      ) : (
        <div className="text-sm text-fg-muted">No order notes.</div>
      )}
    </div>
  );
}

/**
 * The tasks raised for this order (Tim, 2026-10-29), and the way to raise the
 * standard ones it's missing — for an order made before this existed, or one
 * whose tasks didn't all save. Only what's missing is raised, assigned to the
 * order's engineer as it stands now.
 */
function OrderTasksCard({ order }: { order: PanelOrder }) {
  const { data: allTasks = [], isLoading, isError } = usePanelTasks();
  const { data: templates = [] } = usePanelTaskTemplates();
  const raise = useRaiseMissingStandardTasks();
  const tasks = tasksForOrder(allTasks, order.id);
  // An archived order is finished — offering to raise its standard tasks
  // would put work for a shipped order in somebody's capacity backlog.
  const missing =
    order.archived || isLoading || isError ? [] : missingTemplates(order, templates, tasks);

  return (
    <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          <ListTodo className="h-4 w-4" /> Tasks
        </h2>
        {missing.length > 0 && (
          <button
            type="button"
            onClick={() => raise.mutate({ order, existing: tasks })}
            disabled={raise.isPending}
            title={`Adds ${missing.map((t) => t.title).join(", ")}${
              order.engineerAssigned ? `, assigned to ${order.engineerAssigned.displayName}` : ", unassigned"
            }`}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
          >
            {raise.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {tasks.length === 0
              ? "Create standard tasks"
              : `Add missing standard task${missing.length === 1 ? "" : "s"} (${missing.length})`}
          </button>
        )}
      </div>
      {isLoading ? (
        <p className="text-sm text-fg-muted">Loading tasks…</p>
      ) : isError ? (
        <p className="text-sm text-cooper-red">Couldn't load the panel tasks.</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-fg-muted">No tasks have been raised for this order.</p>
      ) : (
        <ul className="divide-y divide-border">
          {tasks.map((t) => (
            <OrderTaskRow key={t.id} task={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderTaskRow({ task }: { task: PanelTask }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
      <PanelTaskStatusBadge status={task.status} />
      <Link to={`/panels/task/${task.id}`} className="min-w-0 flex-1 font-medium text-fg hover:underline sm:truncate">
        {task.title}
      </Link>
      {/* On a phone the details drop to their own line, so the title isn't cut to a few letters. */}
      <span className="w-full text-xs text-fg-muted sm:w-auto">
        {task.assigned.map((p) => p.displayName).join(", ") || "Unassigned"}
        {task.estimatedHours !== null && ` · ${formatHours(task.estimatedHours)}`}
        {task.dueDate && ` · due ${task.dueDate.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}`}
      </span>
    </li>
  );
}

function SideField({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted [&>svg]:h-3.5 [&>svg]:w-3.5">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}

/** A sidebar section that reads, with ONE Edit button that opens its fields. */
function SideSection({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 gap-4 border-b border-border pb-4">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 font-display text-sm font-semibold uppercase tracking-wider text-fg">{title}</h2>
        <EditButton label={title.toLowerCase()} onClick={onEdit} />
      </div>
      {children}
    </section>
  );
}

function ReadValue({ value, empty = "Not set" }: { value: string; empty?: string }) {
  return value ? (
    <span className="break-words text-sm text-fg">{value}</span>
  ) : (
    <span className="text-sm text-fg-muted">{empty}</span>
  );
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Edit ${label}`}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
    >
      <Pencil className="h-3 w-3" />
      Edit
    </button>
  );
}
