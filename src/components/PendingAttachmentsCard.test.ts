import { describe, expect, it } from "vitest";
import { withUniqueNames } from "./PendingAttachmentsCard";

const names = (files: File[]) => files.map((f) => f.name);

describe("withUniqueNames", () => {
  it("leaves new names alone, and passes the same File object through", () => {
    const f = new File(["x"], "a.pdf");
    const out = withUniqueNames([], [f]);
    expect(out[0]).toBe(f);
  });

  it("numbers a clash with what's already staged, case-insensitively", () => {
    const out = withUniqueNames([new File(["x"], "IMAGE.jpg")], [new File(["y"], "image.jpg")]);
    expect(names(out)).toEqual(["image (2).jpg"]);
  });

  it("numbers clashes WITHIN one batch, and skips numbers already taken", () => {
    const staged = [new File(["x"], "photo.jpg"), new File(["x"], "photo (2).jpg")];
    const added = [new File(["a"], "photo.jpg"), new File(["b"], "photo.jpg")];
    expect(names(withUniqueNames(staged, added))).toEqual(["photo (3).jpg", "photo (4).jpg"]);
  });

  it("handles a name with no extension, and keeps the type", () => {
    const out = withUniqueNames(
      [new File(["x"], "README")],
      [new File(["y"], "README", { type: "text/plain" })],
    );
    expect(names(out)).toEqual(["README (2)"]);
    expect(out[0].type).toBe("text/plain");
  });
});
