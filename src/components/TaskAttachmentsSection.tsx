import { useRef } from "react";
import {
  ExternalLink,
  FileText,
  FolderOpen,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import {
  RECENT_FILES_LIMIT,
  targetFilename,
} from "@/api/projectFiles";
import {
  useDeleteTaskFile,
  useDeleteTaskListAttachment,
  useResolvedTaskFolder,
  useTaskFiles,
  useTaskListAttachments,
  useUploadTaskFile,
} from "@/hooks/useTaskFiles";
import type { Task } from "@/types/task";

/**
 * Task detail Attachments card — routes through the site's Project
 * Folders document library instead of the legacy list-item attachments.
 * Shows the latest few files in the matching project folder; the rest
 * live in SharePoint behind a "View all" link.
 *
 * If the task's project doesn't match a folder, files are routed to the
 * shared Miscellaneous folder and the filename is prefixed with the
 * project code so they're still findable by search.
 */
export function TaskAttachmentsSection({ task }: { task: Task }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { resolved, isLoading: foldersLoading, error: foldersError } =
    useResolvedTaskFolder(task);
  const { data: files = [], isLoading: filesLoading, error: filesError } =
    useTaskFiles(task);
  const { data: listAttachments = [], isLoading: listLoading } =
    useTaskListAttachments(task);
  const upload = useUploadTaskFile(task);
  const remove = useDeleteTaskFile(task);
  const removeListAttachment = useDeleteTaskListAttachment(task);

  // Task-specific (list-item) attachments take priority — they were uploaded
  // explicitly to this task, vs. the project folder files which are shared
  // across every task in the same project.
  const totalCount = listAttachments.length + files.length;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = ""; // allow re-selecting the same file
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          <Paperclip className="h-4 w-4" />
          Attachments
          {totalCount > 0 && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold tabular-nums text-fg">
              {totalCount}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {resolved && (
            <a
              href={resolved.folder.webUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline"
              title={`Open ${resolved.folder.name} in SharePoint`}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              View all
            </a>
          )}
          <button
            onClick={() => fileInput.current?.click()}
            disabled={upload.isPending || !resolved}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:border-fg-muted disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            {upload.isPending ? "Uploading…" : "Add file"}
          </button>
          <input
            ref={fileInput}
            type="file"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      </div>

      {resolved && (
        <div className="mb-3 text-[11px] text-fg-muted">
          {resolved.kind === "project" ? (
            <>
              Files upload to both this task in SharePoint and the project
              folder <span className="font-mono">{resolved.folder.name}</span>.
              Task-specific files appear first.
            </>
          ) : (
            <>
              No project folder matched —{" "}
              <span className="font-mono">{resolved.folder.name}</span> is used
              instead and uploads are prefixed with the project code so they
              stay findable.
            </>
          )}
        </div>
      )}

      {foldersError ? (
        <UnavailableNotice message={`Couldn't load project folders: ${(foldersError as Error).message}`} />
      ) : filesError ? (
        <UnavailableNotice message={`Couldn't list files: ${(filesError as Error).message}`} />
      ) : foldersLoading || filesLoading || listLoading ? (
        <div className="py-3 text-center text-xs text-fg-muted">Loading…</div>
      ) : !resolved ? (
        <div className="rounded-md border border-dashed border-border py-6 text-center text-xs text-fg-muted">
          No Project Folders / Miscellaneous folder is configured on this
          site.
        </div>
      ) : totalCount === 0 ? (
        <div className="rounded-md border border-dashed border-border py-6 text-center text-xs text-fg-muted">
          No attachments yet. Click "Add file" to upload one — it'll go on
          this task and the project folder.
        </div>
      ) : (
        <div className="space-y-3">
          {listAttachments.length > 0 && (
            <div>
              <SubHeading>On this task ({listAttachments.length})</SubHeading>
              <ul className="flex flex-col gap-1.5">
                {listAttachments.map((a) => (
                  <li
                    key={a.serverRelativeUrl}
                    className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-sm"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-accent" />
                    <a
                      href={a.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1 truncate text-fg hover:text-accent hover:underline"
                      title={a.fileName}
                    >
                      {a.fileName}
                    </a>
                    <a
                      href={a.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-fg-muted hover:text-fg"
                      aria-label={`Open ${a.fileName}`}
                      title="Open"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove "${a.fileName}" from this task's attachments? The copy in the project folder (if any) is not affected.`,
                          )
                        ) {
                          removeListAttachment.mutate(a.fileName);
                        }
                      }}
                      disabled={removeListAttachment.isPending}
                      className="text-fg-muted hover:text-cooper-red disabled:opacity-50"
                      aria-label={`Remove ${a.fileName}`}
                      title="Remove from task"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {files.length > 0 && (
            <div>
              <SubHeading>
                From {resolved.folder.name} ({files.length})
              </SubHeading>
              <ul className="flex flex-col gap-1.5">
                {files.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-fg-muted" />
                    <a
                      href={f.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1 truncate text-fg hover:text-accent hover:underline"
                      title={f.name}
                    >
                      {f.name}
                    </a>
                    <span
                      className="shrink-0 text-[10px] text-fg-muted tabular-nums"
                      title={f.lastModified.toLocaleString()}
                    >
                      {f.lastModified.toLocaleDateString()}
                    </span>
                    <a
                      href={f.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-fg-muted hover:text-fg"
                      aria-label={`Open ${f.name}`}
                      title="Open"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove "${f.name}" from ${resolved.folder.name}? This deletes the file from SharePoint.`,
                          )
                        ) {
                          remove.mutate(f.id);
                        }
                      }}
                      disabled={remove.isPending}
                      className="text-fg-muted hover:text-cooper-red disabled:opacity-50"
                      aria-label={`Remove ${f.name}`}
                      title="Remove from project folder"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {files.length >= RECENT_FILES_LIMIT && resolved && (
        <div className="mt-2 text-[11px] text-fg-muted">
          Showing the {RECENT_FILES_LIMIT} most-recently-modified project
          folder files.{" "}
          <a
            href={resolved.folder.webUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline-offset-2 hover:underline"
          >
            View all in SharePoint →
          </a>
        </div>
      )}

      {upload.error && (
        <div className="mt-2 rounded-md border border-cooper-red/30 bg-cooper-red/10 px-2 py-1 text-xs text-cooper-red">
          Upload failed: {(upload.error as Error).message}
        </div>
      )}
      {remove.error && (
        <div className="mt-2 rounded-md border border-cooper-red/30 bg-cooper-red/10 px-2 py-1 text-xs text-cooper-red">
          Delete failed: {(remove.error as Error).message}
        </div>
      )}
      {upload.isPending && resolved && upload.variables instanceof File && (
        <div className="mt-2 text-[11px] text-fg-muted">
          Uploading <span className="font-mono">{targetFilename(resolved, upload.variables.name)}</span> to{" "}
          <span className="font-mono">{resolved.folder.name}</span>…
        </div>
      )}
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
      {children}
    </div>
  );
}

function UnavailableNotice({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-cooper-red/40 bg-cooper-red/5 p-3 text-xs text-fg">
      <div className="font-semibold text-cooper-red">Attachments unavailable</div>
      <p className="mt-1 text-fg-muted">{message}</p>
    </div>
  );
}
