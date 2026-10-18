import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { CodeChallengeMethod, OAuth2Client, type Credentials } from "google-auth-library";
import type { Logger } from "../core/logger.js";

export interface LoopbackOAuthOptions {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  logger: Logger;
  timeoutMs?: number;
  /** Pre-select this Google account on the consent screen (OAuth login_hint). */
  loginHint?: string;
  /** Open the consent URL in a specific Chrome profile directory (e.g. "Profile 3"). */
  chromeProfile?: string;
  noBrowser?: boolean;
  callbackPort?: number;
}

export interface LoopbackOAuthResult {
  tokens: Credentials;
  client: OAuth2Client;
}

function openBrowser(url: string, chromeProfile?: string): void {
  let cmd: string;
  let args: string[];
  if (chromeProfile) {
    // Open in a specific Chrome profile so the right Google identity is signed in.
    if (process.platform === "darwin") {
      cmd = "open";
      args = ["-na", "Google Chrome", "--args", `--profile-directory=${chromeProfile}`, url];
    } else {
      cmd = process.platform === "win32" ? "chrome" : "google-chrome";
      args = [`--profile-directory=${chromeProfile}`, url];
    }
  } else {
    [cmd, args] =
      process.platform === "darwin"
        ? ["open", [url]]
        : process.platform === "win32"
          ? ["cmd", ["/c", "start", '""', url]]
          : ["xdg-open", [url]];
  }
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Non-fatal: the URL is printed for manual opening.
  }
}

const RESPONSE_PAGE = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
  `<body style="font-family: system-ui; margin: 4rem auto; max-width: 32rem; text-align: center">` +
  `<h2>${title}</h2><p>${body}</p></body></html>`;

/**
 * Interactive OAuth loopback flow for installed apps: starts a localhost HTTP
 * server on an ephemeral port, opens the consent URL in a browser (PKCE +
 * access_type=offline + prompt=consent to guarantee a refresh token, plus
 * include_granted_scopes so re-auth for a new service KEEPS previously granted
 * scopes — the fresh token carries the union). Only ever runs from the
 * `life-os auth` CLI — never inside the headless MCP server.
 */
export async function runLoopbackOAuth(opts: LoopbackOAuthOptions): Promise<LoopbackOAuthResult> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const state = randomBytes(16).toString("hex");

  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.callbackPort ?? 0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

  const client = new OAuth2Client({ clientId: opts.clientId, clientSecret: opts.clientSecret, redirectUri });
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: opts.scopes,
    state,
    login_hint: opts.loginHint,
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: codeChallenge,
  });

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out after ${Math.round(timeoutMs / 60000)} minutes waiting for browser sign-in.`));
      }, timeoutMs);

      server.on("request", (req, res) => {
        // "connection: close" so the browser doesn't hold a keep-alive socket
        // open — an idle socket would make server.close() (and the process)
        // hang until the tab is closed.
        const url = new URL(req.url ?? "/", redirectUri);
        if (url.pathname !== "/oauth2callback") {
          res.writeHead(404, { connection: "close" }).end();
          return;
        }
        const err = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        const gotState = url.searchParams.get("state");
        if (err) {
          res.writeHead(200, { "content-type": "text/html", connection: "close" });
          res.end(RESPONSE_PAGE("Sign-in cancelled", "You can close this tab and return to the terminal."));
          clearTimeout(timer);
          reject(new Error(err === "access_denied" ? "You declined the consent screen." : `OAuth error: ${err}`));
          return;
        }
        if (!code || gotState !== state) {
          res.writeHead(400, { "content-type": "text/html", connection: "close" });
          res.end(RESPONSE_PAGE("Sign-in failed", "State mismatch or missing code. Return to the terminal and retry."));
          clearTimeout(timer);
          reject(new Error("OAuth state mismatch or missing authorization code."));
          return;
        }
        res.writeHead(200, { "content-type": "text/html", connection: "close" });
        res.end(RESPONSE_PAGE("Connected ✔", "You can close this tab and return to the terminal."));
        clearTimeout(timer);
        resolve(code);
      });

      opts.logger.info(
        `Opening browser for Google sign-in${opts.loginHint ? ` as ${opts.loginHint}` : ""}` +
          `${opts.chromeProfile ? ` (Chrome profile "${opts.chromeProfile}")` : ""}…`,
      );
      opts.logger.info(`If it doesn't open, visit:\n\n  ${authUrl}\n`);
      if (!opts.noBrowser) openBrowser(authUrl, opts.chromeProfile);
    });

    const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri });
    client.setCredentials(tokens);
    return { tokens, client };
  } finally {
    // close() alone waits for in-flight/keep-alive sockets; destroy them so
    // the CLI can exit as soon as the flow finishes.
    server.close();
    server.closeAllConnections();
  }
}
