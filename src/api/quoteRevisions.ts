import type { Comment } from "@/types/task";
import type { Quote, QuoteAssembly } from "@/types/quote";
import { serializeComments } from "@/lib/communicationParser";
import { formatQuoteNumber, nextRevFor, parseQuoteNumber } from "@/lib/quoteNumber";
import { copyAttachments } from "./attachments";
import { createQuoteWithNumbering, getQuote, setQuoteLinks } from "./quotes";
import { createQuoteAssembly, listQuoteAssemblies } from "./quoteAssemblies";
import { createQuoteItem, listQuoteItems } from "./quoteItems";

// =============================================================================
// New rev — copy a quote forward as the next `R#` (design section 8).
//
// The old rev is never touched: a rev is what was SENT, so the new one gets
// its own header, its own assemblies and its own components, as new rows.
//
// ORDER, and why it is best-effort after step 1:
//
//   1. The header — same base, rev = highest rev of that base + 1, status
//      Draft, comments carried. If THIS fails the whole call throws: there is
//      nothing to point anything else at. A unique-value refusal on Title (two
//      people making R2 at once) re-reads and renumbers once, like a create.
//   2. The Phase-2 task links, in their OWN PATCH (Hyperlink columns 400 at
//      create).
//   3. Each assembly, pointing at the new header.
//   4. Each component, pointing at the new header AND the new copy of its
//      assembly (old id → new id). A component whose assembly failed to copy
//      is skipped and named, never re-parented to something else.
//   5. Attachments, header and each component (`copyAttachments`).
//
// From step 2 on, a failure is COLLECTED into `warnings`, naming what didn't
// come across, and the call still resolves — the new rev is real by then, and
// making it look failed is how somebody creates R3 to "retry". Never throws
// after the header exists.
//
// CARRIED COMMENTS keep their ORIGINAL author and timestamp, are stored
// OLDEST-first (the parser hands them back newest-first), and are tagged
// "carried over from R{n}" — the EIR promotion rule.
// =============================================================================

/** The Communication value for a new rev: `comments` oldest-first, each tagged with the rev it came from. */
export function carriedQuoteCommunication(comments: readonly Comment[], fromRev: number): string {
  if (comments.length === 0) return "";
  const tag = `<p><em>— carried over from R${fromRev}</em></p>`;
  return serializeComments(
    [...comments]
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map((c) => ({
        timestamp: c.timestamp,
        authorName: c.authorName,
        authorEmail: c.authorEmail,
        // Don't stack a second tag on a comment already carried from an earlier rev.
        bodyHtml: /— carried over from R\d+/.test(c.bodyHtml) ? c.bodyHtml : `${c.bodyHtml}${tag}`,
      })),
  );
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function assemblyLabel(a: QuoteAssembly): string {
  return a.altronicPartNumber || `line ${a.lineNo}`;
}

export async function createQuoteRevision(quoteId: number): Promise<{ quote: Quote; warnings: string[] }> {
  const source = await getQuote(quoteId);
  if (!source) throw new Error(`Quote ${quoteId} not found`);
  const warnings: string[] = [];

  // 1. The header. Throws on failure — nothing exists yet.
  const created = await createQuoteWithNumbering(
    (titles) => {
      const revs = titles
        .map(parseQuoteNumber)
        .filter((p): p is NonNullable<typeof p> => !!p && p.rev !== null)
        .map((p) => ({ quoteBase: p.base, rev: p.rev as number }));
      const rev = nextRevFor(source.quoteBase, [...revs, { quoteBase: source.quoteBase, rev: source.rev }]);
      return { quoteBase: source.quoteBase, rev, quoteNumber: formatQuoteNumber(source.quoteBase, rev) };
    },
    {
      customerId: source.customerId,
      status: "Draft",
      validityDays: source.validityDays,
      contactName: source.contactName,
      contactEmail: source.contactEmail,
      budgetary: source.budgetary,
      budgetaryText: source.budgetaryText,
      quoteNotes: source.quoteNotes,
      engineeringProjectRef: source.engineeringProjectRef,
      watchers: source.watchers,
      communication: carriedQuoteCommunication(source.comments, source.rev),
    },
  );
  const newRev = `R${created.rev}`;

  // 2. The Phase-2 links — their own PATCH.
  if (source.engineeringTaskLink || source.operationsTaskLink) {
    try {
      await setQuoteLinks(created.id, {
        ...(source.engineeringTaskLink && { engineeringTaskLink: source.engineeringTaskLink }),
        ...(source.operationsTaskLink && { operationsTaskLink: source.operationsTaskLink }),
      });
    } catch (err) {
      warnings.push(`The task links weren't copied to ${newRev}: ${errText(err)}`);
    }
  }

  // 3. Assemblies.
  const assemblyMap = new Map<number, number>();
  let sourceAssemblies: QuoteAssembly[] = [];
  try {
    sourceAssemblies = (await listQuoteAssemblies()).filter((a) => a.quoteId === source.id);
  } catch (err) {
    warnings.push(`Couldn't read the assemblies to copy to ${newRev}: ${errText(err)}`);
  }
  for (const a of sourceAssemblies) {
    try {
      const copy = await createQuoteAssembly({
        quoteId: created.id,
        lineNo: a.lineNo,
        quotedQty: a.quotedQty,
        lineType: a.lineType,
        cost: a.cost,
        materialOverheadPct: a.materialOverheadPct,
        altronicPartNumber: a.altronicPartNumber,
        sapPartNumber: a.sapPartNumber,
        customerPartNumber: a.customerPartNumber,
        description: a.description,
        priceBreaks: a.priceBreaks,
        targetGM: a.targetGM,
        manualPrice: a.manualPrice,
        customerPrice: a.customerPrice,
      });
      assemblyMap.set(a.id, copy.id);
    } catch (err) {
      warnings.push(`Assembly ${assemblyLabel(a)} wasn't copied to ${newRev}: ${errText(err)}`);
    }
  }

  // 4. Components, re-pointed at the new header and the new assembly copies.
  const copiedItems: { from: number; to: number; label: string }[] = [];
  if (sourceAssemblies.length > 0) {
    let sourceItems: Awaited<ReturnType<typeof listQuoteItems>> = [];
    try {
      sourceItems = (await listQuoteItems()).filter((i) => i.quoteId === source.id);
    } catch (err) {
      warnings.push(`Couldn't read the components to copy to ${newRev}: ${errText(err)}`);
    }
    for (const i of sourceItems) {
      const label = i.altronicPartNumber || `line ${i.lineNo}`;
      const assemblyId = i.assemblyId === null ? undefined : assemblyMap.get(i.assemblyId);
      if (assemblyId === undefined) {
        warnings.push(`Component ${label} wasn't copied to ${newRev}: its assembly didn't come across.`);
        continue;
      }
      try {
        const copy = await createQuoteItem({
          quoteId: created.id,
          assemblyId,
          lineNo: i.lineNo,
          altronicPartNumber: i.altronicPartNumber,
          sapPartNumber: i.sapPartNumber,
          description: i.description,
          quantity: i.quantity,
          cost: i.cost,
          materialOverheadPct: i.materialOverheadPct,
          watchers: i.watchers,
          communication: carriedQuoteCommunication(i.comments, source.rev),
        });
        copiedItems.push({ from: i.id, to: copy.id, label });
      } catch (err) {
        warnings.push(`Component ${label} wasn't copied to ${newRev}: ${errText(err)}`);
      }
    }
  }

  // 5. Attachments — the header's data package, then each component's files.
  const copyFiles = async (what: string, run: () => ReturnType<typeof copyAttachments>) => {
    try {
      const { failed } = await run();
      if (failed.length > 0) warnings.push(`${what}: ${failed.join(", ")} didn't copy to ${newRev}.`);
    } catch (err) {
      warnings.push(`${what}: attachments couldn't be copied to ${newRev} (${errText(err)}).`);
    }
  };
  await copyFiles("Quote attachments", () => copyAttachments("quote", source.id, "quote", created.id));
  for (const c of copiedItems) {
    await copyFiles(`Component ${c.label}`, () => copyAttachments("quoteItem", c.from, "quoteItem", c.to));
  }

  // The header as it now stands (links, attachments). A failed re-read is not
  // a failed rev — hand back what the create returned.
  let quote = created;
  try {
    quote = (await getQuote(created.id)) ?? created;
  } catch {
    // keep `created`
  }
  return { quote, warnings };
}
