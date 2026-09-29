import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, ListTree, Pencil, Plus, Trash2, X } from "lucide-react";
import type { ComponentDescriptionOption, ComponentDescriptionOptionKind } from "@/types/task";
import { COMPONENT_DESCRIPTION_OPTIONS_CONFIGURED } from "@/api/config";
import {
  useAddDescriptionOption,
  useComponentDescriptionOptions,
  useDeleteDescriptionOption,
  useMoveDescriptionOption,
  useUpdateDescriptionOption,
} from "@/hooks/useComponentDescriptionOptions";
import { useMyPartsAccess } from "@/hooks/usePartsRoles";
import {
  cleanOptionName,
  composeDescription,
  nextSortOrder,
  optionNameProblem,
  optionsOfKind,
  typeNameProblem,
} from "@/lib/componentDescriptions";
import { manageDescriptionOptionsGate } from "@/lib/partsRoles";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { LoadingTasks } from "@/components/LoadingTasks";

// =============================================================================
// The description lists — what a NEW component can be described as. The
// Description / Type dropdowns (the old Power App's), and the SIL categories
// offered in front on the 722 list. Tim, 2026-09-28/29.
//
// Inside the Parts List, not under /admin: the SAP admin and the reviewing
// engineers manage these (manageDescriptionOptionsGate), and they aren't
// necessarily ARC admins. Reading is open to anyone signed in; the controls
// grey out, with the reason, for everybody else — the CMMS reference lists'
// arrangement.
//
// Removing an option really removes it. Parts hold their description as
// text, so nothing points at an option and no part changes.
// =============================================================================

export function PartDescriptionOptionsView() {
  const query = useComponentDescriptionOptions();
  const access = useMyPartsAccess();
  const gate = manageDescriptionOptionsGate(access);
  const options = query.data ?? [];

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6">
      <Link to="/engineering/parts" className="inline-flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" />
        Parts List
      </Link>
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
          <ListTree className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Component descriptions</h1>
          <p className="text-sm text-fg-muted">
            What a new component can be described as. New part offers a Description, then a Type from that
            Description's list, and saves the two together in capitals — e.g. <span className="font-mono">CAPACITOR - CERAMIC</span>.
            On the 722 list a SIL category comes first.
          </p>
        </div>
      </header>

      <p className="text-xs text-fg-muted">
        Changing a list only changes what new parts are offered. Existing parts keep their description exactly as it
        is, and editing a part still uses a plain text box.
      </p>

      {!gate.allowed && !gate.resolving && (
        <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg-muted">{gate.hint}</p>
      )}

      {!COMPONENT_DESCRIPTION_OPTIONS_CONFIGURED ? (
        <div className="rounded-xl border border-ajax-yellow/50 bg-ajax-yellow/10 px-4 py-3 text-sm text-fg">
          <p className="font-medium">The description lists aren't set up yet.</p>
          <p className="mt-1 text-fg-muted">
            Until the Component Description Options list exists and ARC is pointed at it
            (VITE_SP_COMPONENT_DESCRIPTION_OPTIONS_LIST_ID), New part keeps a plain Description box.
          </p>
        </div>
      ) : query.isLoading ? (
        <LoadingTasks noun="description lists" />
      ) : query.error ? (
        isPermissionDenied(query.error) ? (
          <ListAccessNotice list="Component Description Options" site="Altronic_Engineering" onRetry={() => void query.refetch()} />
        ) : (
          <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">Couldn't load the description lists.</p>
            <p className="mt-1">{query.error instanceof Error ? query.error.message : "Unknown error"}</p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              Try again
            </button>
          </div>
        )
      ) : (
        <>
          <OptionSection
            title="Descriptions"
            kind="Description"
            options={options}
            canEdit={gate.allowed}
            hint={gate.hint}
            empty="No descriptions yet. Until one is added, New part keeps a plain Description box."
          />
          <OptionSection
            title="SIL categories — the 722 list"
            kind="SIL Category"
            options={options}
            canEdit={gate.allowed}
            hint={gate.hint}
            empty="No SIL categories. 722 parts are described with the Description and Type alone."
          />
        </>
      )}
    </div>
  );
}

function OptionSection({
  title,
  kind,
  options,
  canEdit,
  hint,
  empty,
}: {
  title: string;
  kind: ComponentDescriptionOptionKind;
  options: ComponentDescriptionOption[];
  canEdit: boolean;
  hint: string;
  empty: string;
}) {
  const rows = optionsOfKind(options, kind);
  return (
    <section aria-label={title} className="rounded-xl border border-border bg-surface">
      <h2 className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-fg-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row, i) => (
            <OptionRow
              key={row.id}
              option={row}
              options={options}
              first={i === 0}
              last={i === rows.length - 1}
              canEdit={canEdit}
              hint={hint}
            />
          ))}
        </ul>
      )}
      <AddOption kind={kind} options={options} canEdit={canEdit} hint={hint} />
    </section>
  );
}

const iconButton =
  "rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

function OptionRow({
  option,
  options,
  first,
  last,
  canEdit,
  hint,
}: {
  option: ComponentDescriptionOption;
  options: ComponentDescriptionOption[];
  first: boolean;
  last: boolean;
  canEdit: boolean;
  hint: string;
}) {
  const update = useUpdateDescriptionOption();
  const remove = useDeleteDescriptionOption();
  const move = useMoveDescriptionOption();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(option.name);
  const [newType, setNewType] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const busy = update.isPending || remove.isPending || move.isPending;
  const disabled = !canEdit || busy;
  const title = canEdit ? undefined : hint;
  const isDescription = option.kind === "Description";

  function saveName(e: FormEvent) {
    e.preventDefault();
    const why = optionNameProblem(name, option.kind, options, option.id);
    if (why) return setProblem(why);
    setProblem(null);
    update.mutate({ id: option.id, name }, { onSuccess: () => setRenaming(false) });
  }

  function addType(e: FormEvent) {
    e.preventDefault();
    const why = typeNameProblem(newType, option.types);
    if (why) return setProblem(why);
    setProblem(null);
    update.mutate({ id: option.id, types: [...option.types, cleanOptionName(newType)] }, { onSuccess: () => setNewType("") });
  }

  function removeType(type: string) {
    update.mutate({ id: option.id, types: option.types.filter((t) => t !== type) });
  }

  function removeOption() {
    const what = isDescription
      ? `Remove "${option.name}"${option.types.length ? ` and its ${option.types.length} types` : ""}?`
      : `Remove "${option.name}"?`;
    if (window.confirm(`${what} New parts won't be offered it any more. Parts already described with it keep their description.`)) {
      remove.mutate(option.id);
    }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {renaming ? (
          <form onSubmit={saveName} className="flex flex-1 items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input max-w-xs"
              aria-label={`New name for ${option.name}`}
              autoFocus
              disabled={busy}
            />
            <button type="submit" disabled={busy} className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-60">
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setRenaming(false);
                setName(option.name);
                setProblem(null);
              }}
              className="rounded-md border border-border px-3 py-1 text-sm font-medium text-fg hover:bg-surface-2"
            >
              Cancel
            </button>
          </form>
        ) : (
          <div className="min-w-0 flex-1">
            <span className="font-medium text-fg">{option.name}</span>
            <span className="ml-2 font-mono text-[11px] text-fg-muted">
              {isDescription
                ? composeDescription({ silCategory: "", name: option.name, type: option.types[0] ?? "" })
                : `${composeDescription({ silCategory: option.name, name: "", type: "" })} - …`}
            </span>
          </div>
        )}
        {!renaming && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              className={iconButton}
              onClick={() => move.mutate({ id: option.id, direction: "up" })}
              disabled={disabled || first}
              title={title}
              aria-label={`Move ${option.name} up`}
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={iconButton}
              onClick={() => move.mutate({ id: option.id, direction: "down" })}
              disabled={disabled || last}
              title={title}
              aria-label={`Move ${option.name} down`}
            >
              <ArrowDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={iconButton}
              onClick={() => setRenaming(true)}
              disabled={disabled}
              title={title}
              aria-label={`Rename ${option.name}`}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={iconButton}
              onClick={removeOption}
              disabled={disabled}
              title={title}
              aria-label={`Remove ${option.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {isDescription && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {option.types.length === 0 && <span className="text-xs text-fg-muted">No types — saves as the description alone.</span>}
          {option.types.map((type) => (
            <span
              key={type}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 py-0.5 pl-2.5 pr-1 text-xs text-fg"
            >
              {type}
              <button
                type="button"
                onClick={() => removeType(type)}
                disabled={disabled}
                title={title}
                aria-label={`Remove type ${type} from ${option.name}`}
                className="rounded-full p-0.5 text-fg-muted hover:bg-surface hover:text-fg disabled:opacity-40"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {canEdit && (
            <form onSubmit={addType} className="flex items-center gap-1">
              <input
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                placeholder="Add a type…"
                className="h-7 w-40 rounded-md border border-border bg-surface px-2 text-xs text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
                aria-label={`New type for ${option.name}`}
                disabled={busy}
              />
              <button
                type="submit"
                disabled={busy || !newType.trim()}
                className="rounded-md border border-border px-2 py-1 text-xs font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
              >
                Add
              </button>
            </form>
          )}
        </div>
      )}
      {problem && <p className="mt-1.5 text-xs text-cooper-red">{problem}</p>}
    </li>
  );
}

function AddOption({
  kind,
  options,
  canEdit,
  hint,
}: {
  kind: ComponentDescriptionOptionKind;
  options: ComponentDescriptionOption[];
  canEdit: boolean;
  hint: string;
}) {
  const add = useAddDescriptionOption();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const label = kind === "Description" ? "New description" : "New SIL category";

  function submit(e: FormEvent) {
    e.preventDefault();
    const why = optionNameProblem(name, kind, options);
    if (why) return setProblem(why);
    setProblem(null);
    add.mutate(
      { kind, name, types: [], sortOrder: nextSortOrder(options, kind) },
      { onSuccess: () => setName("") },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1 border-t border-border px-4 py-3">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === "Description" ? "e.g. Fuse" : "e.g. SIL CAT 3"}
          className="input max-w-xs"
          aria-label={label}
          disabled={!canEdit || add.isPending}
          title={canEdit ? undefined : hint}
        />
        <button
          type="submit"
          disabled={!canEdit || add.isPending || !name.trim()}
          title={canEdit ? undefined : hint}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          {kind === "Description" ? "Add description" : "Add SIL category"}
        </button>
      </div>
      {kind === "Description" && (
        <span className="text-[11px] text-fg-muted">Add its types once it's on the list.</span>
      )}
      {problem && <span className="text-xs text-cooper-red">{problem}</span>}
    </form>
  );
}
