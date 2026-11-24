import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  QUOTE_FOLDER_SITE_LABEL,
  createIcQuoteFolder,
  listIcQuoteFolders,
  quoteFolderLibrary,
} from "@/api/quoteFolders";
import { driveItemNameProblem } from "@/api/driveLibrary";
import { GraphError } from "@/api/graph";
import { getQuote, updateQuoteFields } from "@/api/quotes";
import type { Quote } from "@/types/quote";
import { editQuoteGate } from "@/lib/quoteRoles";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";
import { createDriveLibraryHooks } from "./driveLibraryHooks";
import { QUOTES_KEY } from "./useQuotes";
import { requireQuoteGate, useResolveQuoteAccess } from "./useQuoteRoles";

// =============================================================================
// A quote's project folder (Ray, 2026-11-24) — see api/quoteFolders.ts.
//
// Browsing, subfolders and uploads inside the folder are the shared folder-
// library hooks, one set per folder name (cached, so a re-render never makes a
// second set). Setting the folder up — creating it under IC Quotes, or linking
// one already there — writes the quote's `ProjectFolder` column, so it needs
// the quote EDIT right, asked inside the mutationFn against the awaited roles
// list, BEFORE anything is created.
// =============================================================================

const hookSets = new Map<string, ReturnType<typeof createDriveLibraryHooks>>();

/** The folder-library hooks for one quote folder. */
export function quoteFolderHooks(name: string) {
  let hooks = hookSets.get(name);
  if (!hooks) {
    const lib = quoteFolderLibrary(name);
    hooks = createDriveLibraryHooks({
      keyPrefix: `quote-folder:${name}`,
      siteLabel: QUOTE_FOLDER_SITE_LABEL,
      recycleBin: "the Altronic_PMO site's recycle bin",
      api: {
        list: lib.list,
        getPath: lib.getPath,
        createFolder: lib.createFolder,
        upload: lib.upload,
        rename: lib.rename,
        remove: lib.remove,
      },
    });
    hookSets.set(name, hooks);
  }
  return hooks;
}

export const IC_QUOTE_FOLDERS_KEY = ["ic-quote-folders"] as const;

/** The folders directly under IC Quotes — offered for linking. Only fetched when asked. */
export function useIcQuoteFolders(enabled: boolean) {
  return useQuery({
    queryKey: IC_QUOTE_FOLDERS_KEY,
    queryFn: listIcQuoteFolders,
    enabled,
    staleTime: 60_000,
  });
}

/**
 * The folder a quote uses: its own, else the newest rev of the same base that
 * has one — so a rev made before the folder was set still finds it.
 */
export function quoteFolderFor(quote: Quote, allQuotes: Quote[]): string {
  if (quote.projectFolder) return quote.projectFolder;
  const revs = allQuotes
    .filter((q) => q.quoteBase === quote.quoteBase && q.projectFolder)
    .sort((a, b) => b.rev - a.rev);
  return revs[0]?.projectFolder ?? "";
}

/**
 * Set a quote's folder up: create it under IC Quotes (`create: true`) or link
 * an existing one, then store its name on the quote.
 */
export function useSetUpQuoteFolder() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async ({ quoteId, name, create }: { quoteId: number; name: string; create: boolean }) => {
      requireQuoteGate(editQuoteGate(await resolve()));
      const trimmed = name.trim();
      const problem = driveItemNameProblem(trimmed, "folder");
      if (problem) throw new Error(problem);
      const before = await getQuote(quoteId);
      if (!before) throw new Error(`Quote ${quoteId} not found`);
      const folderName = create ? (await createIcQuoteFolder(trimmed)).name : trimmed;
      try {
        return await updateQuoteFields(quoteId, { projectFolder: folderName }, before);
      } catch (err) {
        // The folder is real by now; say so, so nobody creates a second one.
        if (create) {
          throw new Error(
            `The folder "${folderName}" was created in IC Quotes, but couldn't be linked to the quote: ` +
              `${err instanceof Error ? err.message : String(err)} Link it with "Link an existing folder".`,
          );
        }
        throw err;
      }
    },
    onSuccess: (updated, { create }) => {
      qc.setQueryData<Quote[]>(QUOTES_KEY, (list) => list?.map((q) => (q.id === updated.id ? updated : q)));
      void qc.invalidateQueries({ queryKey: QUOTES_KEY });
      void qc.invalidateQueries({ queryKey: IC_QUOTE_FOLDERS_KEY });
      pushToast({
        message: create
          ? `Created the project folder "${updated.projectFolder}".`
          : `Linked the project folder "${updated.projectFolder}".`,
      });
    },
    onError: (err: unknown, { name, create }) => {
      void qc.invalidateQueries({ queryKey: IC_QUOTE_FOLDERS_KEY });
      // ARC's own refusals (a name clash, a bad name, no edit right, "created
      // but not linked") are already sentences; a raw Graph refusal is not.
      pushToast({
        variant: "error",
        message:
          err instanceof Error && !(err instanceof GraphError)
            ? err.message
            : describeListWriteFailure(err, {
                action: create ? `create the folder "${name}"` : `link the folder "${name}"`,
                site: QUOTE_FOLDER_SITE_LABEL,
                permission: "adding to its Documents library",
              }),
      });
    },
  });
}
