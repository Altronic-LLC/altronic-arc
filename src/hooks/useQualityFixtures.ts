import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createQualityFixture,
  listQualityFixtures,
  updateQualityFixture,
} from "@/api/qualityFixtures";
import type { QualityFixture, QualityFixtureInput } from "@/types/qualityFixture";
import { compareFixtures, qualityFixtureInputFrom, qualityFixtureLabel } from "@/lib/qualityFixtures";
import { editFixturesGate } from "@/lib/qualityFixtureRoles";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";
import { requireQualityFixtureGate, useResolveQualityFixtureAccess } from "./useQualityFixtureRoles";

// =============================================================================
// Quality Fixture Log hooks. Reading is open to everyone signed in; every
// write asks `editFixturesGate` INSIDE its mutationFn, awaiting the roles list
// (useResolveQualityFixtureAccess), so no future screen writes ungated.
//
// No delete hook: retiring (Active = No) is how a fixture leaves service.
// =============================================================================

export const QUALITY_FIXTURES_KEY = ["quality-fixtures", "list"] as const;

const SITE_LABEL = "Altronic_PMO";

export function useQualityFixtures() {
  return useQuery<QualityFixture[]>({
    queryKey: QUALITY_FIXTURES_KEY,
    queryFn: listQualityFixtures,
    staleTime: 5 * 60_000,
  });
}

/** One fixture, from the cached list. */
export function useQualityFixture(id: number | null) {
  const query = useQualityFixtures();
  const fixture = id === null ? undefined : query.data?.find((f) => f.id === id);
  return { ...query, data: fixture };
}

function upsert(qc: ReturnType<typeof useQueryClient>, row: QualityFixture) {
  qc.setQueryData<QualityFixture[]>(QUALITY_FIXTURES_KEY, (old) => {
    if (!old) return [row];
    const next = old.some((f) => f.id === row.id) ? old.map((f) => (f.id === row.id ? row : f)) : [...old, row];
    return next.sort(compareFixtures);
  });
}

function writeError(action: string) {
  return (err: unknown) =>
    pushToast({
      message: describeListWriteFailure(err, { action, site: SITE_LABEL, permission: "editing" }),
      variant: "error",
    });
}

export function useCreateQualityFixture() {
  const qc = useQueryClient();
  const resolve = useResolveQualityFixtureAccess();
  return useMutation({
    mutationFn: async (input: QualityFixtureInput) => {
      requireQualityFixtureGate(editFixturesGate(await resolve()));
      return createQualityFixture(input);
    },
    onSuccess: (created) => {
      upsert(qc, created);
      pushToast({ message: `Added ${qualityFixtureLabel(created)}` });
    },
    onError: writeError("add the fixture"),
    onSettled: () => qc.invalidateQueries({ queryKey: QUALITY_FIXTURES_KEY }),
  });
}

/** The row an edit starts from — the cached one. Refuses rather than sending everything blind. */
function cachedRow(qc: ReturnType<typeof useQueryClient>, id: number): QualityFixture {
  const row = qc.getQueryData<QualityFixture[]>(QUALITY_FIXTURES_KEY)?.find((f) => f.id === id);
  if (!row) throw new Error("That fixture isn't loaded — refresh the log and try again.");
  return row;
}

export function useUpdateQualityFixture() {
  const qc = useQueryClient();
  const resolve = useResolveQualityFixtureAccess();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: QualityFixtureInput }) => {
      requireQualityFixtureGate(editFixturesGate(await resolve()));
      return updateQualityFixture(id, input, cachedRow(qc, id));
    },
    onSuccess: (updated) => {
      upsert(qc, updated);
      pushToast({ message: `Saved ${qualityFixtureLabel(updated)}` });
    },
    onError: writeError("save the fixture"),
    onSettled: () => qc.invalidateQueries({ queryKey: QUALITY_FIXTURES_KEY }),
  });
}

/** Retire (false) or put back in service (true). */
export function useSetQualityFixtureActive() {
  const qc = useQueryClient();
  const resolve = useResolveQualityFixtureAccess();
  return useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      requireQualityFixtureGate(editFixturesGate(await resolve()));
      const previous = cachedRow(qc, id);
      return updateQualityFixture(id, { ...qualityFixtureInputFrom(previous), active }, previous);
    },
    onSuccess: (updated) => {
      upsert(qc, updated);
      pushToast({
        message: updated.active
          ? `${updated.number} is back in service`
          : `${updated.number} retired — it stays on the log and its number won't be reused`,
      });
    },
    onError: writeError("change the fixture"),
    onSettled: () => qc.invalidateQueries({ queryKey: QUALITY_FIXTURES_KEY }),
  });
}
