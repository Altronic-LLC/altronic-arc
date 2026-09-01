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

  it("serializes the typed table back to the QCCoils shape", () => {
    expect(serializeOtherFaults([{ Defect: { Value: "Gap" }, Count: 3, Comment: "" }]))
      .toBe('[{"Defect":{"Value":"Gap"},"Count":3,"Comment":""}]');
  });
});