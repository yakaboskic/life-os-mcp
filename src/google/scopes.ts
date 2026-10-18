/** Per-service OAuth scope sets. `life-os auth add --services a,b` unions these. */
export const SERVICE_SCOPES: Record<string, readonly string[]> = {
  gmail: ["https://www.googleapis.com/auth/gmail.modify"],
  drive: [
    "https://www.googleapis.com/auth/spreadsheets",
    // FULL Drive scope is deliberate — parity with the team-tracking runbook's
    // approved client. It also backs the Docs tools (create/replace via
    // markdown media), which is why no separate documents scope is requested:
    // adding one would force every existing token through a re-authorization.
    // The scope breadth is a token-exposure consideration, documented in
    // docs/team-tracking-sync.md.
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents.readonly",
  ],
};

/**
 * Always requested: lets auth resolve the account's canonical email via the
 * userinfo endpoint regardless of which service scopes were granted
 * (gmail-only auth used users.getProfile; sheets-only tokens can't call that).
 */
export const BASE_SCOPES = ["https://www.googleapis.com/auth/userinfo.email"];

export const SPREADSHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
export const DOCUMENTS_READONLY_SCOPE = "https://www.googleapis.com/auth/documents.readonly";

export function scopesForServices(services: string[]): string[] {
  const scopes = new Set(BASE_SCOPES);
  for (const service of services) {
    const set = SERVICE_SCOPES[service];
    if (!set) {
      throw new Error(`Unknown service "${service}". Known services: ${Object.keys(SERVICE_SCOPES).join(", ")}`);
    }
    for (const s of set) scopes.add(s);
  }
  return [...scopes];
}

/** Human-readable service tags for a token's granted scopes (for auth list). */
export function servicesFromScopes(scopes: string[]): string[] {
  return Object.entries(SERVICE_SCOPES)
    .filter(([, set]) => set.every((s) => scopes.includes(s)))
    .map(([name]) => name);
}
