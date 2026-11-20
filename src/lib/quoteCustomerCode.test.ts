import { describe, expect, it } from "vitest";
import type { QuoteCustomer } from "@/types/quote";
import {
  customerCodeCandidates,
  customerCodeProblem,
  findSimilarCustomers,
  normaliseCustomerName,
  proposeCustomerCode,
} from "./quoteCustomerCode";

function customer(id: number, name: string, code = "XXX"): QuoteCustomer {
  return { id, name, code, customerNumber: "", active: true, note: "" };
}

describe("normaliseCustomerName", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normaliseCustomerName("  Cooper   Machinery,  Services ")).toBe("cooper machinery services");
    expect(normaliseCustomerName("Cooper-Bessemer/Ajax")).toBe("cooper bessemer ajax");
    expect(normaliseCustomerName("O'Brien Compression")).toBe("obrien compression");
  });

  it("drops a leading 'the' and trailing company suffixes", () => {
    expect(normaliseCustomerName("The Cooper Machinery Co., Inc.")).toBe("cooper machinery");
    expect(normaliseCustomerName("Acme LLC")).toBe("acme");
    expect(normaliseCustomerName("Hoerbiger GmbH")).toBe("hoerbiger");
    expect(normaliseCustomerName("Widget Corporation")).toBe("widget");
    expect(normaliseCustomerName("Widget Incorporated")).toBe("widget");
    expect(normaliseCustomerName("Widget Ltd.")).toBe("widget");
    expect(normaliseCustomerName("Widget Corp")).toBe("widget");
    expect(normaliseCustomerName("Widget Company")).toBe("widget");
  });

  it("keeps a suffix or 'the' that is the whole name, and keeps one mid-name", () => {
    expect(normaliseCustomerName("The")).toBe("the");
    expect(normaliseCustomerName("Inc")).toBe("inc");
    expect(normaliseCustomerName("Co Op Supply")).toBe("co op supply");
    expect(normaliseCustomerName("")).toBe("");
  });
});

describe("proposeCustomerCode", () => {
  it("takes three letters of the first significant word", () => {
    expect(proposeCustomerCode("Cooper Machinery Services")).toBe("COO");
    expect(proposeCustomerCode("The Williams Companies, Inc.")).toBe("WIL");
  });

  it("continues into the next word when the first is short", () => {
    expect(proposeCustomerCode("GE Power")).toBe("GEP");
    expect(proposeCustomerCode("A B Compression")).toBe("ABC");
  });

  it("uses letters only", () => {
    expect(proposeCustomerCode("3M Company")).toBe("CUS"); // "m" alone isn't enough
    expect(proposeCustomerCode("A1B2 Inc")).toBe("AB");
  });

  it("falls back to CUS when nothing usable is left", () => {
    expect(proposeCustomerCode("")).toBe("CUS");
    expect(proposeCustomerCode("!!!")).toBe("CUS");
    expect(proposeCustomerCode("123")).toBe("CUS");
  });
});

describe("customerCodeCandidates", () => {
  it("offers later letters of the word first", () => {
    expect(customerCodeCandidates("Cooper", ["COO"])).toEqual(["COP", "COE", "COR"]);
  });

  it("never offers a taken code (case-insensitive) or the proposal itself", () => {
    const out = customerCodeCandidates("Cooper", ["coo", "cop", " COE "]);
    expect(out).toEqual(["COR", "CPE", "CPR"]);
    expect(customerCodeCandidates("Coop", ["COO", "COP"], 2)).toEqual(["COO2", "COO3"]);
    // The proposal is excluded even when it's free.
    expect(customerCodeCandidates("Cooper", [])).not.toContain("COO");
  });

  it("uses the second word's initial once the first word's letters run out", () => {
    // "Abe": A+B+E is the proposal, so step 1 has nothing left.
    expect(customerCodeCandidates("Abe Machinery", ["ABE"], 2)).toEqual(["ABM", "ABE2"]);
  });

  it("falls back to a number", () => {
    expect(customerCodeCandidates("", ["CUS", "CUS2"], 2)).toEqual(["CUS3", "CUS4"]);
  });

  it("honours count and is deterministic", () => {
    expect(customerCodeCandidates("Cooper Machinery", [], 5)).toEqual(
      customerCodeCandidates("Cooper Machinery", [], 5),
    );
    expect(customerCodeCandidates("Cooper Machinery", [], 5)).toHaveLength(5);
    expect(customerCodeCandidates("Cooper", [], 1)).toEqual(["COP"]);
  });

  it("returns only valid 2–5 character codes", () => {
    for (const code of customerCodeCandidates("GE Power", ["GEP"], 10)) {
      expect(code).toMatch(/^[A-Z0-9]{2,5}$/);
    }
  });
});

describe("customerCodeProblem", () => {
  it("accepts a valid free code, uppercasing it first", () => {
    expect(customerCodeProblem("coo", [])).toBeNull();
    expect(customerCodeProblem("AB12", ["COO"])).toBeNull();
  });

  it("refuses an empty, short, long or non-alphanumeric code, and says it's uppercased", () => {
    expect(customerCodeProblem("  ", [])).toBe("Enter a customer code.");
    for (const bad of ["A", "ABCDEF", "CO-O", "C O"]) {
      expect(customerCodeProblem(bad, [])).toMatch(/2–5 letters or digits.*upper case/);
    }
  });

  it("refuses a taken code case-insensitively", () => {
    expect(customerCodeProblem("coo", ["COO"])).toBe("COO is already used by another customer.");
    expect(customerCodeProblem("COO", ["coo"])).toBe("COO is already used by another customer.");
  });

  it("lets a customer keep its own code when editing", () => {
    expect(customerCodeProblem("COO", ["COO", "ABC"], "coo")).toBeNull();
    expect(customerCodeProblem("ABC", ["COO", "ABC"], "COO")).toMatch(/already used/);
  });
});

describe("findSimilarCustomers", () => {
  const list = [
    customer(1, "Cooper Machinery Inc."),
    customer(2, "Cooperative Energy"),
    customer(3, "GE"),
    customer(4, "Williams"),
    customer(5, "The Williams Companies"),
  ];

  it("catches the same company spelled with a suffix", () => {
    expect(findSimilarCustomers("Cooper Machinery", list).map((c) => c.id)).toEqual([1]);
    expect(findSimilarCustomers("cooper machinery, LLC", list).map((c) => c.id)).toEqual([1]);
  });

  it("catches one name containing the other as whole words", () => {
    expect(findSimilarCustomers("Cooper Machinery Services", list).map((c) => c.id)).toEqual([1]);
    expect(findSimilarCustomers("Williams Companies", list).map((c) => c.id)).toEqual([4, 5]);
  });

  it("doesn't match a short name inside a longer one, or a word fragment", () => {
    expect(findSimilarCustomers("GE Power", list)).toEqual([]);
    // "cooper" is a whole word of #1, but only a fragment of "Cooperative".
    expect(findSimilarCustomers("Cooper", list).map((c) => c.id)).toEqual([1]);
  });

  it("excludes the customer being edited", () => {
    expect(findSimilarCustomers("Cooper Machinery", list, 1)).toEqual([]);
  });

  it("returns nothing for an empty name", () => {
    expect(findSimilarCustomers("  ", list)).toEqual([]);
  });

  it("still matches an exact short name", () => {
    expect(findSimilarCustomers("G.E.", list).map((c) => c.id)).toEqual([]);
    expect(findSimilarCustomers("ge", list).map((c) => c.id)).toEqual([3]);
  });
});
