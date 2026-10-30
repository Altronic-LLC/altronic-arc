import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import type { Quote } from "@/types/quote";
import type { QuotePatch } from "@/lib/quoteMapper";
import { useProjects, useTasks } from "@/hooks/useTasks";
import { useOperationsProjects, useOperationsTasks } from "@/hooks/useOperationsTasks";
import { SingleSelect } from "./SearchableSelect";

// =============================================================================
// A quote's links to the work behind it — the Engineering and Operations
// task and project it relates to (the 2026-10-27 review: "enable linking of
// Engineering / Operations tasks or projects to quotes"). Sits in the quote
// page's right panel.
//
// Stored on the Quotes header: a task as its item id (EngineeringTaskId /
// OperationsTaskId — Number columns, since Graph can't write a Hyperlink
// column), a project as its TITLE (EngineeringProjectRef /
// OperationsProjectRef — the SCN pattern; the Engineering Projects list is on
// another site collection, so a lookup is impossible).
//
// Each pick saves straight away through `onPatch`. A link is collaboration,
// not an edit of what was sent, so the page doesn't put it behind the Sent
// guard — but only somebody who can edit the quote may change one.
//
// A stored value the lists no longer offer (a task deleted, a project
// renamed) stays in its picker, marked, so a save can't silently clear it —
// and an id is never shown as "Not linked".
// =============================================================================

interface QuoteLinksPanelProps {
  quote: Quote;
  canEdit: boolean;
  onPatch: (patch: QuotePatch) => void;
}

type Option = { value: string; label: string };

/** Keep `current` in `options`, marked, when the list no longer has it. */
export function withStoredValue(options: Option[], current: string, missingLabel: string): Option[] {
  if (!current || options.some((o) => o.value === current)) return options;
  return [{ value: current, label: missingLabel }, ...options];
}

function byLabel(a: Option, b: Option): number {
  return a.label.localeCompare(b.label, undefined, { numeric: true });
}

export function QuoteLinksPanel({ quote, canEdit, onPatch }: QuoteLinksPanelProps) {
  const { data: engProjects = [] } = useProjects();
  const { data: engTasks = [] } = useTasks();
  const { data: opsProjects = [] } = useOperationsProjects();
  const { data: opsTasks = [] } = useOperationsTasks();

  const engProjectOptions = useMemo(
    () =>
      withStoredValue(
        engProjects.map((p) => ({ value: p.title, label: p.title })).sort(byLabel),
        quote.engineeringProjectRef,
        `${quote.engineeringProjectRef} (not an Engineering project)`,
      ),
    [engProjects, quote.engineeringProjectRef],
  );
  const opsProjectOptions = useMemo(
    () =>
      withStoredValue(
        opsProjects.map((p) => ({ value: p.title, label: p.title })).sort(byLabel),
        quote.operationsProjectRef,
        `${quote.operationsProjectRef} (not an Operations project)`,
      ),
    [opsProjects, quote.operationsProjectRef],
  );
  const engTaskOptions = useMemo(
    () =>
      withStoredValue(
        engTasks.map((t) => ({ value: String(t.id), label: t.numberedTitle || t.title })).sort(byLabel),
        quote.engineeringTaskId === null ? "" : String(quote.engineeringTaskId),
        `Task #${quote.engineeringTaskId}`,
      ),
    [engTasks, quote.engineeringTaskId],
  );
  const opsTaskOptions = useMemo(
    () =>
      withStoredValue(
        opsTasks
          .map((t) => ({ value: String(t.id), label: [t.taskNumber, t.title].filter(Boolean).join(" — ") }))
          .sort(byLabel),
        quote.operationsTaskId === null ? "" : String(quote.operationsTaskId),
        `Operations task #${quote.operationsTaskId}`,
      ),
    [opsTasks, quote.operationsTaskId],
  );

  const toId = (v: string | null) => (v ? Number(v) : null);

  return (
    <div className="flex flex-col gap-3" data-testid="quote-links">
      <LinkField label="Engineering project">
        <SingleSelect
          ariaLabel="Engineering project"
          options={engProjectOptions}
          selected={quote.engineeringProjectRef || null}
          onChange={(v) => onPatch({ engineeringProjectRef: v ?? "" })}
          allLabel="Not linked"
          searchPlaceholder="Search projects…"
          disabled={!canEdit}
        />
      </LinkField>
      <LinkField
        label="Engineering task"
        open={quote.engineeringTaskId === null ? null : `/task/${quote.engineeringTaskId}`}
      >
        <SingleSelect
          ariaLabel="Engineering task"
          options={engTaskOptions}
          selected={quote.engineeringTaskId === null ? null : String(quote.engineeringTaskId)}
          onChange={(v) => onPatch({ engineeringTaskId: toId(v) })}
          allLabel="Not linked"
          searchPlaceholder="Search tasks…"
          disabled={!canEdit}
        />
      </LinkField>
      <LinkField label="Operations project">
        <SingleSelect
          ariaLabel="Operations project"
          options={opsProjectOptions}
          selected={quote.operationsProjectRef || null}
          onChange={(v) => onPatch({ operationsProjectRef: v ?? "" })}
          allLabel="Not linked"
          searchPlaceholder="Search projects…"
          disabled={!canEdit}
        />
      </LinkField>
      <LinkField
        label="Operations task"
        open={quote.operationsTaskId === null ? null : `/operations/task/${quote.operationsTaskId}`}
      >
        <SingleSelect
          ariaLabel="Operations task"
          options={opsTaskOptions}
          selected={quote.operationsTaskId === null ? null : String(quote.operationsTaskId)}
          onChange={(v) => onPatch({ operationsTaskId: toId(v) })}
          allLabel="Not linked"
          searchPlaceholder="Search tasks…"
          disabled={!canEdit}
        />
      </LinkField>
    </div>
  );
}

function LinkField({ label, open, children }: { label: string; open?: string | null; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
        {open && (
          <Link
            to={open}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
            aria-label={`Open the linked ${label.toLowerCase()}`}
          >
            Open
            <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}
