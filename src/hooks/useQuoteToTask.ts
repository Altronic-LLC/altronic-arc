import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createTask, TaskFollowUpWriteError } from "@/api/tasks";
import {
  createOperationsTask,
  listOperationsTasks,
  updateOperationsTaskFields,
} from "@/api/operationsTasks";
import { copyAttachments } from "@/api/attachments";
import { addQuoteComment, getQuote, updateQuoteFields } from "@/api/quotes";
import { notifyChangeEmails } from "@/api/email";
import { pushToast } from "@/components/Toast";
import { editQuoteGate } from "@/lib/quoteRoles";
import { computeOperationsTaskNumber } from "@/lib/operationsTaskNumbering";
import { mergeTaskIntoList } from "@/lib/taskGraph";
import { autoWatchers } from "@/lib/people";
import {
  buildQuoteTaskCommunication,
  buildQuoteTaskDescription,
  buildQuoteTaskEmails,
  departmentLabel,
  quoteTaskCreatedCommentHtml,
  quoteTaskKind,
  quoteTaskRefusal,
  type QuoteTaskDepartment,
} from "@/lib/quoteToTask";
import type { QuotePatch } from "@/lib/quoteMapper";
import type { Quote, QuoteAssembly, QuoteCustomer } from "@/types/quote";
import type { OperationsTask, Person, ProjectReference, Task } from "@/types/task";
import { QUOTE_ASSEMBLIES_KEY, QUOTES_KEY } from "./useQuotes";
import { QUOTE_CUSTOMERS_KEY } from "./useQuoteCustomers";
import { requireQuoteGate, useResolveQuoteAccess } from "./useQuoteRoles";
import { TASK_LIST_KEY } from "./useTasks";
import { OPERATIONS_TASK_LIST_KEY } from "./useOperationsTasks";

// =============================================================================
// Creating an Engineering or Operations task from a WON Insourcing Quote
// (Ray, 2026-10-30) — the EIR → Task promotion, for quotes. Rules and wording
// are in lib/quoteToTask.ts.
//
// Order, and what may fail without failing the whole thing — the promotion's
// rule: only the task create is fatal. Everything after it is real work on a
// task that exists, so a refusal there is COLLECTED into one warning naming
// what to do by hand.
//   1. the task (Engineering: Communication travels as createTask's follow-up
//      PATCH; Operations: its own PATCH right after the create);
//   2. the quote's attachments copied onto it;
//   3. the quote's Linked work columns: task id + project title;
//   4. a note on the quote naming the task;
//   5. an email to the quote's watchers.
// Without step 3 nothing mirrors, so its warning says to link it by hand.
// =============================================================================

const PROJECTS_KEY = ["projects"] as const;

export interface QuoteToTaskInput {
  quote: Quote;
  department: QuoteTaskDepartment;
  title: string;
  project: ProjectReference;
  /** Engineering only — the modal previews it (computeNumberedTitle). */
  numberedTitle?: string;
  createdBy: Person;
}

export interface QuoteToTaskResult {
  department: QuoteTaskDepartment;
  taskId: number;
  taskLabel: string;
  engineeringTask: Task | null;
  operationsTask: OperationsTask | null;
  warning: string | null;
}

export function useCreateTaskFromQuote() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation<QuoteToTaskResult, unknown, QuoteToTaskInput>({
    mutationFn: async ({ quote, department, title, project, numberedTitle, createdBy }) => {
      // Quoter or manager (Ray), awaited — never a render-time flag.
      requireQuoteGate(editQuoteGate(await resolve()));
      // The quote as it stands NOW: still Won, and not linked meanwhile.
      const fresh = (await getQuote(quote.id)) ?? quote;
      const refusal = quoteTaskRefusal(fresh, department);
      if (refusal) throw new Error(refusal);

      const warnings: string[] = [];
      const now = new Date();
      const lines = (qc.getQueryData<QuoteAssembly[]>(QUOTE_ASSEMBLIES_KEY) ?? []).filter(
        (a) => a.quoteId === fresh.id,
      );
      const customer =
        qc.getQueryData<QuoteCustomer[]>(QUOTE_CUSTOMERS_KEY)?.find((c) => c.id === fresh.customerId) ?? null;
      const description = buildQuoteTaskDescription({
        quote: fresh,
        customerName: customer?.name ?? null,
        lines,
      });
      const communication = buildQuoteTaskCommunication({
        quote: fresh,
        createdBy: { displayName: createdBy.displayName, email: createdBy.email ?? "" },
        now,
      });
      const watchers = autoWatchers(fresh.watchers, [], createdBy);
      const discussionWarning = `the quote's discussion couldn't be copied to the task — copy it across from ${fresh.quoteNumber}, and link the task under Linked work by hand so comments are shared`;

      let engineeringTask: Task | null = null;
      let operationsTask: OperationsTask | null = null;

      if (department === "engineering") {
        try {
          engineeringTask = await createTask({
            title,
            numberedTitle: numberedTitle ?? title,
            description,
            parentProjectLookupId: project.lookupId,
            watchers,
            communication,
          });
        } catch (err) {
          if (!(err instanceof TaskFollowUpWriteError)) throw err;
          engineeringTask = err.task;
          warnings.push(discussionWarning);
        }
      } else {
        // Numbered from a FRESH list: TaskNumber is unique in SharePoint, so a
        // refused create is renumbered and retried once (the form's rule).
        const all = await listOperationsTasks();
        const first = computeOperationsTaskNumber(project, all);
        const create = (taskNumber: string) =>
          createOperationsTask({
            title,
            taskNumber,
            description,
            parentProjectLookupId: project.lookupId,
            watchers,
          });
        try {
          operationsTask = await create(first);
        } catch (err) {
          const next = computeOperationsTaskNumber(project, await listOperationsTasks());
          if (next === first) throw err;
          operationsTask = await create(next);
        }
        try {
          operationsTask = await updateOperationsTaskFields(operationsTask.id, { Communication: communication });
        } catch (err) {
          console.error(`useCreateTaskFromQuote: discussion copy failed for quote ${fresh.id}`, err);
          warnings.push(discussionWarning);
        }
      }

      const taskId = (engineeringTask?.id ?? operationsTask?.id)!;
      const taskLabel =
        engineeringTask?.numberedTitle ||
        engineeringTask?.title ||
        operationsTask?.taskNumber ||
        operationsTask?.title ||
        `#${taskId}`;

      if (fresh.hasAttachments) {
        try {
          const { copied, failed } = await copyAttachments("quote", fresh.id, quoteTaskKind(department), taskId);
          if (failed.length > 0) {
            warnings.push(
              copied.length > 0
                ? `${failed.length} of ${copied.length + failed.length} attachments couldn't be copied over (${failed.join(", ")}) — attach ${failed.length === 1 ? "it" : "them"} by hand`
                : "none of the quote's attachments could be copied over — attach them by hand",
            );
          }
        } catch (err) {
          console.error(`useCreateTaskFromQuote: attachment copy failed for quote ${fresh.id}`, err);
          warnings.push("the quote's attachments couldn't be copied over — attach them by hand");
        }
      }

      const patch: QuotePatch =
        department === "engineering"
          ? { engineeringTaskId: taskId, engineeringProjectRef: project.title }
          : { operationsTaskId: taskId, operationsProjectRef: project.title };
      try {
        const updated = await updateQuoteFields(fresh.id, patch, fresh);
        qc.setQueryData<Quote[]>(QUOTES_KEY, (old) => old?.map((q) => (q.id === updated.id ? updated : q)));
      } catch (err) {
        console.error(`useCreateTaskFromQuote: linking quote ${fresh.id} failed`, err);
        warnings.push(
          `the quote couldn't be linked to it — pick ${taskLabel} under Linked work, or comments won't be shared`,
        );
      }

      try {
        await addQuoteComment(fresh.id, {
          authorName: createdBy.displayName || "ARC",
          authorEmail: createdBy.email ?? "",
          bodyHtml: quoteTaskCreatedCommentHtml(department, { id: taskId, label: taskLabel }, project.title),
        });
      } catch (err) {
        console.error(`useCreateTaskFromQuote: note on quote ${fresh.id} failed`, err);
      }

      const emails = buildQuoteTaskEmails({
        quoteNumber: fresh.quoteNumber,
        dept: department,
        taskLabel,
        watchers: fresh.watchers,
        actor: createdBy,
      });
      if (emails.length > 0) {
        void notifyChangeEmails({
          target: {
            kind: quoteTaskKind(department),
            id: taskId,
            title: taskLabel,
            // Told to the quote's people, so it joins the quote's conversation.
            thread: { key: `quote:${fresh.id}`, subject: fresh.quoteNumber },
          },
          emails,
        });
      }

      return {
        department,
        taskId,
        taskLabel,
        engineeringTask,
        operationsTask,
        warning: warnings.length > 0 ? `Created the task, but ${warnings.join("; and ")}.` : null,
      };
    },
    onSuccess: (result) => {
      // Seed the new task so the navigation that follows doesn't land on
      // "not found" (the promotion's fix).
      if (result.engineeringTask) {
        const task = result.engineeringTask;
        qc.setQueryData<Task[]>(TASK_LIST_KEY, (old) =>
          old ? mergeTaskIntoList(old, task, qc.getQueryData<ProjectReference[]>(PROJECTS_KEY) ?? []) : [task],
        );
        void qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
      }
      if (result.operationsTask) {
        const task = result.operationsTask;
        qc.setQueryData<OperationsTask[]>(OPERATIONS_TASK_LIST_KEY, (old) =>
          old ? [task, ...old.filter((t) => t.id !== task.id)] : [task],
        );
        void qc.invalidateQueries({ queryKey: OPERATIONS_TASK_LIST_KEY });
      }
      void qc.invalidateQueries({ queryKey: QUOTES_KEY });
      pushToast(
        result.warning
          ? { message: result.warning, variant: "error" }
          : { message: `Created ${departmentLabel(result.department)} task ${result.taskLabel} from the quote.` },
      );
    },
    onError: (err) => {
      pushToast({
        message: `Couldn't create the task. ${err instanceof Error ? err.message : String(err)}`,
        variant: "error",
      });
    },
  });
}
