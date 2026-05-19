import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTestSheet,
  listTestSheets,
  updateTestSheetFields,
  type CreateTestSheetInput,
} from "@/api/testSheets";
import type { Person, TestSheet } from "@/types/task";
import { pushToast } from "@/components/Toast";

const TEST_SHEETS_KEY = ["testSheets", "list"] as const;

export function useTestSheets() {
  return useQuery({
    queryKey: TEST_SHEETS_KEY,
    queryFn: listTestSheets,
    staleTime: 120_000,
  });
}

export function useTestSheet(id: number | null) {
  const list = useTestSheets();
  return {
    ...list,
    data: id !== null ? list.data?.find((s) => s.id === id) ?? null : null,
  };
}

export function useCreateTestSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTestSheetInput) => createTestSheet(input),
    onSuccess: (created) => {
      qc.setQueryData<TestSheet[]>(TEST_SHEETS_KEY, (old) =>
        old ? [created, ...old] : [created],
      );
      qc.invalidateQueries({ queryKey: TEST_SHEETS_KEY });
      pushToast({ message: `Created test sheet "${created.title}".` });
    },
    onError: () =>
      pushToast({
        message: "Couldn't create test sheet — please retry.",
        variant: "error",
      }),
  });
}

/**
 * Optimistic test sheet update with confirmation toast + undo. Mirrors the
 * task-side useUpdateTaskFields flow.
 */
export function useUpdateTestSheetFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      fields,
    }: {
      id: number;
      fields: Record<string, unknown>;
    }) => updateTestSheetFields(id, fields),
    onMutate: async ({ id, fields }) => {
      await qc.cancelQueries({ queryKey: TEST_SHEETS_KEY });
      const previous = qc.getQueryData<TestSheet[]>(TEST_SHEETS_KEY);
      const prevSheet = previous?.find((s) => s.id === id);
      qc.setQueryData<TestSheet[]>(TEST_SHEETS_KEY, (old) =>
        old?.map((s) => (s.id === id ? applyTestSheetFieldsLocally(s, fields) : s)) ?? [],
      );
      return { previous, prevSheet };
    },
    onSuccess: (_data, { id, fields }, ctx) => {
      const inverse = ctx?.prevSheet ? extractInverseSheetFields(ctx.prevSheet, fields) : null;
      pushToast({
        message: "Test sheet updated.",
        undo:
          inverse && Object.keys(inverse).length > 0 && ctx?.previous
            ? () => {
                qc.setQueryData(TEST_SHEETS_KEY, ctx.previous);
                updateTestSheetFields(id, inverse).catch((err) => {
                  console.error("Undo failed:", err);
                  pushToast({
                    message: "Couldn't undo on SharePoint. Refreshing.",
                    variant: "error",
                  });
                  qc.invalidateQueries({ queryKey: TEST_SHEETS_KEY });
                });
              }
            : undefined,
      });
    },
    onError: (_err, _vars, ctx: { previous?: TestSheet[] } | undefined) => {
      if (ctx?.previous) qc.setQueryData(TEST_SHEETS_KEY, ctx.previous);
      pushToast({
        message: "Couldn't save test sheet changes — reverted.",
        variant: "error",
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TEST_SHEETS_KEY });
    },
  });
}

function applyTestSheetFieldsLocally(
  s: TestSheet,
  fields: Record<string, unknown>,
): TestSheet {
  const next: TestSheet = { ...s, modifiedAt: new Date() };
  if ("Title" in fields) next.title = (fields.Title as string) ?? next.title;
  if ("Product" in fields) next.product = (fields.Product as string) ?? "";
  if ("SerialNumber" in fields) next.serialNumber = (fields.SerialNumber as string) ?? "";
  if ("Purpose" in fields) next.purpose = (fields.Purpose as string) ?? "";
  if ("Results" in fields) next.results = (fields.Results as string) ?? "";
  if ("TestingSteps" in fields) next.testingSteps = (fields.TestingSteps as string) ?? "";
  if ("FirmwareVersion" in fields)
    next.firmwareVersion = (fields.FirmwareVersion as string) ?? "";
  if ("TestDate" in fields) {
    const v = fields.TestDate;
    next.testDate = v ? new Date(v as string) : null;
  }
  if ("ProjectReferenceLookupId" in fields) {
    const v = fields.ProjectReferenceLookupId;
    next.parentProject = v ? { lookupId: Number(v), title: s.parentProject?.title ?? "" } : null;
  }
  if ("TaskReferenceLookupId" in fields) {
    const v = fields.TaskReferenceLookupId;
    next.parentTask = v
      ? { id: Number(v), numberedTitle: s.parentTask?.numberedTitle ?? "" }
      : null;
  }
  if ("Tester" in fields) {
    const v = fields.Tester;
    if (v === null || v === undefined) {
      next.tester = null;
    } else if (Array.isArray(v) || (typeof v === "object" && "displayName" in (v as object))) {
      next.tester = (Array.isArray(v) ? v[0] : v) as Person;
    }
  }
  return next;
}

/** Build a fields object that, if sent to updateTestSheetFields, undoes the change. */
function extractInverseSheetFields(
  prev: TestSheet,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const inv: Record<string, unknown> = {};
  if ("Title" in fields) inv.Title = prev.title;
  if ("Product" in fields) inv.Product = prev.product;
  if ("SerialNumber" in fields) inv.SerialNumber = prev.serialNumber;
  if ("Purpose" in fields) inv.Purpose = prev.purpose;
  if ("Results" in fields) inv.Results = prev.results;
  if ("TestingSteps" in fields) inv.TestingSteps = prev.testingSteps;
  if ("FirmwareVersion" in fields) inv.FirmwareVersion = prev.firmwareVersion;
  if ("TestDate" in fields)
    inv.TestDate = prev.testDate ? prev.testDate.toISOString() : null;
  if ("ProjectReferenceLookupId" in fields)
    inv.ProjectReferenceLookupId = prev.parentProject?.lookupId ?? null;
  if ("TaskReferenceLookupId" in fields)
    inv.TaskReferenceLookupId = prev.parentTask?.id ?? null;
  if ("Tester" in fields) inv.Tester = prev.tester;
  return inv;
}
