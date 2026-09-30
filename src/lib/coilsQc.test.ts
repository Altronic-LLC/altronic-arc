import { describe, expect, it } from "vitest";
import { parseOtherFaults, serializeOtherFaults } from "./coilsQc";

describe("OtherFaultTable JSON", () => {
  it("reads QCCoils' nested Defect.Value, Count, and Comment fields", () => {
    expect(
      parseOtherFaults('[{"Comment":"Tower scratched","Count":3,"Defect":{"Value":"Gap"}}]'),
    ).toEqual([
      { Defect: { Value: "Gap" }, Count: 3, Comment: "Tower scratched" },
    ]);
  });

  it("also reads a nested Defect returned as serialized JSON", () => {
    expect(parseOtherFaults('[{"Defect":"{\\"Value\\":\\"Tower leak\\"}","Count":1,"Comment":""}]'))
      .toEqual([{ Defect: { Value: "Tower leak" }, Count: 1, Comment: "" }]);
  });

  it("reads QCCoils defects returned as a collection of Value records", () => {
    expect(parseOtherFaults('[{"Defect":[{"Value":"Gap"}],"Count":3,"Comment":""}]'))
      .toEqual([{ Defect: { Value: "Gap" }, Count: 3, Comment: "" }]);
  });

  it("serializes Comment, Count, Defect in order, with Defect as a Value collection", () => {
    expect(
      serializeOtherFaults([
        { Defect: { Value: "Pusher" }, Count: 34, Comment: "" },
        { Defect: { Value: "Bad Board" }, Count: 1, Comment: "lifted pad" },
      ]),
    ).toBe(
      '[{"Comment":"","Count":34,"Defect":[{"Value":"Pusher"}]},{"Comment":"lifted pad","Count":1,"Defect":[{"Value":"Bad Board"}]}]',
    );
  });

  it("round-trips: what it writes, it reads back", () => {
    const rows = [{ Defect: { Value: "Gap" }, Count: 3, Comment: "Tower scratched" }];
    expect(parseOtherFaults(serializeOtherFaults(rows))).toEqual(rows);
  });

  it("writes nothing for an empty table", () => {
    expect(serializeOtherFaults([])).toBe("");
  });
});