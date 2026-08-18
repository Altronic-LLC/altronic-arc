import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Calendar, MapPin, Pencil, Tag, User, Wrench } from "lucide-react";
import {
  useUpdateVisitReportFields,
  useVisitReport,
  useVisitReports,
} from "@/hooks/useVisitReports";
import {
  US_STATES,
  VISIT_CUSTOMER_STATUSES,
  VISIT_REASONS,
  type VisitReport,
} from "@/types/task";
import { rmNameOptions } from "@/lib/visitReportMapper";
import { formatSpDate, fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { DateField } from "@/components/DateField";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { VisitReportFormModal } from "@/components/VisitReportFormModal";
import { VisitStatusChip } from "@/components/visitReportAtoms";

// =============================================================================
// One visit report.
//
// Everything edits in place: the sidebar's choice fields and date save on
// change, the two long fields save on their own Save button. That matches the
// task and EIR detail pages, and means the Edit modal is there for a bulk
// rewrite rather than being the only way to change one thing.
//
// There is no Delete. The API has no delete either — see api/visitReports.ts.
// =============================================================================

export function VisitReportDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const reportId = id ? parseInt(id, 10) : null;
  const { data: report, isLoading } = useVisitReport(reportId);
  const { data: reports = [] } = useVisitReports();
  const updateFields = useUpdateVisitReportFields();
  const [showEdit, setShowEdit] = useState(false);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <LoadingTasks noun="the visit report" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-10 text-center sm:px-6">
        <p className="text-sm text-fg-muted">That visit report doesn't exist.</p>
        <button
          onClick={() => navigate("/sales/visit-reports")}
          className="mt-3 text-sm text-accent underline-offset-2 hover:underline"
        >
          Back to Visit Reports
        </button>
      </div>
    );
  }

  function save(fields: Record<string, unknown>, patch: Partial<VisitReport>) {
    if (!report) return;
    updateFields.mutate({ id: report.id, fields, patch });
  }

  const location = [report.city, report.state].filter(Boolean).join(", ");

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Visit Reports" listTo="/sales/visit-reports" />

      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <MapPin className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            {report.customerName || "(no customer)"}
          </h1>
          <p className="text-sm text-fg-muted">
            {report.reasonForVisit || "Visit"} on {formatSpDate(report.visitDate)}
            {location && ` · ${location}`}
          </p>
        </div>
        <VisitStatusChip status={report.customerStatus} />
        <button
          onClick={() => setShowEdit(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <TextCard
            title="Visit Summary"
            value={report.visitSummary}
            emptyLabel="No summary recorded."
            onSave={(next) => save({ VisitSummary: next }, { visitSummary: next })}
          />
          <TextCard
            title="Action Items"
            value={report.actionItems}
            emptyLabel="No action items."
            onSave={(next) => save({ ActionItems: next }, { actionItems: next })}
          />
          <AttachmentsSection parent="visitReport" itemId={report.id} />
        </div>

        <aside className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <SidebarField icon={<User className="h-3.5 w-3.5" />} label="RM Name">
            <ChoiceSelect
              value={report.rmName}
              onChange={(v) => save({ RMName: v }, { rmName: v })}
              options={rmNameOptions(reports)}
              emptyLabel="Unassigned"
              searchPlaceholder="Search managers…"
            />
          </SidebarField>

          <SidebarField icon={<Calendar className="h-3.5 w-3.5" />} label="Visit Date">
            <DateField
              value={toDateInputValue(report.visitDate)}
              onChange={(v) => {
                const next = fromDateInputValue(v);
                save({ VisitDate: next ? next.toISOString() : null }, { visitDate: next });
              }}
              aria-label="Visit Date"
            />
          </SidebarField>

          <SidebarField icon={<Tag className="h-3.5 w-3.5" />} label="Reason For Visit">
            <ChoiceSelect
              value={report.reasonForVisit}
              onChange={(v) => save({ ReasonForVisit: v }, { reasonForVisit: v })}
              options={VISIT_REASONS}
              emptyLabel="Not set"
            />
          </SidebarField>

          <SidebarField icon={<Tag className="h-3.5 w-3.5" />} label="Customer Status">
            <ChoiceSelect
              value={report.customerStatus}
              onChange={(v) => save({ CustomerStatus: v }, { customerStatus: v })}
              options={VISIT_CUSTOMER_STATUSES}
              emptyLabel="Not set"
            />
          </SidebarField>

          <SidebarField icon={<Wrench className="h-3.5 w-3.5" />} label="Product(s)">
            <InlineText
              value={report.product}
              placeholder="Not set"
              onSave={(next) => save({ Product: next }, { product: next })}
            />
          </SidebarField>

          <SidebarField icon={<MapPin className="h-3.5 w-3.5" />} label="City">
            <InlineText
              value={report.city}
              placeholder="Not set"
              onSave={(next) => save({ City0: next }, { city: next })}
            />
          </SidebarField>

          <SidebarField icon={<MapPin className="h-3.5 w-3.5" />} label="State">
            <ChoiceSelect
              value={report.state}
              onChange={(v) => save({ State0: v }, { state: v })}
              options={US_STATES}
              emptyLabel="Not set"
              searchPlaceholder="Search states…"
            />
          </SidebarField>

          <div className="border-t border-border pt-3 text-[11px] text-fg-muted">
            Filed {report.createdAt.toLocaleDateString()} · last edited{" "}
            {report.modifiedAt.toLocaleDateString()}
          </div>
        </aside>
      </div>

      {showEdit && (
        <VisitReportFormModal report={report} onClose={() => setShowEdit(false)} />
      )}
    </div>
  );
}

/** A long text field with its own edit/save, mirroring the EIR detail cards. */
function TextCard({
  title,
  value,
  emptyLabel,
  onSave,
}: {
  title: string;
  value: string;
  emptyLabel: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  return (
    <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          {title}
        </h2>
        {editing ? (
          <div className="flex items-center gap-2">
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
        ) : (
          <button
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <AutoGrowTextarea
          style={{ minHeight: "8rem" }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          aria-label={title}
          className="w-full resize-y rounded-md border border-border bg-bg p-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      ) : value ? (
        // Plain text, newlines preserved — this list's columns are plain text,
        // not the Enhanced rich text the EIR long fields use.
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{value}</div>
      ) : (
        <div className="text-sm text-fg-muted">{emptyLabel}</div>
      )}
    </div>
  );
}

/** One-line text that turns into an input when clicked. */
function InlineText({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <button
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="w-full truncate rounded-md border border-transparent px-2 py-1 text-left text-sm text-fg transition-colors hover:border-border hover:bg-surface-2"
      >
        {value || <span className="text-fg-muted">{placeholder}</span>}
      </button>
    );
  }

  function commit() {
    setEditing(false);
    if (draft.trim() !== value) onSave(draft.trim());
  }

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className="input"
    />
  );
}

function SidebarField({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
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
