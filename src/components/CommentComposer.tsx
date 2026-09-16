import { AtSign, Paperclip, Send, Type, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CommentAttachment, Person } from "@/types/task";
import { filesFromClipboard } from "@/lib/pasteFiles";
import {
  buildCommentHtml,
  injectMentionsIntoHtml,
  detectMentionQuery,
  rankMentionCandidates,
  type MentionCandidates,
} from "@/lib/mentions";
import { cn } from "@/lib/cn";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { NameAttachmentDialog, needsAttachmentName } from "./NameAttachmentDialog";
import { useFileDrop } from "./useFileDrop";
import { plainTextToHtml } from "@/lib/richText";
import { RichTextEditor } from "./RichTextEditor";
import {
  RichTextWarningDialog,
  WATCHERS_STILL_NOTIFIED,
} from "./RichTextWarningDialog";

interface CommentComposerProps {
  onSubmit: (
    bodyHtml: string,
    attachments: CommentAttachment[],
  ) => void | Promise<void>;
  disabled?: boolean;
  /**
   * People available for @-mentions. Typically the collected set of
   * assignees + watchers across tasks, plus the current user. Composer
   * shows them in a popup when the user types `@`.
   */
  mentionablePeople?: Person[];
  /**
   * Optional per-file upload hook. When supplied, the composer uploads
   * each attached File through this function before submit, and inlines
   * the resulting links into the comment body HTML as `<a>` tags. The
   * `attachments` array passed to `onSubmit` is empty in that case —
   * everything's in the body. Used to route Task comment attachments
   * into the SharePoint project folder; EIRs leave this unset and keep
   * the legacy in-memory blob attachment shape.
   */
  uploadFile?: (file: File) => Promise<{ name: string; webUrl: string }>;
  /**
   * What the rich-text warning says about who still hears about this comment.
   *
   * Every thread states its OWN rule — "watchers are still notified" is not
   * universal. ECNs, Customer Notes and Cost Impact Notices have no Watchers
   * column at all, so they pass `SUBMITTER_STILL_NOTIFIED`. Defaults to the
   * watcher rule, which is what the other threads follow.
   */
  richTextNotifyNote?: string;
}

/**
 * Plain-text composer with file/image attachments and @-mention support.
 * Wraps each text paragraph in <p> tags before sending. Mentions picked
 * from the popup are persisted as <span class="mention" data-email="...">
 * via the buildCommentHtml() helper so the email-notification path can
 * later extract who to mail.
 */
/**
 * Local extension of CommentAttachment — keeps the raw File reference
 * so we can upload it on submit when the parent provides `uploadFile`.
 * Not exported; this stays inside the composer.
 */
interface PendingAttachment extends CommentAttachment {
  file: File;
}

/**
 * Is there anything in this HTML a reader would see?
 *
 * An empty contentEditable is not an empty string — browsers leave
 * `<p><br></p>`, `<br>` or `&nbsp;` behind. Trimming the string would call
 * that content and post a blank comment.
 */
function nonEmptyHtml(html: string): string {
  const stripped = html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]*>/g, "")
    .trim();
  return stripped ? html : "";
}

/** Stable empty result so the closed picker doesn't churn the memo. */
const NO_CANDIDATES: MentionCandidates = { people: [], total: 0, truncated: false };

export function CommentComposer({
  onSubmit,
  disabled,
  mentionablePeople = [],
  uploadFile,
  richTextNotifyNote = WATCHERS_STILL_NOTIFIED,
}: CommentComposerProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Unnamed screenshots wait here for the user to name them before they
  // become attachments — one dialog at a time, so pasting several in a row
  // prompts for each rather than dropping the ones after the first.
  const [namingQueue, setNamingQueue] = useState<File[]>([]);

  // Picked mentions stay in their own array so we know which `@Name`
  // substrings to convert to chips at submit time. Users can manually
  // type "@foo" and it stays plain text — only chosen mentions become chips.
  const [mentions, setMentions] = useState<Person[]>([]);
  // Rich text is OPT-IN per comment, and plain text is what loads: the
  // @-mention picker only works in a textarea, so defaulting to rich would
  // silently take the feature away from everybody (Ray, 2026-09-16).
  const [rich, setRich] = useState(false);
  const [richHtml, setRichHtml] = useState("");
  const [warnRich, setWarnRich] = useState(false);

  // Mention popup state: the open boolean plus what the user has typed
  // after the `@`. We compute candidates from mentionablePeople filtered
  // by the query. activeIndex tracks the keyboard-highlighted candidate.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  // Position of the @ in the current text — used to replace it with the
  // chosen name when the user selects from the popup.
  const atPosRef = useRef<number | null>(null);

  function addFiles(files: FileList | File[]) {
    const newOnes: PendingAttachment[] = [];
    for (const file of Array.from(files)) {
      newOnes.push({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        objectUrl: URL.createObjectURL(file),
        file,
      });
    }
    setAttachments((prev) => [...prev, ...newOnes]);
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.id === id);
      if (removed?.objectUrl) URL.revokeObjectURL(removed.objectUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  const { dragging: isDragging, dropProps } = useFileDrop(addFiles, disabled || busy);

  // People filtered by the user's query after the @ — first-letter and
  // substring matches both count, scored slightly higher for prefix. The
  // ranking + cap live in `rankMentionCandidates` so the cap is one shared
  // number and `total` comes back with the list: several people share a common
  // first name at Altronic, and every match has to stay reachable by scrolling
  // rather than being chopped off the end of a short list.
  const {
    people: candidates,
    total: candidateTotal,
    truncated: candidatesTruncated,
  } = useMemo(
    () =>
      pickerOpen ? rankMentionCandidates(mentionablePeople, pickerQuery) : NO_CANDIDATES,
    [mentionablePeople, pickerQuery, pickerOpen],
  );

  // Keep activeIndex in range when candidates change.
  useEffect(() => {
    if (activeIndex >= candidates.length) setActiveIndex(0);
  }, [candidates.length, activeIndex]);

  // Keep the keyboard-highlighted option inside the scroll area. Without this,
  // arrowing past the ~8 visible rows moves an invisible highlight. `nearest`
  // scrolls the minimum needed, so it doesn't jump when the row is already in
  // view. Optional-called because jsdom (tests) doesn't implement it.
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    if (!pickerOpen) return;
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, pickerOpen, candidates.length]);

  /**
   * Inspect the text up to the caret and decide whether the user is
   * actively typing a mention (i.e. they typed `@` recently and haven't
   * passed a space yet). If yes, open the picker and capture the query.
   */
  function detectMention(nextText: string, caret: number) {
    // Shared with the other mention picker — see detectMentionQuery in
    // lib/mentions.ts. It allows one space in the query, so a full
    // "First Last" can be typed.
    const found = detectMentionQuery(nextText, caret);
    if (found) {
      atPosRef.current = found.at;
      setPickerQuery(found.query);
      setPickerOpen(true);
      return;
    }
    setPickerOpen(false);
    atPosRef.current = null;
  }

  function handleTextChange(next: string) {
    setText(next);
    const caret = textareaRef.current?.selectionStart ?? next.length;
    detectMention(next, caret);
  }

  function pickMention(person: Person) {
    const at = atPosRef.current;
    if (at == null) return;
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, at);
    const after = text.slice(caret);
    // Insert "@Display Name " (with trailing space) so the user can keep
    // typing right after the chip without having to add it themselves.
    const inserted = `@${person.displayName} `;
    const nextText = before + inserted + after;
    setText(nextText);
    setMentions((prev) => {
      const key = (person.email ?? person.displayName).toLowerCase();
      const has = prev.some(
        (p) => (p.email ?? p.displayName).toLowerCase() === key,
      );
      return has ? prev : [...prev, person];
    });
    setPickerOpen(false);
    atPosRef.current = null;
    // Restore caret right after the inserted name.
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = before.length + inserted.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }

  async function handleSend() {
    const trimmed = text.trim();
    // `richHtml` is markup, so "is there anything here" can't be a trim() —
    // an empty contentEditable yields things like "<p><br></p>".
    const richBody = rich ? nonEmptyHtml(richHtml) : "";
    if (!trimmed && !richBody && attachments.length === 0) return;
    setBusy(true);
    setUploadError(null);
    try {
      // Two builders, one output shape. Plain text is escaped and wrapped in
      // <p> by buildCommentHtml; rich text is ALREADY markup, so it only
      // needs the chips injecting — running it through buildCommentHtml would
      // show `<strong>` as visible text. Both emit the same chip markup, so
      // extractMentionedRecipients and the whole email path read either.
      let html = rich
        ? richBody
          ? injectMentionsIntoHtml(richBody, mentions)
          : ""
        : trimmed
          ? buildCommentHtml(trimmed, mentions)
          : "";

      // If the parent wired up an upload hook (Task case), push each
      // attached File to the project folder first, then inline a clean
      // hyperlink for each one at the bottom of the body. The legacy
      // `attachments` channel goes empty in that path — the links live
      // in the comment HTML, which is what users actually see + click.
      if (uploadFile && attachments.length > 0) {
        const uploaded: { name: string; webUrl: string }[] = [];
        for (const a of attachments) {
          // eslint-disable-next-line no-await-in-loop
          const result = await uploadFile(a.file);
          uploaded.push(result);
        }
        const linksHtml = uploaded
          .map(
            (u) =>
              `<p>📎 <a href="${escapeAttr(u.webUrl)}" target="_blank" rel="noopener noreferrer">${escapeText(u.name)}</a></p>`,
          )
          .join("");
        html = html + linksHtml;
        await onSubmit(html, []);
      } else {
        // Legacy in-memory attachment shape (EIR composer + mock mode).
        await onSubmit(html, attachments);
      }

      setText("");
      setRichHtml("");
      // Release any blob URLs we created for previews.
      for (const a of attachments) {
        if (a.objectUrl) URL.revokeObjectURL(a.objectUrl);
      }
      setAttachments([]);
      setMentions([]);
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? `Couldn't attach file: ${err.message}`
          : "Couldn't attach file.",
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Ctrl+V attaches screenshots and copied files. `filesFromClipboard` returns
   * [] for an ordinary text paste, so the default paste behaviour is left
   * alone in that case — only prevented when we're actually taking files.
   *
   * A pasted file with a real name (copied from File Explorer) attaches
   * immediately, same as before. An unnamed screenshot — recognisable by
   * the timestamped name `filesFromClipboard` gave it — is queued for the
   * naming prompt instead of attaching under that generated name.
   */
  function handlePaste(e: React.ClipboardEvent) {
    const pasted = filesFromClipboard(e.clipboardData);
    if (pasted.length === 0) return;
    e.preventDefault();
    const named: File[] = [];
    const unnamed: File[] = [];
    for (const file of pasted) {
      (needsAttachmentName(file) ? unnamed : named).push(file);
    }
    if (named.length > 0) addFiles(named);
    if (unnamed.length > 0) setNamingQueue((prev) => [...prev, ...unnamed]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (pickerOpen && candidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % candidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        // Enter or Tab accepts the highlighted person (Tab is prevented from
        // moving focus out of the textarea while the picker is open).
        e.preventDefault();
        pickMention(candidates[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPickerOpen(false);
        atPosRef.current = null;
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  }

  const hasBody = rich ? nonEmptyHtml(richHtml) !== "" : text.trim().length > 0;
  const canSend = (hasBody || attachments.length > 0) && !busy;

  return (
    <div
      className={cn(
        "relative rounded-lg border bg-surface p-3 transition-colors",
        isDragging ? "border-accent bg-accent/5" : "border-border",
      )}
      {...dropProps}
      onPaste={handlePaste}
    >
      {rich ? (
        <RichTextEditor
          value={richHtml}
          onChange={setRichHtml}
          disabled={disabled || busy}
          minHeight="6.5rem"
          placeholder="Write a comment…"
          aria-label="Comment (rich text)"
        />
      ) : (
      <AutoGrowTextarea
        ref={textareaRef}
        style={{ minHeight: "6.5rem" }}
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        onSelect={() => {
          const ta = textareaRef.current;
          if (!ta) return;
          detectMention(text, ta.selectionStart);
        }}
        onKeyDown={handleKeyDown}
        placeholder={
          isDragging
            ? "Drop files here…"
            : "Write a comment… (type @ to mention someone, drop or paste files to attach)"
        }
        disabled={disabled || busy}
        rows={4}
        className="w-full resize-y rounded-md bg-bg p-3 text-base text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-accent/30 sm:text-sm"
      />
      )}

      {pickerOpen && candidates.length > 0 && (
        // max-h-72 fits ~8 rows and clips the ninth, so a long list visibly
        // continues past the bottom edge instead of looking complete.
        <div
          role="listbox"
          aria-label="Mention someone"
          className="absolute left-3 right-3 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg sm:max-w-xs"
        >
          {candidates.map((p, idx) => (
            <button
              key={p.email ?? p.displayName}
              ref={(el) => {
                optionRefs.current[idx] = el;
              }}
              type="button"
              role="option"
              aria-selected={idx === activeIndex}
              onMouseDown={(e) => {
                // Use mousedown not click so the textarea doesn't lose focus
                // before we read selection state.
                e.preventDefault();
                pickMention(p);
              }}
              onMouseEnter={() => setActiveIndex(idx)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                idx === activeIndex ? "bg-accent/10 text-fg" : "text-fg hover:bg-surface-2",
              )}
            >
              <AtSign className="h-3.5 w-3.5 text-fg-muted" />
              <span className="truncate font-medium">{p.displayName}</span>
              {p.email && (
                <span className="truncate text-xs text-fg-muted">{p.email}</span>
              )}
            </button>
          ))}
          {candidatesTruncated && (
            // Never cut the list silently — a truncated popup otherwise reads
            // as "that's everyone" when the person you want is just past it.
            <div className="mt-1 border-t border-border px-2 py-1.5 text-[11px] text-fg-muted">
              Showing {candidates.length} of {candidateTotal} matches — keep typing to
              narrow.
            </div>
          )}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          >
            <Paperclip className="h-3.5 w-3.5" />
            Attach
          </button>
          {/*
            Switching ON warns first (it costs the @-mention picker);
            switching OFF is a free, reversible action and needs no dialog.
          */}
          <button
            type="button"
            onClick={() => {
              if (rich) setRich(false);
              else setWarnRich(true);
            }}
            disabled={disabled || busy}
            aria-pressed={rich}
            title={
              rich
                ? "Back to plain text, with @-mention autocomplete"
                : "Bold, italic, underline and lists (turns off @-mention autocomplete)"
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
              rich
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border bg-surface text-fg-muted hover:text-fg",
            )}
          >
            <Type className="h-3.5 w-3.5" />
            Rich text
          </button>
          {mentions.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              <AtSign className="h-3 w-3" />
              {mentions.length} mention{mentions.length === 1 ? "" : "s"}
            </span>
          )}
          {rich && (
            // Says WHY @ stopped working, at the moment it matters — the
            // dialog is long gone by the time somebody tries to mention
            // somebody.
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ajax-yellow-fg">
              @-mentions off
            </span>
          )}
          <span className="hidden text-xs text-fg-muted sm:inline">
            Press{" "}
            <kbd className="rounded border border-border bg-bg px-1 py-0.5 text-[10px]">Ctrl</kbd>+
            <kbd className="rounded border border-border bg-bg px-1 py-0.5 text-[10px]">Enter</kbd>{" "}
            to send
          </span>
        </div>
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          {busy
            ? attachments.length > 0 && uploadFile
              ? "Uploading…"
              : "Sending…"
            : "Send"}
        </button>
      </div>
      {uploadError && (
        <div className="mt-2 rounded-md border border-cooper-red/30 bg-cooper-red/10 px-2 py-1 text-xs text-cooper-red">
          {uploadError}
        </div>
      )}

      {namingQueue.length > 0 && (
        <NameAttachmentDialog
          file={namingQueue[0]}
          onConfirm={(renamed) => {
            addFiles([renamed]);
            setNamingQueue((prev) => prev.slice(1));
          }}
          onCancel={() => setNamingQueue((prev) => prev.slice(1))}
        />
      )}

      {warnRich && (
        <RichTextWarningDialog
          notifyNote={richTextNotifyNote}
          onConfirm={() => {
            // Carry whatever was already typed across, as paragraphs, so
            // switching mid-comment doesn't throw the draft away. The
            // mentions PICKED so far survive in `mentions` and are injected
            // as chips on send.
            setRichHtml((current) => current || plainTextToHtml(text));
            setRich(true);
            setWarnRich(false);
          }}
          onCancel={() => setWarnRich(false)}
        />
      )}
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: CommentAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.contentType.startsWith("image/");

  return (
    <div className="relative flex items-center gap-2 rounded-md border border-border bg-surface-2 p-1.5 pr-7">
      {isImage && attachment.objectUrl ? (
        <img
          src={attachment.objectUrl}
          alt={attachment.filename}
          className="h-10 w-10 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-surface text-fg-muted">
          <Paperclip className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0 max-w-[160px] text-xs">
        <div className="truncate font-medium text-fg" title={attachment.filename}>
          {attachment.filename}
        </div>
        <div className="text-fg-muted">{formatBytes(attachment.sizeBytes)}</div>
      </div>
      <button
        onClick={onRemove}
        className="absolute right-1 top-1 rounded p-0.5 text-fg-muted transition-colors hover:bg-surface hover:text-fg"
        aria-label="Remove attachment"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Escape text content for inclusion in HTML between tags. */
function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape a string for inclusion in a double-quoted HTML attribute value. */
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}
