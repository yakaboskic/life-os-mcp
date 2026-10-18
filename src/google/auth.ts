import { OAuth2Client } from "google-auth-library";
import { AuthError } from "../core/errors.js";
import type { GoogleClientCreds } from "../core/config.js";
import type { Logger } from "../core/logger.js";
import type { GoogleTokenStore, TokenFile } from "./token-store.js";

/**
 * Builds an authorized OAuth2Client for a connected account: token-file lookup
 * (AuthError with the right re-auth command if missing), client-binding check
 * (tokens are bound to the OAuth client that minted them), transparent access-
 * token refresh, and rotated-refresh-token persistence. Shared by the gmail
 * and sheets account managers.
 */
export function createAccountOAuth2(opts: {
  email: string;
  store: GoogleTokenStore;
  creds: GoogleClientCreds;
  logger: Logger;
  reauthCmd: string;
}): { client: OAuth2Client; token: TokenFile } {
  const { email, store, creds, logger, reauthCmd } = opts;
  const token = store.getTokenFile(email);
  if (!token) {
    throw new AuthError(`No stored authorization for ${email}. Run "${reauthCmd}" and sign in as ${email}.`, email);
  }
  if (token.client_id && token.client_id !== creds.clientId) {
    throw new AuthError(
      `The stored token for ${email} was issued to a different OAuth client than the one currently configured. ` +
        `Tokens are client-bound — run "${reauthCmd}" again with the current client.`,
      email,
    );
  }
  const client = new OAuth2Client({ clientId: creds.clientId, clientSecret: creds.clientSecret });
  client.setCredentials({ refresh_token: token.refresh_token });
  client.on("tokens", (tokens) => {
    if (tokens.refresh_token) {
      logger.debug(`refresh token rotated for ${email}; persisting`);
      store.saveRefreshToken(email, tokens.refresh_token);
    }
  });
  return { client, token };
}

/** Throws a precise AuthError when a token lacks scopes a toolset needs. */
export function requireScopes(token: TokenFile, needed: string[], reauthCmd: string): void {
  const missing = needed.filter((s) => !token.scopes.includes(s));
  if (missing.length > 0) {
    const names = missing.map((s) => s.replace("https://www.googleapis.com/auth/", "")).join(", ");
    throw new AuthError(
      `The authorization for ${token.account} lacks required permission(s): ${names}. ` +
        `Run "${reauthCmd}" and sign in as ${token.account} — previously granted permissions are kept automatically.`,
      token.account,
    );
  }
}
