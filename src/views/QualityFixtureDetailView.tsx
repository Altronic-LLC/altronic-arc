import { useState } from "react";
import { useParams } from "react-router-dom";
import { Archive, ArchiveRestore, Pencil, Wrench } from "lucide-react";
import { useQualityFixtures, useSetQualityFixtureActive } from "@/hooks/useQualityFixtures";
import { useMyQualityFixtureAccess } from "@/hooks/useQualityFixtureRoles";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { QualityFixtureFormModal } from "@/components/QualityFixtureFormModal";
import { FixtureStatusChip } from "@/components/qualityFixtureAtoms";
import { editFixturesGate } from "@/lib/qualityFixtureRoles";
import { isPermissionDenied } from "@/lib/listWriteErrors";

// =============================================================================
// One fixture on the Quality Fixture Log. Everyone signed in sees it and its
// attachments (photos, drawings); a Fixture Log editor edits it, retires it
// or puts it back, and adds or removes files.
// =============================================================================

export function QualityFixtureDetailView() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const { data: fixtures = [], isLoading, error, refetch } = useQualityFixtures();
  const gate = editFixturesGate(useMyQualityFixtureAccess());
  const setActive = useSetQualityFixtureActive();
  const [editing, setEditing] = useState(false);

  const fixture = fixtures.find((f) => f.id === id);

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Quality Fixture Log" listTo="/quality/fixtures" />
      {isLoading ? (
        <LoadingTasks noun="the fixture" />
      ) : error && isPermissionDenied(error) ? (
        <ListAccessNotice list="Quality Fixture Log" site="Altronic_PMO" onRetry={() => void refetch()} />
      ) : error ? (
        <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't load the Quality Fixture Log: {(error as Error).message}{" "}
          <button type="button" onClick={() => void refetch()} className="font-semibold underline">
            Try again
          </button>
        </div>
      ) : !fixture ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
          That fixture isn't on the log.
        </div>
      ) : (
        <>
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
                <Wrench className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">{fixture.number}</h1>
                  <FixtureStatusChip active={fixture.active} />
                </div>
                <p className="text-sm text-fg">{fixture.description || "No description"}</p>
              </div>
            </div>
            {gate.allowed && (
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </button>
                <button
                  type="button"
                  disabled={setActive.isPending}
                  onClick={() => {
                    if (
                      fixture.active &&
                      !window.confirm(
                        `Retire ${fixture.number}? It stays on the log, hidden from the Active list, and its number won't be reused. You can put it back later.`,
                      )
                    ) {
                      return;
                    }
                    setActive.mutate({ id: fixture.id, active: !fixture.active });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
                >
                  {fixture.active ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
                  {fixture.active ? "Retire" : "Put back in service"}
                </button>
              </div>
            )}
          </header>

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Location" value={fixture.location} />
              <Field label="Comment" value={fixture.comment} />
              <div className="sm:col-span-2">
                <Field label="Products / part numbers" value={fixture.partNumbers} multiline />
              </div>
            </dl>
          </section>

          <AttachmentsSection parent="qualityFixture" itemId={fixture.id} readOnly={!gate.allowed} />

          {!gate.allowed && !gate.resolving && <p className="text-[11px] text-fg-muted">{gate.hint}</p>}

          {editing && (
            <QualityFixtureFormModal fixtures={fixtures} fixture={fixture} onClose={() => setEditing(false)} />
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className={multiline ? "whitespace-pre-line text-fg" : "text-fg"}>{value || "—"}</dd>
    </div>
  );
}
