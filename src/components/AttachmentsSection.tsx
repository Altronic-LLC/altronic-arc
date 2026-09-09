import { useRef, useState } from "react";
import { Download, FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import {
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
} from "@/hooks/useAttachments";
import {
  refreshSharePointAccess,
  SharePointUnavailableError,
  type SharePointUnavailableCause,
} from "@/api/sharepoint";
import {
  fetchAttachmentBlob,
  isReservedImageAttachment,
  type AttachmentParent,
} from "@/api/attachments";
import { filesFromClipboard } from "@/lib/pasteFiles";
import { useFileDrop } from "./useFileDrop";
import { cn } from "@/lib/cn";
import { NameAttachmentDialog, needsAttachmentName } from "./NameAttachmentDialog";
import { pushToast } from "./Toast";

/**
 * What to call the thing a file is being removed FROM, in the delete
 * confirmation. A map rather than the nested ternary this used to be — that
 * chain had to be re-read end to end to add one entry, and a new parent kind
 * silently inherited "task" (the fallback) rather than its own noun.
 *
 * Only the kinds with a noun of their own are listed; everything else still
 * falls back to "task", exactly as before.
 */
// The noun in "Delete this <noun>'s attachment?".
//
// Every parent gets an entry. The `?? "task"` fallback below used to catch
// eight of these, so deleting a file off a supplier, an ECN, a FAIT or a
// machine asked "Delete this task's attachment?" on screens that have no
// tasks anywhere near them. Harmless-looking and wrong on live pages, which
// is exactly the kind of thing nobody reports.
const PARENT_NOUN: Record<AttachmentParent, string> = {
  task: "task",
  eir: "EIR",
  ecn: "ECN",
  fait: "FAIT",
  operationsTask: "task",
  maintenanceTask: "work order",
  equipment: "asset",
  scheduledMaintenance: "schedule",
  buildRequest: "build request",
  buildRequestItem: "part",
  panelOrder: "panel order",
  panelTask: "panel task",
  panelQcIssue: "issue",
  csaListing: "CSA listing",
  visitReport: "visit report",
  grayMarketRequest: "request",
  supplier: "supplier",
  supplierContact: "contact",
  supplierIssue: "issue",
  costImpactNotice: "notice",
};

export function parentNoun(parent: AttachmentParent): string {
  // A TOTAL Record, so adding an AttachmentParent without a noun is a
  // compile error rather than a silent "task" on a new screen.
  return PARENT_NOUN[parent];
}

interface AttachmentsSectionProps {
  parent: AttachmentParent;
  itemId: number;
}

/**
 * Attachments card used by Task and EIR detail. Shows the current
 * attachments, lets the user add or remove. Reads from the SharePoint
 * REST API via useAttachments; if the SP REST endpoint isn't reachable
 * (admin hasn't granted the API permission yet) the section degrades
 * to a friendly notice instead of crashing the detail view.
 */
export function AttachmentsSection({ parent, itemId }: AttachmentsSectionProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: rawAttachments = [], isLoading, error, refetch } = useAttachments(parent, itemId);
  // A SharePoint "Image" column's hidden backing file (e.g. Suppliers List's
  // Logo) rides along in the same attachment list — hide it here so it can't
  // be deleted through this generic UI. SupplierLogo is the one place that
  // reads it back out.
  const attachments = rawAttachments.filter((a) => !isReservedImageAttachment(a.fileName));
  const upload = useUploadAttachment(parent, itemId);
  const remove = useDeleteAttachment(parent, itemId);

  // Unnamed screenshots wait here for the user to name them before they're
  // uploaded — one dialog at a time, so pasting several in a row prompts for
  // each rather than dropping the ones after the first.
  const [namingQueue, setNamingQueue] = useState<File[]>([]);

  /**
   * Upload a batch of files, prompting for a name for any that arrived
   * without one. Shared by the file picker, paste, and drag-and-drop so all
   * three behave identically.
   */
  function addFiles(files: File[]) {
    const unnamed: File[] = [];
    for (const file of files) {
      if (needsAttachmentName(file)) unnamed.push(file);
      else upload.mutate(file);
    }
    if (unnamed.length > 0) setNamingQueue((prev) => [...prev, ...unnamed]);
  }

  const { dragging, dropProps } = useFileDrop(addFiles, upload.isPending);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = ""; // allow re-selecting the same file
  }

  // Which attachment is currently being fetched for download — at most one
  // at a time, so a second click on another row while the first is still
  // in flight is a distinct, independently-tracked download.
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  /**
   * Download a file via the authenticated `_api/…/$value` endpoint rather
   * than a bare `<a href={downloadUrl} download>`.
   *
   * `downloadUrl` is the plain, unauthenticated `ServerRelativeUrl` file
   * link — the SAME shape that silently 401s an `<img>` fetch (see
   * `SupplierLogo.tsx`'s doc comment). A plain `<a download>` click on it
   * doesn't do a real page navigation (which CAN follow an interactive
   * sign-in redirect); the `download` attribute makes the browser fetch it
   * invisibly in the background using only whatever SharePoint session
   * cookie the browser already happens to have. On desktop that's often
   * masked by already being signed into Office in the same browser; on a
   * phone — especially inside the installed PWA, which keeps no such
   * cookie at all — there usually isn't one, so the download silently does
   * nothing (Ray, 2026-08-27: "I need the ability to download attachments
   * from CSA listing especially on mobile").
   *
   * `fetchAttachmentBlob` is the same authenticated, CORS-friendly `_api/`
   * fetch the Supplier Logo feature already uses for exactly this reason —
   * routing every download through it here fixes it for every consumer of
   * this shared component (CSA Listings, EIRs, ECNs, FAITs, Gray Market
   * Requests, Suppliers and more) in one place, not just CSA. The blob it
   * returns is turned into a same-origin `blob:` URL, which Safari (mobile
   * included) DOES honour the `download` attribute for, unlike a
   * cross-origin one.
   */
  async function handleDownload(fileName: string) {
    setDownloadingFile(fileName);
    try {
      const blob = await fetchAttachmentBlob(parent, itemId, fileName);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Not revoked immediately — some browsers start the save
      // asynchronously and a same-tick revoke can cancel it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      pushToast({
        message: `Couldn't download "${fileName}". ${(err as Error).message}`,
        variant: "error",
      });
    } finally {
      setDownloadingFile(null);
    }
  }

  /**
   * Paste a screenshot straight into the card. The card carries tabIndex so it
   * can hold focus and receive the paste at all — a document-level listener
   * isn't an option here, because a build request renders one of these cards
   * per part and every one of them would claim the same paste.
   *
   * A file pasted with a real name uploads immediately, as before. An
   * unnamed screenshot is queued for the naming prompt instead.
   */
  function handlePaste(e: React.ClipboardEvent) {
    const pasted = filesFromClipboard(e.clipboardData);
    if (pasted.length === 0) return;
    e.preventDefault();
    addFiles(pasted);
  }

  return (
    <div
      tabIndex={0}
      onPaste={handlePaste}
      {...dropProps}
      className={cn(
        "rounded-lg border bg-surface p-4 focus:outline-none focus:ring-2 focus:ring-accent/30 sm:p-5",
        dragging ? "border-accent ring-2 ring-accent/30" : "border-border",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          <Paperclip className="h-4 w-4" />
          Attachments
          {attachments.length > 0 && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold tabular-nums text-fg">
              {attachments.length}
            </span>
          )}
        </h2>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={upload.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:border-fg-muted disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          {upload.isPending ? "Uploading…" : "Add file"}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {error instanceof SharePointUnavailableError ? (
        <UnavailableNotice
          message={error.message}
          cause={error.cause}
          onRetry={() => void refetch()}
        />
      ) : error ? (
        <UnavailableNotice message={(error as Error).message} cause="consent" />
      ) : isLoading ? (
        <div className="py-4 text-center text-xs text-fg-muted">Loading attachments…</div>
      ) : attachments.length === 0 ? (
        <div className="rounded-md border border-dashed border-border py-6 text-center text-xs text-fg-muted">
          {dragging
            ? "Drop to attach"
            : 'No attachments yet. Drag files here, paste a screenshot, or click "Add file".'}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {attachments.map((a) => (
            <li
              key={a.serverRelativeUrl}
              className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm"
            >
              <FileText className="h-4 w-4 shrink-0 text-fg-muted" />
              <button
                type="button"
                onClick={() => handleDownload(a.fileName)}
                disabled={downloadingFile === a.fileName}
                className="min-w-0 flex-1 truncate text-left text-fg hover:text-accent hover:underline disabled:opacity-70"
                title={a.fileName}
              >
                {a.fileName}
              </button>
              <button
                type="button"
                onClick={() => handleDownload(a.fileName)}
                disabled={downloadingFile === a.fileName}
                className="text-fg-muted hover:text-fg disabled:opacity-50"
                aria-label={`Download ${a.fileName}`}
                title="Download"
              >
                {downloadingFile === a.fileName ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove "${a.fileName}" from this ${parentNoun(parent)}?`,
                    )
                  ) {
                    remove.mutate(a.fileName);
                  }
                }}
                disabled={remove.isPending}
                className="text-fg-muted hover:text-cooper-red disabled:opacity-50"
                aria-label={`Remove ${a.fileName}`}
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {upload.error && (
        <div className="mt-2 text-xs text-cooper-red">
          Upload failed: {(upload.error as Error).message}
        </div>
      )}

      {namingQueue.length > 0 && (
        <NameAttachmentDialog
          file={namingQueue[0]}
          onConfirm={(renamed) => {
            upload.mutate(renamed);
            setNamingQueue((prev) => prev.slice(1));
          }}
          onCancel={() => setNamingQueue((prev) => prev.slice(1))}
        />
      )}
    </div>
  );
}

/**
 * Why attachments aren't working — and, when it's the reader's own session,
 * a way out of it.
 *
 * This said "an admin hasn't granted it yet" whatever went wrong, including
 * when the real cause was the reader's own expired MFA. That sends someone to
 * raise a ticket for something they can fix in ten seconds (Ray, 2026-08-20).
 */
function UnavailableNotice({
  message,
  cause,
  onRetry,
}: {
  message: string;
  cause: SharePointUnavailableCause;
  onRetry?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function signInAgain() {
    setBusy(true);
    setFailed(null);
    try {
      await refreshSharePointAccess();
      onRetry?.();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Sign-in didn't complete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-dashed border-cooper-red/40 bg-cooper-red/5 p-3 text-xs text-fg">
      <div className="font-semibold text-cooper-red">Attachments unavailable</div>
      <p className="mt-1 text-fg-muted">{message}</p>
      {cause === "reauth" ? (
        <>
          <button
            type="button"
            onClick={signInAgain}
            disabled={busy}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy ? "Opening sign-in…" : "Sign in again"}
          </button>
          {failed && <p className="mt-1 text-cooper-red">{failed}</p>}
          <p className="mt-1 text-fg-muted">
            Nothing else on this page is affected — only attachments need the
            fresh sign-in.
          </p>
        </>
      ) : (
        <p className="mt-1 text-fg-muted">
          Once an admin grants the app SharePoint REST access and sets{" "}
          <code>VITE_SP_SITE_URL</code>, attachments will start working
          everywhere.
        </p>
      )}
    </div>
  );
}
