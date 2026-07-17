import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Calendar,
  ClipboardList,
  FolderOpen,
  GitBranch,
  HardDrive,
  Pencil,
  Tag,
  User,
} from "lucide-react";
import { useTestSheet } from "@/hooks/useTestSheets";
import { TestSheetFormModal } from "@/components/TestSheetFormModal";
import { LoadingTasks } from "@/components/LoadingTasks";
import { DetailTopBar } from "@/components/DetailTopBar";

export function TestSheetDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const sheetId = id ? parseInt(id, 10) : null;
  const { data: sheet, isLoading } = useTestSheet(sheetId);
  const [editing, setEditing] = useState(false);

  if (isLoading) {
    return <LoadingTasks noun="this test sheet" />;
  }

  if (!sheet) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-12">
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-fg-muted">
          Test sheet not found.
          <button
            onClick={() => navigate("/test-sheets")}
            className="mt-2 block w-full text-sm text-accent underline"
          >
            ← Back to test sheets
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Test Sheets" listTo="/test-sheets" />

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Header card */}
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-cooper-green/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-cooper-green">
                <ClipboardList className="h-3 w-3" />
                Test Sheet
              </span>
              {sheet.parentTask && (
                <button
                  onClick={() => navigate(`/task/${sheet.parentTask!.id}`)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-fg transition-colors hover:border-fg-muted"
                >
                  <GitBranch className="h-3 w-3" />
                  <span className="text-fg-muted">Task:</span>
                  <span className="font-medium">
                    {sheet.parentTask.numberedTitle || `#${sheet.parentTask.id}`}
                  </span>
                </button>
              )}
              <button
                onClick={() => setEditing(true)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </button>
            </div>
            <h1 className="font-display text-xl font-semibold leading-tight text-fg sm:text-2xl">
              {sheet.title}
            </h1>
          </div>

          <BodyCard title="Purpose" body={sheet.purpose} />
          <BodyCard title="Testing Steps" body={sheet.testingSteps} mono />
          <BodyCard title="Results" body={sheet.results} />
        </div>

        {/* Sidebar */}
        <aside className="w-full shrink-0 lg:w-80">
          <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
            <div className="grid gap-4">
              <Field icon={<Tag />} label="Product">
                {sheet.product || <span className="text-fg-muted">—</span>}
              </Field>

              <Field icon={<HardDrive />} label="Serial Number">
                {sheet.serialNumber ? (
                  <code className="text-xs">{sheet.serialNumber}</code>
                ) : (
                  <span className="text-fg-muted">—</span>
                )}
              </Field>

              <Field icon={<Calendar />} label="Test Date">
                {sheet.testDate
                  ? sheet.testDate.toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : <span className="text-fg-muted">—</span>}
              </Field>

              <Field icon={<Tag />} label="Firmware Version">
                {sheet.firmwareVersion ? (
                  <code className="text-xs">{sheet.firmwareVersion}</code>
                ) : (
                  <span className="text-fg-muted">—</span>
                )}
              </Field>

              <Field icon={<User />} label="Tester">
                {sheet.tester?.displayName ?? <span className="text-fg-muted">Unassigned</span>}
              </Field>

              <Field icon={<FolderOpen />} label="Project Reference">
                {sheet.parentProject ? (
                  <button
                    onClick={() => navigate(`/project/${sheet.parentProject!.lookupId}`)}
                    className="text-left text-accent underline-offset-2 hover:underline"
                  >
                    {sheet.parentProject.title || `#${sheet.parentProject.lookupId}`}
                  </button>
                ) : (
                  <span className="text-fg-muted">—</span>
                )}
              </Field>

              <Field icon={<GitBranch />} label="Task Reference">
                {sheet.parentTask ? (
                  <button
                    onClick={() => navigate(`/task/${sheet.parentTask!.id}`)}
                    className="text-left text-accent underline-offset-2 hover:underline"
                  >
                    {sheet.parentTask.numberedTitle || `#${sheet.parentTask.id}`}
                  </button>
                ) : (
                  <span className="text-fg-muted">—</span>
                )}
              </Field>

              <Field icon={<Calendar />} label="Created">
                {sheet.createdAt.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Field>

              <Field icon={<User />} label="Created By">
                {sheet.author?.displayName ?? <span className="text-fg-muted">Unknown</span>}
              </Field>
            </div>
          </div>
        </aside>
      </div>

      {editing && (
        <TestSheetFormModal mode="edit" sheet={sheet} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

function BodyCard({ title, body, mono }: { title: string; body: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
        {title}
      </h2>
      {body ? (
        <div
          className={`whitespace-pre-wrap text-sm text-fg ${
            mono ? "font-mono leading-relaxed" : "leading-relaxed"
          }`}
          style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
        >
          {body}
        </div>
      ) : (
        <div className="text-sm text-fg-muted">Not set.</div>
      )}
    </div>
  );
}

function Field({
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
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        {label}
      </div>
      <div className="text-sm text-fg">{children}</div>
    </div>
  );
}
