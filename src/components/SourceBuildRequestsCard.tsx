import { useState } from "react";
import { Link } from "react-router-dom";
import { Hammer, Link2, Plus, X } from "lucide-react";
import {
  useBuildRequests,
  useBuildRequestsForSource,
  useSetBuildRequestSourceLink,
} from "@/hooks/useBuildRequests";
import { useTasks } from "@/hooks/useTasks";
import { useEirs } from "@/hooks/useEirs";
import { buildRequestSourceColumnsAvailable } from "@/api/buildRequests";
import type { BuildRequest, Eir, Task } from "@/types/task";
import {
  SOURCE_NOUN,
  linkableBuildRequests,
  linkedElsewhere,
  type BuildRequestSource,
  type BuildRequestSourceKind,
} from "@/lib/buildRequestFromSource";
import { BuildRequestFormModal } from "./BuildRequestFormModal";
import { BuildRequestStatusBadge } from "./buildRequestAtoms";
import { SingleSelect } from "./SearchableSelect";
import { RichTextWarningDialog } from "./RichTextWarningDialog";

const NO_COPY_NOTE = "No comments are copied and nobody is emailed.";

/**
 * The "Build requests" card on an EIR, Gray Market request or FAIT
 * (BusinessIT#68/#69/#65): every request raised from or linked to this record,
 * a button that raises another, and Link existing for one that already exists.
 * The list is DERIVED from the requests' own link column; nothing is stored on
 * this record for it.
 *
 * Anyone signed in can link or unlink, like a build request's task link (#58).
 * A request holds ONE link of each kind, so linking one that points at another
 * record MOVES it — and that is confirmed first.
 */
export function SourceBuildRequestsCard({
  kind,
  id,
  makeSource,
  onLinked,
}: {
  kind: BuildRequestSourceKind;
  id: number;
  /** Built when Create is pressed, from the loaded tasks and EIRs. */
  makeSource: (tasks: readonly Task[], eirs: readonly Eir[]) => BuildRequestSource;
  /** A request became linked here — raised from this record, or linked to it. */
  onLinked?: (br: BuildRequest) => void;
}) {
  const { data: all = [] } = useBuildRequests();
  const { data: linked, isLoading, isError } = useBuildRequestsForSource(kind, id);
  const { data: tasks = [] } = useTasks();
  const { data: eirs = [] } = useEirs();
  const setLink = useSetBuildRequestSourceLink();
  const [source, setSource] = useState<BuildRequestSource | null>(null);
  const [linking, setLinking] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [confirmMove, setConfirmMove] = useState<BuildRequest | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState<BuildRequest | null>(null);
  const noun = SOURCE_NOUN[kind];
  const columnsReady = buildRequestSourceColumnsAvailable();

  /** How the record a request is linked to elsewhere is named. */
  function otherLabel(otherId: number): string {
    if (kind === "eir") return eirs.find((e) => e.id === otherId)?.eirNo || `EIR #${otherId}`;
    return `${noun} #${otherId}`;
  }

  const options = linkableBuildRequests(all, kind, id).map((br) => {
    const other = linkedElsewhere(br, kind, id);
    return {
      value: String(br.id),
      label: `${br.brNo} — ${br.title} (${br.status})${other != null ? ` · linked to ${otherLabel(other)}` : ""}`,
    };
  });

  function link(br: BuildRequest) {
    setLink.mutate(
      { id: br.id, kind, sourceId: id },
      { onSuccess: (updated) => onLinked?.(updated) },
    );
    setLinking(false);
    setPicked(null);
    setConfirmMove(null);
  }

  function pressLink() {
    const br = all.find((b) => String(b.id) === picked);
    if (!br) return;
    if (linkedElsewhere(br, kind, id) != null) setConfirmMove(br);
    else link(br);
  }

  return (
    <section
      className="rounded-xl border border-border bg-surface p-4 sm:p-5"
      data-testid="source-build-requests"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          Build requests
        </h2>
        <div className="flex flex-wrap gap-2">
          {columnsReady && (
            <button
              type="button"
              onClick={() => setLinking((v) => !v)}
              aria-expanded={linking}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
              title={`Link a build request that already exists to this ${noun}`}
            >
              <Link2 className="h-4 w-4" />
              Link existing
            </button>
          )}
          <button
            type="button"
            onClick={() => setSource(makeSource(tasks, eirs))}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
            title={`Raise a build request from this ${noun}, carrying its part and comments across`}
          >
            <Plus className="h-4 w-4" />
            Create Build Request
          </button>
        </div>
      </div>

      {linking && (
        <div className="mb-3 rounded-md border border-border bg-surface-2 p-3" data-testid="link-existing">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <SingleSelect
                ariaLabel="Build request to link"
                allLabel="Pick a build request…"
                searchPlaceholder="Search build requests…"
                options={options}
                selected={picked}
                onChange={setPicked}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setLinking(false);
                  setPicked(null);
                }}
                className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={pressLink}
                disabled={picked == null}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Link
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            Open requests are listed first. Linking copies no comments and adds no part.
          </p>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-fg-muted">Loading build requests…</p>
      ) : isError ? (
        <p className="text-sm text-fg-muted">Couldn't read the build requests.</p>
      ) : !columnsReady ? (
        <p className="text-sm text-fg-muted">
          The Build Request list can't record links to this {noun} yet. A request can still be
          raised from here; ask an ARC admin to run scripts/add-build-request-source-columns.ps1.
        </p>
      ) : linked.length === 0 ? (
        <p className="text-sm text-fg-muted">None raised from or linked to this {noun} yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {linked.map((br) => (
            <li key={br.id} className="flex items-center gap-1">
              <Link
                to={`/build-request/${br.id}`}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm transition-colors hover:border-fg-muted"
              >
                <Hammer className="h-4 w-4 shrink-0 text-fg-muted" />
                <span className="font-mono text-xs font-semibold text-fg">{br.brNo}</span>
                <span className="min-w-0 flex-1 truncate text-fg">{br.title}</span>
                <BuildRequestStatusBadge status={br.status} />
              </Link>
              <button
                type="button"
                onClick={() => setConfirmUnlink(br)}
                aria-label={`Unlink ${br.brNo}`}
                title={`Unlink ${br.brNo} from this ${noun}`}
                className="rounded-md p-2 text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {source && (
        <BuildRequestFormModal
          fromSource={source}
          onCreated={onLinked}
          onClose={() => setSource(null)}
        />
      )}

      {confirmMove && (
        <RichTextWarningDialog
          title={`Move ${confirmMove.brNo} here?`}
          detail={`${confirmMove.brNo} is linked to ${otherLabel(
            linkedElsewhere(confirmMove, kind, id)!,
          )}. A build request links to one ${noun}, so linking it here takes it off that one.`}
          notifyNote={NO_COPY_NOTE}
          trailing=""
          confirmLabel="Move it here"
          cancelLabel="Cancel"
          onConfirm={() => link(confirmMove)}
          onCancel={() => setConfirmMove(null)}
        />
      )}

      {confirmUnlink && (
        <RichTextWarningDialog
          title={`Unlink ${confirmUnlink.brNo}?`}
          detail={`${confirmUnlink.brNo} stays as it is; it just stops showing on this ${noun}, and its page stops showing this ${noun} under Raised from.`}
          notifyNote="Nothing is deleted and nobody is emailed. You can link it again with Link existing."
          trailing=""
          confirmLabel="Unlink"
          cancelLabel="Keep it"
          onConfirm={() => {
            setLink.mutate({ id: confirmUnlink.id, kind, sourceId: null });
            setConfirmUnlink(null);
          }}
          onCancel={() => setConfirmUnlink(null)}
        />
      )}
    </section>
  );
}
