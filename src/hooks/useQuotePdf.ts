import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listQuotePdfs, saveQuotePdf, type QuotePdfFile, type SavedQuotePdf } from "@/api/quotePdfFiles";
import type { Quote, QuoteAssembly, QuoteCustomer, QuoteItem } from "@/types/quote";
import { buildQuotePdfModel } from "@/lib/quotePdfModel";
import { generateQuotePdf, quotePdfFileName } from "@/lib/quotePdf";
import { generatePdfGate } from "@/lib/quoteRoles";
import { toIsoDate } from "@/lib/dateInput";
import { requireQuoteGate, useResolveQuoteAccess } from "./useQuoteRoles";
import { useCurrentUser } from "./useCurrentUser";

// =============================================================================
// The customer PDF.
//
// GENERATING saves nothing — it hands back a Blob to download or print.
// SAVING is the explicit second step (design §11): it writes into
// `General/IC Quotes`, and a name clash renames rather than overwrites.
// Both ask `generatePdfGate` inside the mutationFn.
// =============================================================================

export function quotePdfsKey(quoteBase: string) {
  return ["quote-pdfs", quoteBase.trim().toUpperCase()] as const;
}

/** The PDFs saved for a quote (every rev of its base), newest first. */
export function useQuotePdfs(quoteBase: string | null | undefined) {
  return useQuery<QuotePdfFile[]>({
    queryKey: quotePdfsKey(quoteBase ?? ""),
    queryFn: () => listQuotePdfs(quoteBase ?? ""),
    enabled: !!quoteBase,
    staleTime: 60_000,
  });
}

export interface GenerateQuotePdfInput {
  quote: Quote;
  customer: QuoteCustomer | null;
  assemblies: QuoteAssembly[];
  items: QuoteItem[];
}

/**
 * Build the PDF (dated today, local). Resolves `{ blob, fileName }`; refuses
 * with the problems listed. "Prepared by" is the SIGNED-IN user — their
 * display name and MAILBOX (`useCurrentUser().email`, never the sign-in
 * name; see CLAUDE.md "Matching a person to a stored address"), read through a
 * ref so the mutation uses whoever is signed in NOW, not a stale closure.
 */
export function useGenerateQuotePdf() {
  const resolve = useResolveQuoteAccess();
  const me = useCurrentUser();
  const meRef = useRef(me);
  meRef.current = me;
  return useMutation({
    mutationFn: async (input: GenerateQuotePdfInput): Promise<{ blob: Blob; fileName: string }> => {
      requireQuoteGate(generatePdfGate(await resolve()));
      const { displayName, email } = meRef.current;
      const { model, problems } = buildQuotePdfModel({
        ...input,
        issueDate: toIsoDate(new Date()),
        preparedBy: { name: displayName ?? "", email: email ?? "" },
      });
      if (!model) {
        throw new Error(`The quote can't be generated yet:\n${problems.map((p) => `• ${p}`).join("\n")}`);
      }
      const blob = await generateQuotePdf(model);
      return { blob, fileName: quotePdfFileName(model) };
    },
  });
}

/** Save a generated PDF to the IC Quotes folder. Resolves where it landed. */
export function useSaveQuotePdf() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async ({ blob, fileName }: { blob: Blob; fileName: string }): Promise<SavedQuotePdf> => {
      requireQuoteGate(generatePdfGate(await resolve()));
      return saveQuotePdf(blob, fileName);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quote-pdfs"] }),
  });
}

/**
 * Save a Blob through a temporary object URL. The URL is NOT revoked on the
 * same tick — some browsers start the save asynchronously, and revoking it
 * at once can cancel a download that had barely begun.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
