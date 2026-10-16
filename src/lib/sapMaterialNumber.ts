/**
 * SAP stores material numbers zero-padded to a fixed width
 * ("000000000001234"), and nobody at Altronic says, types or prints the
 * padding — so a value coming out of Fabric has to be normalised before it
 * can be matched against, or shown beside, anything a person entered.
 *
 * Deliberately tolerant of null: a GraphQL field is nullable unless the
 * schema says otherwise, and a bare `row.MATNR_OLD.replace(...)` throws the
 * moment one row has no value — taking the whole batch with it.
 */
export function stripSapPadding(value: string | null | undefined): string {
  if (value == null) return "";
  // The lookahead keeps the last character, so an all-zeros value stays "0"
  // rather than collapsing to an empty string.
  return value.replace(/^0+(?=.)/, "");
}
