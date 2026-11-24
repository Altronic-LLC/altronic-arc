import { useRef, useState } from "react";
import { ChevronRight, ExternalLink, FileText, Folder, FolderOpen, FolderPlus, Loader2, Upload } from "lucide-react";
import type { Quote } from "@/types/quote";
import { driveItemNameProblem } from "@/api/driveLibrary";
import { isNotFound } from "@/api/quotes";
import { quoteFolderHooks, quoteFolderFor, useIcQuoteFolders, useSetUpQuoteFolder } from "@/hooks/useQuoteFolder";
import { ChoiceSelect } from "./SearchableSelect";

// =============================================================================
// A quote's PROJECT FOLDER, in the quote's work area (Ray, 2026-11-24).
//
// No folder yet: a quoter or manager names one and creates it under
// General/IC Quotes, or links a folder already there. With a folder: a small
// browser rooted AT it — open subfolders, create subfolders at any depth,
// upload files, open anything in SharePoint. Navigation is the card's own
// state, not the URL, so it never fights the quote page's.
//
// Creating subfolders and uploading are open to anyone who can open the
// quote, like attachments; the PMO library's permissions are the boundary.
// Rename and delete are done in SharePoint ("Open in SharePoint").
// =============================================================================

interface Props {
  quote: Quote;
  /** Every quote rev — a rev made before the folder was set finds it on another. */
  allQuotes: Quote[];
  /** May they create or link the folder (the quote edit right)? */
  canSetUp: boolean;
  /** Why not, when they can't. */
  setUpHint?: string;
}

export function QuoteProjectFolderCard({ quote, allQuotes, canSetUp, setUpHint }: Props) {
  const folder = quoteFolderFor(quote, allQuotes);
  const [relinking, setRelinking] = useState(false);

  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5" aria-label="Project folder">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Project folder</h2>
      </div>
      {!folder || relinking ? (
        canSetUp ? (
          <SetUp quote={quote} relinking={relinking} onDone={() => setRelinking(false)} />
        ) : (
          <p className="text-sm text-fg-muted">
            No project folder yet. {setUpHint ?? "A quoter or quote manager can create one."}
          </p>
        )
      ) : (
        <Browser key={folder} name={folder} canSetUp={canSetUp} onRelink={() => setRelinking(true)} />
      )}
    </section>
  );
}

function SetUp({ quote, relinking, onDone }: { quote: Quote; relinking: boolean; onDone: () => void }) {
  const setUp = useSetUpQuoteFolder();
  const [name, setName] = useState(quote.quoteBase);
  const [linkOpen, setLinkOpen] = useState(relinking);
  const [linkTo, setLinkTo] = useState("");
  const existing = useIcQuoteFolders(linkOpen);
  const problem = name.trim() ? driveItemNameProblem(name.trim(), "folder") : null;

  const run = (folderName: string, create: boolean) =>
    setUp.mutate({ quoteId: quote.id, name: folderName, create }, { onSuccess: onDone });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">
        A folder in <strong className="text-fg">General / IC Quotes</strong> on the Altronic_PMO site for this quote's
        files. Every rev of the quote shares it.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem && name.trim()) run(name, true);
        }}
      >
        <label className="block min-w-[16rem] flex-1">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-accent">Folder name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" disabled={setUp.isPending} />
        </label>
        <button
          type="submit"
          disabled={setUp.isPending || !name.trim() || !!problem}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-white shadow-xs hover:bg-accent/90 disabled:opacity-60"
        >
          {setUp.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
          Create folder
        </button>
      </form>
      {problem && <p className="text-xs text-cooper-red" role="alert">{problem}</p>}

      {!linkOpen ? (
        <button
          type="button"
          onClick={() => setLinkOpen(true)}
          className="self-start text-xs font-medium text-accent underline-offset-2 hover:underline"
        >
          Or link an existing folder in IC Quotes
        </button>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-accent">
              Existing folder
            </span>
            <ChoiceSelect
              value={linkTo}
              onChange={setLinkTo}
              options={(existing.data ?? []).map((f) => ({ value: f.name, label: f.name }))}
              emptyLabel={existing.isLoading ? "Loading folders…" : "Pick a folder"}
              searchPlaceholder="Search IC Quotes folders…"
              ariaLabel="Existing folder"
            />
          </div>
          <button
            type="button"
            disabled={!linkTo || setUp.isPending}
            onClick={() => run(linkTo, false)}
            className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-60"
          >
            Link folder
          </button>
          {existing.error && (
            <p className="w-full text-xs text-cooper-red">Couldn't list the folders in IC Quotes.</p>
          )}
        </div>
      )}
      {relinking && (
        <button type="button" onClick={onDone} className="self-start text-xs text-fg-muted hover:text-fg">
          Cancel
        </button>
      )}
    </div>
  );
}

function Browser({ name, canSetUp, onRelink }: { name: string; canSetUp: boolean; onRelink: () => void }) {
  const hooks = quoteFolderHooks(name);
  const [current, setCurrent] = useState<string | null>(null);
  const listing = hooks.useFolder(current);
  const path = hooks.usePath(current);
  const createFolder = hooks.useCreateFolder();
  const upload = hooks.useUpload();
  const [newName, setNewName] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const crumbs = path.data ?? [{ id: null, name, webUrl: "" }];
  const here = crumbs[crumbs.length - 1];
  const newProblem = newName?.trim() ? driveItemNameProblem(newName.trim(), "folder") : null;

  if (listing.error && current === null && isNotFound(listing.error)) {
    return (
      <div className="text-sm">
        <p className="text-fg">
          The folder <strong>{name}</strong> isn't in IC Quotes any more — it may have been renamed or moved in
          SharePoint.
        </p>
        {canSetUp && (
          <button
            type="button"
            onClick={onRelink}
            className="mt-2 text-xs font-medium text-accent underline-offset-2 hover:underline"
          >
            Link a different folder
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Folder path" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
          {crumbs.map((c, i) => (
            <span key={c.id ?? "root"} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-fg-muted" />}
              {i === crumbs.length - 1 ? (
                <span className="inline-flex items-center gap-1 font-medium text-fg">
                  <FolderOpen className="h-4 w-4 text-ajax-yellow" />
                  {c.name}
                </span>
              ) : (
                <button type="button" onClick={() => setCurrent(c.id)} className="text-accent hover:underline">
                  {c.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => setNewName("")}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg hover:bg-surface-2"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          New subfolder
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={upload.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg hover:bg-surface-2 disabled:opacity-60"
        >
          {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Upload files
        </button>
        {here.webUrl && (
          <a
            href={here.webUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in SharePoint
          </a>
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          data-testid="quote-folder-file-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length > 0) upload.mutate({ folderId: current, files });
          }}
        />
      </div>

      {upload.progress && (
        <p className="text-xs text-fg-muted" role="status">
          Uploading {upload.progress.name} ({upload.progress.index} of {upload.progress.total})…
        </p>
      )}

      {newName !== null && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim() || newProblem) return;
            createFolder.mutate(
              { parentId: current, name: newName.trim() },
              { onSuccess: () => setNewName(null) },
            );
          }}
        >
          <label className="block min-w-[14rem] flex-1">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-accent">
              New subfolder in {here.name}
            </span>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setNewName(null);
                }
              }}
              className="input"
              disabled={createFolder.isPending}
            />
          </label>
          <button
            type="submit"
            disabled={createFolder.isPending || !newName.trim() || !!newProblem}
            className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-60"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setNewName(null)}
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm text-fg hover:bg-surface-2"
          >
            Cancel
          </button>
          {newProblem && <p className="w-full text-xs text-cooper-red" role="alert">{newProblem}</p>}
        </form>
      )}

      {listing.isLoading ? (
        <p className="text-sm text-fg-muted">Loading the folder…</p>
      ) : listing.error ? (
        <p className="text-sm text-cooper-red">
          Couldn't open this folder: {listing.error instanceof Error ? listing.error.message : "unknown error"}
        </p>
      ) : (listing.data ?? []).length === 0 ? (
        <p className="text-sm text-fg-muted">This folder is empty. Create a subfolder or upload files.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border" aria-label={`Contents of ${here.name}`}>
          {(listing.data ?? []).map((e) => (
            <li key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              {e.isFolder ? (
                <button
                  type="button"
                  onClick={() => setCurrent(e.id)}
                  className="inline-flex min-w-0 items-center gap-2 text-left text-fg hover:text-accent"
                >
                  <Folder className="h-4 w-4 shrink-0 text-ajax-yellow" />
                  <span className="truncate">{e.name}</span>
                </button>
              ) : (
                <a
                  href={e.webUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-2 text-fg hover:text-accent"
                >
                  <FileText className="h-4 w-4 shrink-0 text-fg-muted" />
                  <span className="truncate">{e.name}</span>
                </a>
              )}
              {e.isFolder && e.childCount !== undefined && (
                <span className="ml-auto shrink-0 text-xs text-fg-muted">
                  {e.childCount} item{e.childCount === 1 ? "" : "s"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
