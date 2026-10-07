import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SCN_DOCUMENTS_SITE_LABEL,
  createScnFolder,
  getScnDocumentPath,
  listScnDocuments,
  uploadScnDocument,
} from "@/api/scnDocuments";
import type { DriveEntry } from "@/api/projectFiles";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";

// =============================================================================
// SCN Documents library hooks. A folder's listing is cached per folder id
// ("root" for the library root); a write invalidates the folder it landed in.
// =============================================================================

export const SCN_DOCUMENTS_KEY = (folderId?: string | null) =>
  ["scn-documents", folderId ?? "root"] as const;
const PATH_KEY = (folderId?: string | null) => ["scn-documents-path", folderId ?? "root"] as const;

export function useScnDocuments(folderId?: string | null) {
  return useQuery<DriveEntry[]>({
    queryKey: SCN_DOCUMENTS_KEY(folderId),
    queryFn: () => listScnDocuments(folderId ?? undefined),
    staleTime: 60_000,
  });
}

/** The breadcrumb, root first. Cached — a folder's ancestors don't move. */
export function useScnDocumentPath(folderId?: string | null) {
  return useQuery({
    queryKey: PATH_KEY(folderId),
    queryFn: () => getScnDocumentPath(folderId ?? undefined),
    staleTime: 5 * 60_000,
  });
}

export function useCreateScnFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ parentId, name }: { parentId: string | null; name: string }) =>
      createScnFolder(parentId, name),
    onSuccess: (entry, { parentId }) => {
      void qc.invalidateQueries({ queryKey: SCN_DOCUMENTS_KEY(parentId) });
      pushToast({ message: `Created the folder "${entry.name}".` });
    },
    onError: (err, { name }) => {
      pushToast({
        message: describeListWriteFailure(err, {
          action: `create the folder "${name}"`,
          site: SCN_DOCUMENTS_SITE_LABEL,
          permission: "adding to its Documents library",
        }),
        variant: "error",
      });
    },
  });
}

/** Where a multi-file upload has got to. */
export interface ScnUploadProgress {
  /** 1-based position of the file being sent. */
  index: number;
  total: number;
  name: string;
  /** 0–1 for the CURRENT file. */
  fraction: number;
}

export interface ScnUploadResult {
  uploaded: DriveEntry[];
  failed: { name: string; message: string }[];
}

/**
 * Upload several files ONE AT A TIME — one big upload at a time over a VPN is
 * reliable where several in parallel are not — reporting progress as it goes.
 * One file failing doesn't stop the rest; the result names each failure.
 */
export function useUploadScnDocument() {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<ScnUploadProgress | null>(null);

  const mutation = useMutation({
    mutationFn: async ({
      folderId,
      files,
    }: {
      folderId: string | null;
      files: File[];
    }): Promise<ScnUploadResult> => {
      const result: ScnUploadResult = { uploaded: [], failed: [] };
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setProgress({ index: i + 1, total: files.length, name: file.name, fraction: 0 });
          try {
            const entry = await uploadScnDocument(folderId, file, (fraction) =>
              setProgress({ index: i + 1, total: files.length, name: file.name, fraction }),
            );
            result.uploaded.push(entry);
          } catch (err) {
            result.failed.push({
              name: file.name,
              message: describeListWriteFailure(err, {
                action: `upload "${file.name}"`,
                site: SCN_DOCUMENTS_SITE_LABEL,
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
        void qc.invalidateQueries({ queryKey: SCN_DOCUMENTS_KEY(folderId) });
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
