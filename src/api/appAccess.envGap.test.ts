import { describe, expect, it } from "vitest";
import { APPS } from "./appAccess";

// =============================================================================
// The app registry must not go EMPTY just because an env var is unset.
//
// v0.165.0's deploy failed on two tests that asked the live registry for
// Engineering Tasks' list id and got nothing: `SP_LIST_ID` has no default in
// config.ts, so with no .env.local — CI, and any fresh clone — `ids()`
// filters it out and the entry carries `lists: []`. The tests asserted
// against an empty array, passed on a configured machine, and failed the
// deploy.
//
// This is the guard for the general case: a test (or a feature) that reads
// the registry should not silently see nothing. It does NOT require every id
// to be configured — most are genuinely optional, and several lists are
// deliberately left unset so a feature stays off until someone decides to
// turn it on. It just makes the shape of that gap visible and asserted,
// rather than something a future test trips over the same way.
// =============================================================================

describe("app registry vs. unset env vars", () => {
  it("registers every app with a label, a path and a site", () => {
    for (const app of APPS) {
      expect(app.label, `${app.path} has no label`).toBeTruthy();
      expect(app.path.startsWith("/"), `${app.label} path is not absolute`).toBe(true);
      expect(app.site, `${app.label} has no site`).toBeTruthy();
    }
  });

  it("gives an app with no configured list id an EMPTY list, never undefined", () => {
    // `ids()` filters unset values out, so the array is always real — code
    // reading `app.lists.length` can rely on it without a null check.
    for (const app of APPS) {
      expect(Array.isArray(app.lists), `${app.label}.lists is not an array`).toBe(true);
      for (const id of app.lists) {
        expect(typeof id, `${app.label} has a non-string list id`).toBe("string");
        expect(id.length, `${app.label} has an empty list id`).toBeGreaterThan(0);
      }
    }
  });

  it("does not let an app be registered at one path twice", () => {
    const paths = APPS.map((a) => a.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("keeps Engineering Tasks registered at its three routes", () => {
    // The de-dupe cases in appAccess.test.ts / accessProbe.test.ts depend on
    // ONE app appearing at several routes. If that ever stops being true,
    // those tests quietly stop testing anything — so it is asserted here
    // rather than assumed there.
    const routes = APPS.filter((a) => a.label === "Engineering Tasks").map((a) => a.path);
    expect(routes.sort()).toEqual(["/kanban", "/list", "/task"]);
  });
});
