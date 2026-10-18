import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type LifeOsConfig } from "../../src/core/config.js";
import { acquireDaemonOwnership } from "../../src/state/ownership.js";
import { closeDatabase } from "../../src/state/database.js";
import { GoogleTokenStore } from "../../src/google/token-store.js";
import { authAdd, authAlias, authRemove } from "../../src/cli/auth.js";

const homes: LifeOsConfig[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); for (const c of homes.splice(0)) closeDatabase(c); });
function setup() {
  const home = mkdtempSync(join(tmpdir(), "lifeos-auth-owner-"));
  vi.stubEnv("LIFE_OS_HOME", home);
  const config = loadConfig({ LIFE_OS_HOME: home, LIFE_OS_ACCESS_MODE: "daemon" });
  homes.push(config); return config;
}

describe("authoritative credential maintenance", () => {
  it("rejects add, alias, and remove before browser/network/file work while the daemon owns the VM", async () => {
    const config = setup();
    writeFileSync(join(config.home, ".vm-authoritative"), "");
    const release = acquireDaemonOwnership(config);
    try {
      await expect(authAdd({ noBrowser: true })).rejects.toThrow("Stop the owning");
      await expect(authAlias({ alias: "personal", account: "person@example.test" })).rejects.toThrow("Stop the owning");
      await expect(authRemove({ account: "person@example.test", revoke: true })).rejects.toThrow("Stop the owning");
    } finally { release(); }
  });

  it("preserves ordinary local auth without initializing a tracker database", async () => {
    const config = setup(), store = new GoogleTokenStore(config);
    store.saveTokenFile({ account: "person@example.test", refresh_token: "synthetic-test-token", scopes: [], client_id: "synthetic-test-client", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await authAlias({ alias: "personal", account: "person@example.test" });
    expect(store.aliases().personal).toBe("person@example.test");
    expect(existsSync(join(config.home, "life-os.sqlite"))).toBe(false);
  });
});
