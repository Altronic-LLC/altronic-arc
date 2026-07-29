import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BadgeCheck, Lock, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
import {
  useCsaListings,
  useDeleteCsaListing,
} from "@/hooks/useCsaListings";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SearchInput } from "@/components/SearchInput";
import { CsaListingFormModal } from "@/components/CsaListingFormModal";
import { csaListingLabel, csaListingMatches } from "@/lib/csaListingMapper";
import { formatSpDate } from "@/lib/spDates";
import type { CsaListing } from "@/types/task";
import { cn } from "@/lib/cn";

// =============================================================================
// CSA Listings — Engineering's CSA product-certification register.
//
// A table rather than a detail page: a listing is a handful of fields you scan,
// search and occasionally amend. The long fields (Also Cover, Part No Included,
// History) are searchable but clamped in the table — a part number someone is
// chasing is far more likely to be buried in "Part No Included" than in the file
// number, so search has to reach them even though the column can't show them in
// full.
//
// Adding, editing and deleting are admin-only: these are compliance records.
// Everyone signed in can read and search. UI-level gating as always; SharePoint
// list permissions are the real boundary.
// =============================================================================

export function CsaListingsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: listings = [], isLoading, error } = useCsaListings();
  const deleteListing = useDeleteCsaListing();
  const { isAdmin, isResolving: adminResolving } = useAdminAccess();

  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<CsaListing | null>(null);

  const query = searchParams.get("q") ?? "";
  const setQuery = (q: string) => {
    const sp = new URLSearchParams(searchParams);
    if (q) sp.set("q", q);
    else sp.delete("q");
    setSearchParams(sp, { replace: true });
  };

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return listings.filter((l) => csaListingMatches(l, tokens));
  }, [listings, query]);

  async function handleDelete(listing: CsaListing) {
    // The button isn't rendered for non-admins; this is the backstop.
    if (!isAdmin) return;
    const ok = window.confirm(
      `Delete this CSA listing?\n\n${csaListingLabel(listing)}\n\nThis removes it from SharePoint, along with any attached certificates, and can't be undone.`,
    );
    if (!ok) return;
    await deleteListing.mutateAsync(listing.id);
  }

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <BadgeCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">CSA Listings</h1>
          <p className="text-xs text-fg-muted">
            Altronic's CSA certification files — which products and part numbers each file covers,
            when it was certified, and the certificates themselves.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New listing</span>
            <span className="sm:hidden">New</span>
          </button>
        )}
      </header>

      <div className="max-w-xl">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Search
          </span>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="File number, product, part number… add words to narrow"
            className="select"
          />
        </label>
      </div>

      {error != null && (
        <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs">
          <div className="mb-1 font-semibold text-cooper-red">
            Couldn't load CSA Listings from SharePoint
          </div>
          <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11px] text-fg">
            {(error as Error)?.message ?? "Unknown error"}
          </pre>
        </div>
      )}

      {isLoading ? (
        <LoadingTasks noun="CSA listings" />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
          {listings.length === 0
            ? "No CSA listings yet."
            : "No listings match that search."}
        </div>
      ) : (
        <>
          <div className="text-xs text-fg-muted">
            Showing {filtered.length} of {listings.length}{" "}
            {listings.length === 1 ? "listing" : "listings"}
          </div>

          {/* Wide table scrolls in its own container so the page never scrolls
              sideways on a phone. */}
          <div className="scroll-elegant overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1000px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left">
                  <Th>File Number</Th>
                  <Th>Product</Th>
                  <Th>Also Cover</Th>
                  <Th>Part No Included</Th>
                  <Th>Certified</Th>
                  <Th className="text-center">Files</Th>
                  {isAdmin && <Th className="text-right">Actions</Th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr
                    key={l.id}
                    className="group border-b border-border last:border-0 hover:bg-surface-2/60"
                  >
                    <Td className="whitespace-nowrap font-medium text-fg">
                      {l.fileNumber || "—"}
                      {l.csaId !== null && (
                        <span className="ml-2 font-mono text-[10px] text-fg-muted">
                          #{l.csaId}
                        </span>
                      )}
                    </Td>
                    <Td>{l.product || "—"}</Td>
                    <Td className="max-w-[16rem] text-fg-muted">
                      <Clamped text={l.alsoCover} />
                    </Td>
                    <Td className="max-w-[16rem] text-fg-muted">
                      <Clamped text={l.partNoIncluded} />
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums text-fg-muted">
                      {formatSpDate(l.dateCertified)}
                    </Td>
                    <Td className="text-center">
                      {l.hasAttachments ? (
                        <Paperclip
                          className="mx-auto h-3.5 w-3.5 text-fg-muted"
                          aria-label="Has attachments"
                        />
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </Td>
                    {isAdmin && (
                      <Td className="whitespace-nowrap text-right">
                        <button
                          onClick={() => setEditing(l)}
                          className="rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100"
                          aria-label={`Edit ${csaListingLabel(l)}`}
                          title="Edit listing"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(l)}
                          className="rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-cooper-red focus:opacity-100 group-hover:opacity-100"
                          aria-label={`Delete ${csaListingLabel(l)}`}
                          title="Delete listing"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!isAdmin && !adminResolving && (
            <p className="flex items-start gap-1.5 text-[11px] text-fg-muted">
              <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                CSA listings are certification records, so adding and changing them is limited to
                admins. Search and read are open to everyone — ask an admin if something needs
                updating.
              </span>
            </p>
          )}
        </>
      )}

      {showNew && <CsaListingFormModal onClose={() => setShowNew(false)} />}
      {editing && (
        <CsaListingFormModal listing={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/**
 * A multi-line field squeezed into a table cell: first line shown, the rest
 * available on hover. Better than truncating mid-value — these fields are lists
 * of part numbers, so the first line is meaningful on its own and the full text
 * is one hover away.
 */
function Clamped({ text }: { text: string }) {
  if (!text.trim()) return <span>—</span>;
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const [first, ...rest] = lines;
  return (
    <span className="block" title={text}>
      <span className="block truncate">{first}</span>
      {rest.length > 0 && (
        <span className="text-[11px] text-fg-muted">
          +{rest.length} more
        </span>
      )}
    </span>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 align-top text-fg", className)}>{children}</td>;
}
