import { Send } from "lucide-react";
import { useState } from "react";

interface CommentComposerProps {
  onSubmit: (bodyHtml: string) => void | Promise<void>;
  disabled?: boolean;
}

/**
 * Plain-text composer for now. Wraps each line in <p> tags before sending so
 * it matches the HTML shape the rest of the app expects. Future enhancement:
 * swap this for Tiptap to match the Power Apps rich editor (Format/B/I/U,
 * links, ordered/unordered lists).
 */
export function CommentComposer({ onSubmit, disabled }: CommentComposerProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const html = trimmed
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
        .join("");
      await onSubmit(html);
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write a comment…"
        disabled={disabled || busy}
        rows={4}
        className="w-full resize-y rounded-md bg-bg p-3 text-base text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-accent/30 sm:text-sm"
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="text-xs text-fg-muted">
          Press <kbd className="rounded border border-border bg-bg px-1 py-0.5 text-[10px]">Ctrl</kbd>+
          <kbd className="rounded border border-border bg-bg px-1 py-0.5 text-[10px]">Enter</kbd> to send
        </div>
        <button
          onClick={handleSend}
          disabled={disabled || busy || !text.trim()}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
