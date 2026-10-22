import { useRef } from "react";
import { Paperclip, Trash2, Upload } from "lucide-react";
import { useFileDrop } from "./useFileDrop";
import { cn } from "@/lib/cn";

/**
 * Attachments for a record that doesn't exist yet — a New form.
 *
 * `AttachmentsSection` needs a real item id to talk to SharePoint's attachment
 * store, and there isn't one until the create succeeds. So files picked or
 * dropped here are held in memory and the form uploads them, with
 * `uploadAttachments`, once the new item's id is known. Shared by the New
 * Panel QC Issue and New EIR forms.
 *
 * A `File` can't be stored, so these never travel in a form draft.
 */
export function PendingAttachmentsCard({
  files,
  onChange,
  disabled,
  itemNoun,
  className,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
  /** "issue", "EIR" — finishes "they'll upload once you save this …". */
  itemNoun: string;
  className?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const add = (added: File[]) => {
    if (added.length > 0) onChange([...files, ...withUniqueNames(files, added)]);
  };
  const { dragging, dropProps } = useFileDrop(add, disabled);
  return (
    <div
      {...dropProps}
      className={cn(
        "rounded-lg border bg-surface p-4 sm:p-5",
        dragging ? "border-accent ring-2 ring-accent/30" : "border-border",
        className,
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          <Paperclip className="h-4 w-4" />
          Attachments
          {files.length > 0 && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold tabular-nums text-fg">
              {files.length}
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:border-fg-muted disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          Add file
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          aria-label="Add attachments"
          onChange={(e) => {
            add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {files.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-fg-muted">
          No files yet. Drag files here or click "Add file" — they'll upload once you save this{" "}
          {itemNoun}.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span className="truncate text-fg">{file.name}</span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                disabled={disabled}
                aria-label={`Remove ${file.name}`}
                className="shrink-0 rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Rename any added file whose name is already staged — "photo.jpg" becomes
 * "photo (2).jpg". SharePoint refuses a second attachment of the same name on
 * one item, so two phone photos both called image.jpg would otherwise lose the
 * second one after the record was already created.
 */
export function withUniqueNames(staged: File[], added: File[]): File[] {
  const taken = new Set(staged.map((f) => f.name.toLowerCase()));
  return added.map((file) => {
    let name = file.name;
    if (taken.has(name.toLowerCase())) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let n = 2;
      while (taken.has(`${stem} (${n})${ext}`.toLowerCase())) n++;
      name = `${stem} (${n})${ext}`;
    }
    taken.add(name.toLowerCase());
    return name === file.name ? file : new File([file], name, { type: file.type });
  });
}
