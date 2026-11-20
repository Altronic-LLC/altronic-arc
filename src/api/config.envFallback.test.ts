import { afterEach, describe, expect, it, vi } from "vitest";

// deploy.yml passes every VITE_* var it names, set or not, so an unset repo
// variable reaches the build as "" — not undefined. A `??` default keeps the
// "", which is how Report issue ended up sending to a blank address.
describe("env defaults survive a blank repo variable", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("falls back when the variable arrives as an empty string", async () => {
    vi.stubEnv("VITE_APP_MANAGER_EMAIL", "");
    vi.stubEnv("VITE_SP_SCN_SITE_URL", "");
    vi.stubEnv("VITE_SP_SALES_DOCUMENTATION_SITE_URL", "");
    vi.resetModules();
    const config = await import("./config");
    expect(config.APP_MANAGER_EMAIL).toBe("ray.white@altronic-llc.com");
    expect(config.SP_SCN_SITE_URL).toMatch(/\/sites\/ALTRONICSALESTEAM\/SCN$/);
    expect(config.SP_SALES_DOCUMENTATION_SITE_URL).toMatch(/\/AltronicDocumentation$/);
  });

  it("still uses a variable that is set", async () => {
    vi.stubEnv("VITE_APP_MANAGER_EMAIL", "someone@example.com");
    vi.resetModules();
    const config = await import("./config");
    expect(config.APP_MANAGER_EMAIL).toBe("someone@example.com");
  });
});
