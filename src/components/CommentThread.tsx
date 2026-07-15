import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, Paperclip, Pencil } from "lucide-react";
import type { Comment, CommentAttachment, Person } from "@/types/task";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import { buildCommentHtml, extractMentionedRecipients } from "@/lib/mentions";
import { cn } from "@/lib/cn";
import { AutoGrowTextarea } from "./AutoGrowTextarea";

interface CommentThreadProps {
  comments: Comment[];
  currentUserEmail?: string;
  /**
   * People available for @-mentions while editing — same list the composer
   * uses for new comments. Without this, edits can't add or preserve real
   * mention chips (typed "@Name" text stays plain, so it neither notifies
   * nor auto-watches).
   */
  mentionablePeople?: Person[];
  /**
   * Save handler. If omitted, the Edit button is hidden entirely.
   * `renotify` is true when the author checked "Notify everyone again" —
   * the caller should re-send the comment notification to watchers/mentions
   * instead of the usual edit behavior of staying silent.
   */
  onEdit?: (comment: Comment, newBodyHtml: string, renotify: boolean) => Promise<void> | void;
}

export function CommentThread({
  comments,
  currentUserEmail,
  mentionablePeople = [],
  onEdit,
}: CommentThreadProps) {
  if (comments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-fg-muted">
        No comments yet. Add the first one below.
      </div>
    );
  }

  const myEmail = (currentUserEmail ?? "").toLowerCase();

  return (
    <div className="divide-y divide-border">
      {comments.map((c, i) => {
        const isOwn =
          !!myEmail && (c.authorEmail ?? "").toLowerCase() === myEmail;
        return (
          <CommentItem
            key={`${c.timestamp.getTime()}-${i}`}
            comment={c}
            canEdit={isOwn && !!onEdit}
            mentionablePeople={mentionablePeople}
            onEdit={onEdit}
          />
        );
      })}
    </div>
  );
}

function CommentItem({
  comment,
  canEdit,
  mentionablePeople,
  onEdit,
}: {
  comment: Comment;
  canEdit: boolean;
  mentionablePeople: Person[];
  onEdit?: (comment: Comment, newBodyHtml: string, renotify: boolean) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing && onEdit) {
    return (
      <article className="py-4 first:pt-0 last:pb-0">
        <CommentEditor
          initialBodyHtml={comment.bodyHtml}
          mentionablePeople={mentionablePeople}
          onCancel={() => setEditing(false)}
          onSave={async (newBodyHtml, renotify) => {
            await onEdit(comment, newBodyHtml, renotify);
            setEditing(false);
          }}
        />
        {comment.attachments && comment.attachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {comment.attachments.map((a) => (
              <CommentAttachmentView key={a.id} attachment={a} />
            ))}
          </div>
        )}
        <div className="mt-2 text-right text-xs text-fg-muted">
          {formatTimestamp(comment.timestamp)}{" "}
          by <span className="font-medium text-fg">{comment.authorName}</span>
        </div>
      </article>
    );
  }

  return (
    <article className="py-4 first:pt-0 last:pb-0">
      {comment.bodyHtml ? (
        <div
          className="comment-html"
          // bodyHtml is authored content from SharePoint users; sanitised
          // through DOMPurify to strip scripts and event handlers before
          // rendering. See src/lib/sanitiseHtml.ts.
          dangerouslySetInnerHTML={{ __html: sanitiseHtml(comment.bodyHtml) }}
        />
      ) : comment.attachments && comment.attachments.length > 0 ? (
        <div className="text-xs italic text-fg-muted">(attachment only — no text)</div>
      ) : (
        <div className="text-xs italic text-fg-muted">(empty comment)</div>
      )}

      {comment.attachments && comment.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {comment.attachments.map((a) => (
            <CommentAttachmentView key={a.id} attachment={a} />
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-end gap-2 text-xs text-fg-muted">
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
            title="Edit comment"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        )}
        <span>
          {formatTimestamp(comment.timestamp)}{" "}
          by <span className="font-medium text-fg">{comment.authorName}</span>
        </span>
      </div>
    </article>
  );
}

function CommentEditor({
  initialBodyHtml,
  mentionablePeople,
  onSave,
  onCancel,
}: {
  initialBodyHtml: string;
  mentionablePeople: Person[];
  onSave: (newBodyHtml: string, renotify: boolean) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(() => htmlToPlainText(initialBodyHtml));
  const [busy, setBusy] = useState(false);
  const [renotify, setRenotify] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Seed with whatever mentions the comment already had, so leaving the
  // visible "@Name" text untouched during an edit doesn't downgrade it back
  // to plain text — only re-picking or removing changes the chip set.
  const [mentions, setMentions] = useState<Person[]>(() =>
    extractMentionedRecipients(initialBodyHtml),
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const atPosRef = useRef<number | null>(null);

  const candidates = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!pickerOpen) return [];
    return mentionablePeople
      .filter((p) => p.displayName.toLowerCase().includes(q))
      .sort((a, b) => {
        const ap = a.displayName.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.displayName.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp || a.displayName.localeCompare(b.displayName);
      })
      .slice(0, 6);
  }, [mentionablePeople, pickerQuery, pickerOpen]);

  useEffect(() => {
    if (activeIndex >= candidates.length) setActiveIndex(0);
  }, [candidates.length, activeIndex]);

  function detectMention(nextText: string, caret: number) {
    let i = caret - 1;
    while (i >= 0) {
      const ch = nextText[i];
      if (ch === "@") {
        const before = i > 0 ? nextText[i - 1] : "";
        if (before === "" || /[\s(\[]/.test(before)) {
          const query = nextText.slice(i + 1, caret);
          if (!/\s/.test(query)) {
            atPosRef.current = i;
            setPickerQuery(query);
            setPickerOpen(true);
            return;
          }
        }
        break;
      }
      if (/\s/.test(ch)) break;
      i--;
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
    const inserted = `@${person.displayName} `;
    const nextText = before + inserted + after;
    setText(nextText);
    setMentions((prev) => {
      const key = (person.email ?? person.displayName).toLowerCase();
      const has = prev.some((p) => (p.email ?? p.displayName).toLowerCase() === key);
      return has ? prev : [...prev, person];
    });
    setPickerOpen(false);
    atPosRef.current = null;
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = before.length + inserted.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }

  async function handleSave() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const html = buildCommentHtml(trimmed, mentions);
      await onSave(html, renotify);
    } finally {
      setBusy(false);
    }
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
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="relative rounded-md border border-accent/40 bg-surface-2 p-3">
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
        disabled={busy}
        rows={4}
        autoFocus
        className="w-full resize-y rounded-md bg-bg p-2.5 text-base text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-accent/30 sm:text-sm"
      />

      {pickerOpen && candidates.length > 0 && (
        <div className="absolute left-3 right-3 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg sm:max-w-xs">
          {candidates.map((p, idx) => (
            <button
              key={p.email ?? p.displayName}
              type="button"
              onMouseDown={(e) => {
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
              {p.email && <span className="truncate text-xs text-fg-muted">{p.email}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <label
          className="flex items-center gap-1.5 text-xs text-fg-muted"
          title="Sends a fresh notification email to watchers and mentioned people about this update."
        >
          <input
            type="checkbox"
            checked={renotify}
            onChange={(e) => setRenotify(e.target.checked)}
            disabled={busy}
            className="h-3.5 w-3.5 rounded border-border"
          />
          Notify everyone again
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={busy || text.trim().length === 0}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CommentAttachmentView({ attachment }: { attachment: CommentAttachment }) {
  const isImage = attachment.contentType.startsWith("image/");

  if (isImage && attachment.objectUrl) {
    return (
      <a
        href={attachment.objectUrl}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded-md border border-border bg-surface-2 transition-shadow hover:shadow-md"
      >
        <img
          src={attachment.objectUrl}
          alt={attachment.filename}
          className="max-h-48 max-w-xs object-contain"
        />
        <div className="border-t border-border px-2 py-1 text-[11px] text-fg-muted">
          {attachment.filename}
        </div>
      </a>
    );
  }

  return (
    <a
      href={attachment.objectUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-fg transition-colors hover:bg-surface"
    >
      <Paperclip className="h-3.5 w-3.5 text-fg-muted" />
      <span className="font-medium">{attachment.filename}</span>
      <span className="text-fg-muted">{formatBytes(attachment.sizeBytes)}</span>
    </a>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(d: Date): string {
  return d.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Convert the comment's bodyHtml back to plain text for editing.
 * Handles the shape our composer produces (<p>…</p> wrapping with <br/>
 * line breaks). Richer HTML from the Power Apps version loses formatting
 * on edit — acceptable because the user is editing their own comment.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<\/?p[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
