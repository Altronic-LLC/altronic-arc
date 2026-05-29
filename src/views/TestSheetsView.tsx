import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Plus, Search } from "lucide-react";
import { useTestSheets } from "@/hooks/useTestSheets";
import { TestSheetFormModal } from "@/components/TestSheetFormModal";
import { LoadingTasks } from "@/components/LoadingTasks";
import type { TestSheet } from "@/types/task";

export function TestSheetsView() {
  const navigate = useNavigate();
  const { data: sheets = [], isLoading } = useTestSheets();
  const [query, setQuery] = useState("");
  const [showNew, setShowNew] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? sheets.filter((s) => {
          const hay = [
            s.title,
            s.product,
            s.serialNumber,
            s.purpose,
            s.results,
            s.firmwareVersion,
            s.parentProject?.title ?? "",
            s.parentTask?.numberedTitle ?? "",
            s.tester?.displayName ?? "",
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      : sheets;
    // Newest first by creation date — matches the task & EIR list convention.
    return [...matched].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }, [sheets, query]);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-fg-muted" />
          <h1 className="font-display text-lg font-semibold text-fg sm:text-xl">Test Sheets</h1>
          <span className="text-xs text-fg-muted">
            {filtered.length}
            {filtered.length !== sheets.length && ` of ${sheets.length}`}
          </span>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Test Sheet</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, product, serial, results, project, task…"
          className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
        />
      </div>

      {isLoading ? (
        <LoadingTasks noun="test sheets" />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
          {sheets.length === 0
            ? "No test sheets yet. Click 'New Test Sheet' to create the first one."
            : "No test sheets match your search."}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((s) => (
            <Row key={s.id} sheet={s} onOpen={() => navigate(`/test-sheet/${s.id}`)} />
          ))}
        </div>
      )}

      {showNew && <TestSheetFormModal mode="create" onClose={() => setShowNew(false)} />}
    </div>
  );
}

function Row({ sheet, onOpen }: { sheet: TestSheet; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="grid grid-cols-1 items-start gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-fg-muted hover:bg-surface-2 sm:grid-cols-[1.4fr_1fr_0.7fr_1fr_1fr_1fr] sm:items-center sm:gap-4"
    >
      <div className="min-w-0">
        <div className="truncate font-medium text-fg">{sheet.title}</div>
        {sheet.purpose && (
          <div className="mt-0.5 truncate text-xs text-fg-muted">{sheet.purpose}</div>
        )}
      </div>
      <div className="min-w-0 text-sm text-fg sm:truncate">
        <span className="text-fg-muted sm:hidden">Product: </span>
        {sheet.product || <span className="text-fg-muted">—</span>}
      </div>
      <div className="text-sm text-fg sm:truncate">
        <span className="text-fg-muted sm:hidden">Date: </span>
        {sheet.testDate
          ? sheet.testDate.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : <span className="text-fg-muted">—</span>}
      </div>
      <div className="min-w-0 text-sm text-fg sm:truncate">
        <span className="text-fg-muted sm:hidden">Tester: </span>
        {sheet.tester?.displayName ?? <span className="text-fg-muted">—</span>}
      </div>
      <div className="min-w-0 text-sm text-fg sm:truncate">
        <span className="text-fg-muted sm:hidden">Project: </span>
        {sheet.parentProject?.title || (
          <span className="text-fg-muted">
            {sheet.parentProject ? `#${sheet.parentProject.lookupId}` : "—"}
          </span>
        )}
      </div>
      <div className="min-w-0 text-sm text-fg sm:truncate">
        <span className="text-fg-muted sm:hidden">Task: </span>
        {sheet.parentTask?.numberedTitle || (
          <span className="text-fg-muted">
            {sheet.parentTask ? `#${sheet.parentTask.id}` : "—"}
          </span>
        )}
      </div>
    </button>
  );
}
