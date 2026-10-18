import { createServer, type Server } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { LifeOsConfig } from "../core/config.js";
import { TrackStore } from "../toolsets/track/store.js";
import { STATUS_SEMANTICS, checkInState } from "../toolsets/track/status.js";
import { PORTAL_HTML } from "./page.js";
import { PWA_ASSETS } from "./pwa.js";
import { safeBrowserRequest } from "../runtime/security.js";
import type { JobStatus, JobRun } from "../jobs/types.js";
import { withRevision } from "../runtime/actions.js";

export interface WebFeatures {
  actions?: boolean;
  automationSnapshot?: () => unknown;
}

const ENTRY_WINDOW_DAYS = 90;

/**
 * Read-only portal server. GET-only by construction (anything else is 405),
 * serves the self-contained page and a JSON snapshot of the tracker. The CLI
 * binds it to 127.0.0.1 exclusively — this is a local dashboard, not a
 * network service.
 */
export function createWebServer(config: LifeOsConfig, jobSnapshot?: () => {status:JobStatus;runs:JobRun[]}, features: WebFeatures = {}): Server {
  const store = new TrackStore(config);

  return createServer((req, res) => {
    if (!safeBrowserRequest(req)) { res.writeHead(403).end("Invalid origin or host"); return; }
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("content-security-policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (req.method !== "GET") {
      res.writeHead(405, { allow: "GET" }).end();
      return;
    }
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const asset=PWA_ASSETS[path];
    if(asset) {
      res.writeHead(200,{"content-type":asset.contentType,"cache-control":"no-store","service-worker-allowed":"/"}).end(asset.body);
      return;
    }

    if (path === "/api/automation" && features.automationSnapshot) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(features.automationSnapshot()));
      return;
    }

    if (path === "/api/jobs" && jobSnapshot) {
      const {status,runs}=jobSnapshot();
      res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"}).end(JSON.stringify({
        generatedAt:new Date().toISOString(),schedule:{timeZone:status.timeZone,localTime:"05:53",nextRunAt:status.nextRunAt},
        runs:runs.map(run=>({...run,status:run.state,accounts:run.accounts.map(account=>({...account,status:account.state}))})),reviewCount:status.reviewCount,
      }));
      return;
    }

    if (path === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(PORTAL_HTML);
      return;
    }

    if (path === "/api/data") {
      const reg = store.loadRegistry();
      const cutoff = new Date(Date.now() - ENTRY_WINDOW_DAYS * 24 * 3600 * 1000);
      const withCheckIn = <T extends { status?: string; lastCheckIn?: string }>(x: T) => ({
        ...x,
        checkIn: checkInState(x.status, x.lastCheckIn),
      });
      const payload = {
        generatedAt: new Date().toISOString(),
        capabilities: { actions: features.actions === true, automation: !!features.automationSnapshot },
        weeklyTargetHours: reg.weeklyTargetHours,
        activeTimer: store.getTimer() ? withRevision(store.getTimer()!) : null,
        statusSemantics: STATUS_SEMANTICS,
        products: reg.products.map(withCheckIn),
        projects: reg.projects.map(withCheckIn),
        tasks: reg.tasks.map(withRevision),
        entries: store.listEntries({ from: cutoff }).map(withRevision),
      };
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(payload));
      return;
    }

    if (path === "/api/triage") {
      // Agent-written markdown reports from ~/.life-os/triage-log — filenames
      // come from readdir (never the request), so no traversal surface.
      let reports: { name: string; modified: string; content: string }[] = [];
      try {
        reports = readdirSync(config.triageLogDir)
          .filter((f) => f.endsWith(".md"))
          .sort()
          .map((f) => {
            const p = join(config.triageLogDir, f);
            return {
              name: f.replace(/\.md$/, ""),
              modified: statSync(p).mtime.toISOString(),
              content: readFileSync(p, "utf8").slice(0, 512 * 1024),
            };
          });
      } catch {
        // Directory absent until the first triage run writes a log.
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ generatedAt: new Date().toISOString(), reports }));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  });
}
