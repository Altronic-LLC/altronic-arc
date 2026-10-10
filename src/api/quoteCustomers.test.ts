import { beforeEach, describe, expect, it } from "vitest";
import * as api from "./quoteCustomers";
import {
  QuoteCustomerCodeTakenError,
  createQuoteCustomer,
  listQuoteCustomers,
  updateQuoteCustomer,
} from "./quoteCustomers";
import { __resetQuoteMockStores } from "@/data/quoteMockData";

beforeEach(() => {
  __resetQuoteMockStores();
});

describe("quote customers API (mock mode)", () => {
  it("has no delete — customers are retired", () => {
    expect(Object.keys(api).filter((k) => /delete|remove/i.test(k))).toEqual([]);
  });

  it("lists by name, retired included", async () => {
    const rows = await listQuoteCustomers();
    expect(rows.map((c) => c.code)).toEqual(["COO", "HOE", "INN", "WAB"]);
    expect(rows.find((c) => c.code === "HOE")?.active).toBe(false);
  });

  it("creates with an upper-cased code; a taken code throws the typed error", async () => {
    const c = await createQuoteCustomer({ name: "Exterran", code: "ext", customerNumber: "0004", note: "" });
    expect(c).toMatchObject({ code: "EXT", active: true, customerNumber: "0004" });
    await expect(
      createQuoteCustomer({ name: "Cooper again", code: "coo", customerNumber: "", note: "" }),
    ).rejects.toBeInstanceOf(QuoteCustomerCodeTakenError);
  });

  it("updates (retires) without touching the code", async () => {
    const [first] = await listQuoteCustomers();
    const updated = await updateQuoteCustomer(first.id, { active: false, name: "Renamed" }, first);
    expect(updated).toMatchObject({ active: false, name: "Renamed", code: first.code });
    await expect(updateQuoteCustomer(999, {}, first)).rejects.toThrow(/not found/);
  });
});
