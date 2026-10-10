import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DriveEntry } from "@/api/projectFiles";
import type { DriveCrumb } from "@/api/driveLibrary";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";

// =============================================================================
// React Query hooks for a folder library (see api/driveLibrary.ts) — shared by
// SCN Documents and Supply Chain Files. A folder's listing is cached per folder
// id ("root" for the library root); a write invalidates the folder it landed in.
// =============================================================================

export interface DriveLibraryHooksConfig {
  /** Cache-key prefix, unique per library ("scn-documents"). */
  keyPrefix: string;
  /** Where somebody would ask about a refusal ("ALTRONICSALESTEAM / SCN"). */
  siteLabel: string;
  /** Said after a delete ("the SCN site's recycle bin"). */
  recycleBin: string;
  api: {
    list: (folderId?: string) => Promise<DriveEntry[]>;
    getPath: (folderId?: string) => Promise<DriveCrumb[]>;
    createFolder: (parentId: string | null, name: string) => Promise<DriveEntry>;
    upload: (
      folderId: string | null,
      file: File,
      onProgress?: (fraction: number) => void,
    ) => Promise<DriveEntry>;
    rename: (
      itemId: string,
      newName: string,
      options?: { currentName?: string; isFolder?: boolean },
    ) => Promise<DriveEntry | null>;
    remove: (itemId: string) => Promise<void>;
  };
}

/** Where a multi-file upload has got to. */
export interface DriveUploadProgress {
  /** 1-based position of the file being sent. */
  index: number;
  total: number;
  name: string;
  /** 0–1 for the CURRENT file. */
  fraction: number;
}

export interface DriveUploadResult {
  uploaded: DriveEntry[];
  failed: { name: string; message: string }[];
}

export interface DriveItemRef {
  id: string;
  name: string;
  isFolder: boolean;
}

export function createDriveLibraryHooks(cfg: DriveLibraryHooksConfig) {
  const listKey = (folderId?: string | null) => [cfg.keyPrefix, folderId ?? "root"] as const;
  const pathKey = (folderId?: string | null) =>
    [`${cfg.keyPrefix}-path`, folderId ?? "root"] as const;

  /**
   * Every cached listing AND breadcrumb. A rename or delete can touch more than
   * the folder it happened in — a renamed folder is a crumb in every breadcrumb
   * beneath it, a deleted one takes its whole subtree — so both refresh all.
   * Cheap: only the folder on screen is actually refetched.
   */
  function invalidateEverything(qc: ReturnType<typeof useQueryClient>) {
    void qc.invalidateQueries({ queryKey: [cfg.keyPrefix] });
    void qc.invalidateQueries({ queryKey: [`${cfg.keyPrefix}-path`] });
  }

  function useFolder(folderId?: string | null) {
    return useQuery<DriveEntry[]>({
      queryKey: listKey(folderId),
      queryFn: () => cfg.api.list(folderId ?? undefined),
      staleTime: 60_000,
    });
  }

  /** The breadcrumb, root first. Cached — a folder's ancestors don't move. */
  function usePath(folderId?: string | null) {
    return useQuery({
      queryKey: pathKey(folderId),
      queryFn: () => cfg.api.getPath(folderId ?? undefined),
      staleTime: 5 * 60_000,
    });
  }

  function useCreateFolder() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: ({ parentId, name }: { parentId: string | null; name: string }) =>
        cfg.api.createFolder(parentId, name),
      onSuccess: (entry, { parentId }) => {
        void qc.invalidateQueries({ queryKey: listKey(parentId) });
        pushToast({ message: `Created the folder "${entry.name}".` });
      },
      onError: (err, { name }) => {
        pushToast({
          message: describeListWriteFailure(err, {
            action: `create the folder "${name}"`,
            site: cfg.siteLabel,
            permission: "adding to its Documents library",
          }),
          variant: "error",
        });
      },
    });
  }

  /**
   * Upload several files ONE AT A TIME — one big upload at a time over a VPN is
   * reliable where several in parallel are not — reporting progress as it goes.
   * One file failing doesn't stop the rest; the result names each failure.
   */
  function useUpload() {
    const qc = useQueryClient();
    const [progress, setProgress] = useState<DriveUploadProgress | null>(null);

    const mutation = useMutation({
      mutationFn: async ({
        folderId,
        files,
      }: {
        folderId: string | null;
        files: File[];
      }): Promise<DriveUploadResult> => {
        const result: DriveUploadResult = { uploaded: [], failed: [] };
        try {
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setProgress({ index: i + 1, total: files.length, name: file.name, fraction: 0 });
            try {
              const entry = await cfg.api.upload(folderId, file, (fraction) =>
                setProgress({ index: i + 1, total: files.length, name: file.name, fraction }),
              );
              result.uploaded.push(entry);
            } catch (err) {
              result.failed.push({
                name: file.name,
                message: describeListWriteFailure(err, {
                  action: `upload "${file.name}"`,
                  site: cfg.siteLabel,
                  permission: "adding to its Documents library",
                }),
              });
            }
          }
        } finally {
          setProgress(null);
        }
        return result;
      },
      onSuccess: (result, { folderId }) => {
        if (result.uploaded.length > 0) {
          void qc.invalidateQueries({ queryKey: listKey(folderId) });
          pushToast({
            message:
              result.uploaded.length === 1
                ? `Uploaded "${result.uploaded[0].name}".`
                : `Uploaded ${result.uploaded.length} files.`,
          });
        }
        for (const failure of result.failed) {
          pushToast({ message: failure.message, variant: "error" });
        }
      },
    });

    return { ...mutation, progress };
  }

  /** Rename a file or folder. Any signed-in user; SharePoint is the boundary. */
  function useRename() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: ({ item, newName }: { item: DriveItemRef; newName: string }) =>
        cfg.api.rename(item.id, newName, { currentName: item.name, isFolder: item.isFolder }),
      onSuccess: (entry, { item, newName }) => {
        if (!entry) return; // unchanged — nothing was sent
        invalidateEverything(qc);
        pushToast({ message: `Renamed "${item.name}" to "${newName}".` });
      },
      onError: (err, { item }) => {
        pushToast({
          message: describeListWriteFailure(err, {
            action: `rename "${item.name}"`,
            site: cfg.siteLabel,
            permission: "editing",
          }),
          variant: "error",
        });
      },
    });
  }

  /**
   * Delete a file or folder — it goes to the site's recycle bin (93 days).
   * Not optimistic: the row stays until SharePoint confirms, so a refusal never
   * has to put anything back.
   */
  function useDelete() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: ({ item }: { item: DriveItemRef }) => cfg.api.remove(item.id),
      onSuccess: (_void, { item }) => {
        invalidateEverything(qc);
        pushToast({
          message: `Deleted "${item.name}" — it's in ${cfg.recycleBin} for 93 days.`,
        });
      },
      onError: (err, { item }) => {
        // Refetch either way: a refused delete leaves the row, a vanished one doesn't.
        invalidateEverything(qc);
        pushToast({
          message: describeListWriteFailure(err, {
            action: `delete "${item.name}"`,
            site: cfg.siteLabel,
            permission: "deleting",
          }),
          variant: "error",
        });
      },
    });
  }

  return { listKey, useFolder, usePath, useCreateFolder, useUpload, useRename, useDelete };
}

export type DriveLibraryHooks = ReturnType<typeof createDriveLibraryHooks>;
