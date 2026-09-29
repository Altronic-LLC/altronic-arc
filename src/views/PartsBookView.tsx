import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Cpu, Globe, ListTree, Search } from "lucide-react";
import { useAltronicComponents, useAltronicParts } from "@/hooks/useAltronicParts";
import { PartKindChip, PartsDataGate } from "@/components/partsAtoms";
import { buildPartsBooks, parsePartsQuery, partPath } from "@/lib/partSearch";
import { COMPONENT_PREFIX_CATEGORY } from "@/lib/altronicPartMapper";
import { PARTS_BOOKS, type AltronicComponent, type AltronicPart } from "@/types/task";
import { NewPartButton } from "@/components/PartFormModal";
import { useMyPartsAccess } from "@/hooks/usePartsRoles";
import { manageDescriptionOptionsGate, partsRightsFor } from "@/lib/partsRoles";
import { cn } from "@/lib/cn";

// =============================================================================
// Altronic Parts List — the landing page. Replaces the Power App's home screen
// (Thomas Terhune's 2023 user guide): the 100–900 Parts Book tiles, a box that
// takes a parts list number, and Global Search.
//
// The box takes more than the old one did — a whole part number jumps straight
// to the part, a single digit opens that book, and anything else runs a Global
// Search for it — so typing into it is never a dead end. See parsePartsQuery.
//
// The nine book tiles render IMMEDIATELY, before either list has loaded: the
// Part List is ~14,000 rows and takes a few seconds, and a blank page for that
// long reads as broken. Only the counts and the lists inside a book wait.
// =============================================================================

/**
 * "N parts are waiting for you" — for whoever approves a step, so a review
 * isn't only reachable by digging the email back out. Links to a plain Global
 * Search on the sign-off field, which anyone can also type.
 */
function AwaitingApproval({
  parts,
  components,
}: {
  parts: AltronicPart[] | undefined;
  components: AltronicComponent[] | undefined;
}) {
  const access = useMyPartsAccess();
  if (!access.configured || access.resolving || !parts || !components) return null;
  const rights = partsRightsFor(access.roles);
  const engineering = rights.approveEngineering
    ? components.filter((c) => c.signOffStatus === "Pending Engineering Review").length
    : 0;
  const sap = rights.approveSap
    ? [...parts, ...components].filter((p) => p.signOffStatus === "Pending SAP").length
    : 0;
  if (engineering + sap === 0) return null;
  const status = engineering && sap ? "Pending" : engineering ? "Pending Engineering Review" : "Pending SAP";
  const pieces = [
    engineering ? `${engineering} waiting for engineering review` : "",
    sap ? `${sap} waiting to be added to SAP` : "",
  ].filter(Boolean);
  return (
    <Link
      to={`/engineering/parts/search?f.signOffStatus=${encodeURIComponent(status)}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-ajax-yellow/50 bg-ajax-yellow/10 px-4 py-3 text-sm text-fg hover:bg-ajax-yellow/20"
    >
      <span>
        <strong>Waiting for you:</strong> {pieces.join(" and ")}.
      </span>
      <span className="shrink-0 text-xs font-medium text-accent">Open →</span>
    </Link>
  );
}

/**
 * The way to the description lists, for the people who manage them (the SAP
 * admin and the reviewing engineers). Hidden from everyone else, like New
 * part — the page itself is still readable by anyone with the link, which the
 * New part form gives.
 */
function DescriptionListsLink() {
  const gate = manageDescriptionOptionsGate(useMyPartsAccess());
  if (!gate.allowed) return null;
  return (
    <Link
      to="/engineering/parts/descriptions"
      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg shadow-sm transition-colors hover:bg-surface-2"
    >
      <ListTree className="h-4 w-4" />
      Descriptions
    </Link>
  );
}

export function PartsBookView() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const partsQuery = useAltronicParts();
  const componentsQuery = useAltronicComponents();
  const [input, setInput] = useState("");
  const [notFound, setNotFound] = useState<string | null>(null);

  const selectedBook = Number(params.get("book")) || null;

  const books = useMemo(() => {
    if (!partsQuery.data || !componentsQuery.data) return null;
    return buildPartsBooks([
      ...partsQuery.data.map((p) => p.partNumber),
      ...componentsQuery.data.map((c) => c.partNumber),
    ]);
  }, [partsQuery.data, componentsQuery.data]);

  function selectBook(book: number | null) {
    const next = new URLSearchParams(params);
    if (book) next.set("book", String(book));
    else next.delete("book");
    setParams(next, { replace: true });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setNotFound(null);
    const target = parsePartsQuery(input);
    if (!target) return;
    if (target.kind === "book") return selectBook(target.book);
    if (target.kind === "list") return navigate(`/engineering/parts/list/${target.prefix}`);
    if (target.kind === "search") {
      return navigate(`/engineering/parts/search?q=${encodeURIComponent(target.query)}`);
    }
    // A whole part number. Exact match on either list goes straight to it;
    // otherwise search for it, which also catches a typo one digit off.
    const wanted = target.partNumber.toLowerCase();
    const part = partsQuery.data?.find((p) => p.partNumber.toLowerCase() === wanted);
    if (part) return navigate(partPath("part", part.id));
    const component = componentsQuery.data?.find((c) => c.partNumber.toLowerCase() === wanted);
    if (component) return navigate(partPath("component", component.id));
    if (!partsQuery.data || !componentsQuery.data) {
      setNotFound("The parts list is still loading — try again in a moment.");
      return;
    }
    navigate(`/engineering/parts/search?f.partNumber=${encodeURIComponent(target.partNumber)}`);
  }

  const bookSummary = selectedBook && books ? books.find((b) => b.book === selectedBook) : undefined;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
            <Cpu className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Altronic Parts List</h1>
            <p className="text-sm text-fg-muted">
              Every Altronic part number — pick a Parts Book, type a list or part number, or search
              everything.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            to="/engineering/parts/search"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg shadow-sm transition-colors hover:bg-surface-2"
          >
            <Globe className="h-4 w-4" />
            Global Search
          </Link>
          <DescriptionListsLink />
          <NewPartButton prefix={null} />
        </div>
      </header>

      <AwaitingApproval parts={partsQuery.data} components={componentsQuery.data} />

      <form onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-1.5" role="search">
        <label htmlFor="parts-jump" className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Parts list or part number
        </label>
        <div className="flex gap-2">
          <input
            id="parts-jump"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="601, 601110, or a description…"
            className="h-10 w-full rounded-md border border-border bg-surface px-3 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
            inputMode="search"
            autoComplete="off"
          />
          <button
            type="submit"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-white shadow-sm hover:bg-accent/90"
          >
            <Search className="h-4 w-4" />
            Go
          </button>
        </div>
        {notFound && <p className="text-xs text-fg-muted">{notFound}</p>}
      </form>

      <section aria-label="Parts books">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Parts Books</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {PARTS_BOOKS.map((book) => {
            const summary = books?.find((b) => b.book === book);
            const empty = books !== null && !summary;
            return (
              <button
                key={book}
                type="button"
                onClick={() => selectBook(selectedBook === book ? null : book)}
                disabled={empty}
                aria-pressed={selectedBook === book}
                className={cn(
                  "flex flex-col items-center justify-center rounded-lg border px-2 py-3 text-center transition-colors",
                  selectedBook === book
                    ? "border-accent bg-accent/10 text-fg"
                    : "border-border bg-surface text-fg hover:bg-surface-2",
                  empty && "cursor-not-allowed opacity-50 hover:bg-surface",
                )}
              >
                <span className="font-display text-lg font-semibold tabular-nums">{book}00</span>
                <span className="text-[11px] text-fg-muted">Parts Book</span>
                <span className="mt-0.5 text-[11px] tabular-nums text-fg-muted">
                  {books === null ? "…" : summary ? `${summary.count.toLocaleString()} parts` : "no parts"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {selectedBook && (
        <section aria-label={`${selectedBook}00 Parts Book`}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
            {selectedBook}00 Parts Book — pick a list
          </h2>
          <PartsDataGate
            queries={[partsQuery, componentsQuery]}
            listNames="Altronic Part List and Altronic Component List"
            noun="parts books"
          >
            {bookSummary ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                {bookSummary.lists.map((list) => (
                  <Link
                    key={list.prefix}
                    to={`/engineering/parts/list/${list.prefix}`}
                    className="flex flex-col items-center gap-0.5 rounded-lg border border-border bg-surface px-2 py-2.5 text-center transition-colors hover:border-accent hover:bg-surface-2"
                  >
                    <span className="font-mono text-base font-semibold text-fg">{list.prefix}</span>
                    <span className="text-[11px] tabular-nums text-fg-muted">
                      {list.count.toLocaleString()} part{list.count === 1 ? "" : "s"}
                    </span>
                    {list.component && <PartKindChip label={COMPONENT_PREFIX_CATEGORY[list.prefix]} />}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-fg-muted">
                No parts in the {selectedBook}00 book yet.
              </p>
            )}
          </PartsDataGate>
        </section>
      )}
    </div>
  );
}
