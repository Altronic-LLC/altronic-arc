import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bookmark, Check, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  applySavedQuery,
  findByName,
  matchingSavedFilter,
  MAX_SAVED_FILTER_NAME,
  MAX_SAVED_FILTERS,
  savedFilterRefusalText,
  toSavedQuery,
  type SavedFilter,
  type SavedFilterSpec,
} from "@/lib/savedFilters";
import {
  deleteSavedFilter,
  renameSavedFilter,
  saveCurrentFilters,
  setDefaultSavedFilter,
  undoDeleteSavedFilter,
  useSavedFilters,
} from "@/hooks/useSavedFilters";
import { useCurrentUser, useCurrentUserEmails } from "@/hooks/useCurrentUser";
import { dropdownBlurHandler, dropdownKeyHandler, useDropdownClose } from "./useDropdownClose";
import { pushToast } from "./Toast";

// =============================================================================
// Saved filters — Altronic-LLC/BusinessIT#12. A button beside a list's New
// button: pick a saved filter to apply it, save what's on screen under a name,
// rename, delete, or star one to open the list on it.
//
// Kept in this browser only (lib/savedFilters.ts says why). The button shows
// the name of the saved filter that matches what's on screen, so a list opened
// on a default never looks narrowed for no reason.
// =============================================================================

interface SavedFiltersMenuProps {
  spec: SavedFilterSpec;
  /**
   * Keys this view neither saves nor compares — the boards leave out `status`,
   * their columns being the statuses. A saved filter's other keys still apply.
   */
  exclude?: readonly string[];
}

type Mode = { kind: "list" } | { kind: "save" } | { kind: "rename"; id: string };

const PANEL_WIDTH = 320;
/** Kept between the panel and the window's edge — the page's own side gutter. */
const GUTTER = 16;

export function SavedFiltersMenu({ spec, exclude = [] }: SavedFiltersMenuProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const me = useCurrentUser();
  const myEmails = useCurrentUserEmails();
  const filters = useSavedFilters(spec.list);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const keys = useMemo(() => spec.keys.filter((k) => !exclude.includes(k)), [spec.keys, exclude]);
  const active = matchingSavedFilter(filters, searchParams, spec, myEmails, keys);

  const close = () => {
    setOpen(false);
    setMode({ kind: "list" });
    setError(null);
  };
  useDropdownClose(open, containerRef, close);

  // Line the panel up with the button's right edge, but never past either edge
  // of the window: on a phone the button sits left of New, and a panel hung
  // from it ran off the left of the screen.
  const [panelBox, setPanelBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = containerRef.current?.getBoundingClientRect();
      if (!box) return;
      const viewport = document.documentElement.clientWidth || window.innerWidth;
      const width = Math.min(PANEL_WIDTH, viewport - 2 * GUTTER);
      const left = Math.max(GUTTER, Math.min(box.right - width, viewport - GUTTER - width));
      setPanelBox({ left: left - box.left, width });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  const apply = (filter: SavedFilter) => {
    const next = applySavedQuery(searchParams, filter.query, spec, me.email || null);
    if (!next) {
      pushToast({ message: "Your account is still loading — try again in a moment.", variant: "error" });
      return;
    }
    // A push, not a replace: Back takes you to the filters you had before.
    setSearchParams(next);
    close();
  };

  const startSave = () => {
    setName(active?.name ?? "");
    setError(null);
    setMode({ kind: "save" });
  };

  const submitSave = (e: React.FormEvent) => {
    e.preventDefault();
    const result = saveCurrentFilters(spec.list, name, toSavedQuery(searchParams, spec, myEmails, keys));
    if (!result.ok) {
      setError(savedFilterRefusalText(result.reason));
      return;
    }
    pushToast({
      message: result.replaced
        ? `Updated saved filter “${result.filter.name}”.`
        : `Saved filter “${result.filter.name}”.`,
    });
    setMode({ kind: "list" });
    setError(null);
  };

  const startRename = (filter: SavedFilter) => {
    setName(filter.name);
    setError(null);
    setMode({ kind: "rename", id: filter.id });
  };

  const submitRename = (e: React.FormEvent, id: string) => {
    e.preventDefault();
    const result = renameSavedFilter(spec.list, id, name);
    if (!result.ok) {
      setError(savedFilterRefusalText(result.reason));
      return;
    }
    setMode({ kind: "list" });
    setError(null);
  };

  const remove = (filter: SavedFilter) => {
    const removed = deleteSavedFilter(spec.list, filter.id);
    if (!removed) return;
    pushToast({
      message: `Deleted saved filter “${filter.name}”.`,
      undo: () => undoDeleteSavedFilter(spec.list, removed.filter, removed.index),
    });
  };

  const toggleDefault = (filter: SavedFilter) => {
    setDefaultSavedFilter(spec.list, filter.isDefault ? null : filter.id);
  };

  const replacing = mode.kind === "save" ? findByName(filters, name) : null;
  const full = filters.length >= MAX_SAVED_FILTERS;

  return (
    <div
      ref={containerRef}
      className="relative"
      onKeyDown={dropdownKeyHandler(open, close)}
      onBlur={dropdownBlurHandler(containerRef, close)}
    >
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="true"
        aria-expanded={open}
        title={active ? `Saved filter: ${active.name}` : "Saved filters"}
        className={cn(
          "inline-flex max-w-[14rem] items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
          active
            ? "border-accent/50 bg-accent/10 text-fg"
            : "border-border bg-surface text-fg-muted hover:text-fg",
        )}
      >
        <Bookmark className={cn("h-4 w-4 shrink-0", active && "fill-accent text-accent")} />
        <span className="truncate">{active ? active.name : "Saved filters"}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Saved filters"
          style={panelBox ? { left: panelBox.left, width: panelBox.width } : undefined}
          className={cn(
            "absolute top-full z-40 mt-1 rounded-lg border border-border bg-surface p-2 shadow-lg",
            !panelBox && "right-0 w-80",
          )}
        >
          <div className="px-2 pb-2 pt-1">
            <div className="text-sm font-semibold text-fg">Saved filters</div>
            <div className="text-xs text-fg-muted">
              Kept in this browser only. Star one to open the list on it.
            </div>
          </div>

          {filters.length === 0 ? (
            <p className="px-2 pb-2 text-xs text-fg-muted">
              Nothing saved yet. Set the filters you want, then save them here.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5 pb-1">
              {filters.map((f) =>
                mode.kind === "rename" && mode.id === f.id ? (
                  <li key={f.id} className="px-1 py-1">
                    <NameForm
                      label={`New name for ${f.name}`}
                      name={name}
                      setName={setName}
                      error={error}
                      submitLabel="Rename"
                      onSubmit={(e) => submitRename(e, f.id)}
                      onCancel={() => setMode({ kind: "list" })}
                    />
                  </li>
                ) : (
                  <li key={f.id} className="flex items-center gap-1 rounded-md hover:bg-surface-2">
                    <button
                      type="button"
                      onClick={() => apply(f)}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm text-fg"
                    >
                      <Check
                        className={cn("h-3.5 w-3.5 shrink-0", active?.id === f.id ? "text-accent" : "invisible")}
                        aria-hidden
                      />
                      <span className="truncate">{f.name}</span>
                      {active?.id === f.id && <span className="sr-only">(on screen)</span>}
                    </button>
                    <IconButton
                      label={
                        f.isDefault
                          ? `Stop opening the list on ${f.name}`
                          : `Open the list on ${f.name}`
                      }
                      pressed={f.isDefault}
                      onClick={() => toggleDefault(f)}
                    >
                      <Star className={cn("h-3.5 w-3.5", f.isDefault && "fill-ajax-yellow text-ajax-yellow")} />
                    </IconButton>
                    <IconButton label={`Rename ${f.name}`} onClick={() => startRename(f)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton label={`Delete ${f.name}`} onClick={() => remove(f)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </li>
                ),
              )}
            </ul>
          )}

          <div className="border-t border-border pt-2">
            {mode.kind === "save" ? (
              <div className="px-1">
                <NameForm
                  label="Name for these filters"
                  name={name}
                  setName={setName}
                  error={error}
                  submitLabel={replacing ? "Replace" : "Save"}
                  onSubmit={submitSave}
                  onCancel={() => setMode({ kind: "list" })}
                  disabled={full && !replacing}
                />
                {replacing && (
                  <p className="mt-1 px-1 text-xs text-fg-muted">
                    Replaces the saved filter “{replacing.name}” with what's on screen now.
                  </p>
                )}
                {full && !replacing && (
                  <p className="mt-1 px-1 text-xs text-fg-muted">
                    {savedFilterRefusalText("full")}
                  </p>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={startSave}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-accent hover:bg-surface-2"
              >
                <Plus className="h-4 w-4" />
                Save current filters…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className="shrink-0 rounded p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
    >
      {children}
    </button>
  );
}

function NameForm({
  label,
  name,
  setName,
  error,
  submitLabel,
  onSubmit,
  onCancel,
  disabled = false,
}: {
  label: string;
  name: string;
  setName: (v: string) => void;
  error: string | null;
  submitLabel: string;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <input
          // The panel is the user's own focus target here — nothing to steal from.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          aria-label={label}
          value={name}
          maxLength={MAX_SAVED_FILTER_NAME}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. My open tasks"
          className="input h-8! min-w-0 flex-1 text-sm"
        />
        <button
          type="submit"
          disabled={disabled}
          className="rounded-md bg-accent px-2.5 py-1 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-sm text-fg-muted hover:text-fg"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="px-1 text-xs text-cooper-red">
          {error}
        </p>
      )}
    </form>
  );
}
