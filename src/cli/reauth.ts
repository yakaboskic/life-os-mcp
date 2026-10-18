import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../core/config.js";
import { GoogleTokenStore, type TokenVariant } from "../google/token-store.js";
import { authAdd, authList } from "./auth.js";

interface ReauthStep {
  email: string;
  aliases: string[];
  services: string;
  variant: TokenVariant;
  chromeProfile?: string;
}

/**
 * Maps signed-in Google account emails to Chrome profile directories by
 * reading Chrome's own profile registry ("Local State" → profile.info_cache).
 */
function discoverChromeProfiles(): Map<string, string> {
  const candidates =
    process.platform === "darwin"
      ? [join(homedir(), "Library/Application Support/Google/Chrome/Local State")]
      : [join(homedir(), ".config/google-chrome/Local State")];
  for (const path of candidates) {
    try {
      const state = JSON.parse(readFileSync(path, "utf8"));
      const cache = state?.profile?.info_cache ?? {};
      const map = new Map<string, string>();
      for (const [dir, info] of Object.entries<any>(cache)) {
        const email = info?.user_name?.toLowerCase?.();
        if (email && !map.has(email)) map.set(email, dir);
      }
      return map;
    } catch {
      // try next / fall through
    }
  }
  return new Map();
}

function buildPlan(filter?: string): ReauthStep[] {
  const config = loadConfig();
  const profiles = discoverChromeProfiles();
  const steps: ReauthStep[] = [];
  for (const variant of ["", ".drive"] as TokenVariant[]) {
    const store = new GoogleTokenStore(config, variant);
    const aliases = store.aliases();
    for (const token of store.listTokenFiles()) {
      const email = token.account.toLowerCase();
      const names = Object.entries(aliases)
        .filter(([, e]) => e.toLowerCase() === email)
        .map(([a]) => a);
      steps.push({
        email,
        aliases: names,
        // Variant decides the service set: .drive tokens belong to the
        // admin-supplied drive client; default tokens are gmail.
        services: variant === ".drive" ? "drive" : "gmail",
        variant,
        chromeProfile: profiles.get(email),
      });
    }
  }
  steps.sort((a, b) => a.email.localeCompare(b.email) || a.services.localeCompare(b.services));
  if (!filter) return steps;
  const f = filter.toLowerCase();
  return steps.filter(
    (s) => s.email.includes(f) || s.aliases.some((a) => a.toLowerCase().includes(f)) || s.services.includes(f),
  );
}

export async function reauth(opts: { dryRun?: boolean; filter?: string }): Promise<boolean> {
  const steps = buildPlan(opts.filter);
  if (steps.length === 0) {
    console.log(opts.filter ? `No connected accounts match "${opts.filter}".` : "No connected accounts found.");
    return true;
  }

  console.log(`Re-auth plan (${steps.length} sign-in${steps.length > 1 ? "s" : ""}, sequential):\n`);
  for (const [i, s] of steps.entries()) {
    console.log(
      `  ${i + 1}. ${s.email}${s.aliases.length ? ` (${s.aliases.join(", ")})` : ""}  services: ${s.services}` +
        `  chrome: ${s.chromeProfile ?? "default browser (no Chrome profile found for this email)"}`,
    );
  }
  if (opts.dryRun) {
    console.log("\n--dry-run: nothing launched.");
    return true;
  }

  const failures: { email: string; error: string }[] = [];
  for (const [i, s] of steps.entries()) {
    console.log(`\n━━━ [${i + 1}/${steps.length}] ${s.email} (${s.services}) ━━━`);
    try {
      await authAdd({ services: s.services, loginHint: s.email, chromeProfile: s.chromeProfile });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ email: s.email, error: msg });
      console.error(`✗ ${s.email}: ${msg}\n  (continuing with the next account)`);
    }
  }

  console.log("\n━━━ verification ━━━");
  await authList({ verify: true });

  if (failures.length > 0) {
    console.log(`\n${failures.length} account(s) did NOT re-auth:`);
    for (const f of failures) console.log(`  ✗ ${f.email}: ${f.error}`);
    console.log("Re-run just those with: life-os reauth <email-or-alias-fragment>");
    return false;
  }
  console.log(`\n✔ All ${steps.length} account(s) re-authorized.`);
  return true;
}
