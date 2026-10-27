// =============================================================================
// Putting a string into an OData `$filter`.
//
// Two things have to happen, in this order, and `encodeURIComponent` alone
// does only the second: OData string literals are single-quoted and escape an
// embedded quote by DOUBLING it (`O''Brien`), and `encodeURIComponent` leaves
// `'` untouched — so a value with a quote in it used to end the literal early
// and let whatever followed be read as filter syntax (CWE-943). The two Parts
// List lookups did this by hand; everything else did only the encoding. One
// helper, so the next `$filter` can't get it half right.
//
// Only for string literals. Numbers (`eq 42`) and lookup ids go in bare.
// =============================================================================

/** `'value'` — quoted, quote-doubled, then percent-encoded for a Graph URL. */
export function odataString(value: string): string {
  return `'${encodeURIComponent(value.replace(/'/g, "''"))}'`;
}

/**
 * Encode a WHOLE filter expression for the query string without mangling
 * OData literal syntax.
 *
 * `encodeURIComponent` would turn the colons in a bare datetime into `%3A`,
 * which some OData parsers reject. Only spaces and `#` actually need escaping
 * here; `'`, `:` and `-` are all legal in a query value. (Moved here from
 * api/teradyneLog.ts, which re-exports it.)
 */
export function encodeFilter(filter: string): string {
  return filter.replace(/ /g, "%20").replace(/#/g, "%23");
}
