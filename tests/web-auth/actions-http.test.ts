import { afterEach, describe, expect, it } from "vitest";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type LifeOsConfig } from "../../src/core/config.js";
import { closeDatabase } from "../../src/state/database.js";
import { TrackerActions, entityRevision } from "../../src/runtime/actions.js";
import { createPrivateWebBridge } from "../../src/runtime/web-bridge.js";
import { createVercelHandler } from "../../web-app/api/index.js";
import { createWebHandler } from "../../web-app/handler.js";
import { SESSION_COOKIE, signCookie } from "../../web-app/auth.js";
// The production Cloud Run gateway intentionally ships as dependency-free JavaScript.
// @ts-expect-error No declaration file is shipped for this standalone deployment module.
import { createGateway } from "../../deploy/web-gateway/server.mjs";

const servers: Server[] = [], configs: LifeOsConfig[] = [];
const token = "synthetic-fullchain-gateway-token-32-bytes";
const owner = "owner@example.com", origin = "https://synthetic-lifeos.vercel.app";
const now = 1_800_000_000, secret = "synthetic-fullchain-session-secret-32-bytes";
const cookie = `${SESSION_COOKIE}=${signCookie({ kind: "session", sub: "synthetic-owner", email: owner, iat: now, exp: now + 3600 }, secret)}`;
async function listen(server: Server) {
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function httpPost(url: string, body: string, headers: Record<string, string>): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "POST", headers }, res => {
      const chunks: Buffer[] = []; res.on("data", chunk => chunks.push(chunk)); res.on("error", reject);
      res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: { "content-type": String(res.headers["content-type"]) } })));
    });
    req.on("error", reject); req.end(body);
  });
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); })));
  for (const config of configs.splice(0)) { closeDatabase(config); rmSync(config.home, { recursive: true, force: true }); }
});

describe("browser actions through every HTTP adapter", () => {
  it.each(["raw", "preparsed"])("persists focus and task edits exactly once through %s platform requests", async mode => {
    const { actions, send } = await actionHarness(mode);
    const project = actions.store.addProject({ name: "Synthetic project" });
    const input = { newTask: { title: "Plan café launch 🚀", projectId: project.id }, note: "First line\nSecond line", expectedTimerRevision: null };
    const command = { requestId: "http-focus-request", action: "timer.start", input };
    const started = await send(command); expect(started.status).toBe(200);
    const receipt = await started.json();
    expect(receipt).toMatchObject({ ok: true, requestId: command.requestId });
    expect((await send(command)).status).toBe(200);
    expect(actions.store.loadRegistry().tasks).toHaveLength(1);
    const task = actions.store.loadRegistry().tasks[0]!;
    expect(task).toMatchObject({ title: input.newTask.title, projectId: project.id });
    expect(actions.store.getTimer()).toMatchObject({ taskId: task.id, note: input.note });
    const update = await send({ requestId: "http-task-request", action: "task.update", input: {
      taskId: task.id, expectedRevision: entityRevision(task), notes: "Edited through the browser adapters",
    } });
    expect(update.status).toBe(200);
    expect(actions.store.resolveTask(task.id).notes).toBe("Edited through the browser adapters");
    const stale = await send({ requestId: "http-stale-request", action: "timer.start", input });
    expect(stale.status).toBe(409);
    expect(actions.store.loadRegistry().tasks).toHaveLength(1);
    expect(actions.store.db.prepare("SELECT DISTINCT actor FROM action_receipts").all()).toMatchObject([{ actor: owner }]);
  });

  it.each(["raw", "preparsed"])("creates a project and its task through %s platform requests without retry duplicates", async mode => {
    const { actions, send } = await actionHarness(mode);
    const product = actions.store.addProduct({ name: "Synthetic product" });
    const command = { requestId: "http-project-create", action: "project.create", input: {
      name: "Café launch 🚀", productId: product.id, goal: "Open the launch checklist", notes: "First line\nSecond line",
    } };
    const created = await send(command); expect(created.status).toBe(200);
    const receipt = await created.json() as { ok: boolean; requestId: string; result: { id: string } };
    expect(receipt).toMatchObject({ ok: true, requestId: command.requestId, result: command.input });
    expect(receipt.result.id).toBeTypeOf("string");
    expect(await (await send(command)).json()).toEqual(receipt);
    expect(actions.store.loadRegistry().projects).toHaveLength(1);
    const taskCommand = { requestId: "http-project-task", action: "task.create", input: {
      title: "Prepare launch checklist", projectId: receipt.result.id,
    } };
    const taskResponse = await send(taskCommand); expect(taskResponse.status).toBe(200);
    const taskReceipt = await taskResponse.json();
    expect(taskReceipt).toMatchObject({ ok: true, result: taskCommand.input });
    expect(await (await send(taskCommand)).json()).toEqual(taskReceipt);
    expect(actions.store.loadRegistry().tasks).toHaveLength(1);
    expect(actions.store.loadRegistry().tasks[0]?.projectId).toBe(receipt.result.id);

    const duplicate = await send({ ...command, requestId: "http-project-duplicate", input: { name: "  CAFÉ LAUNCH 🚀  " } });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: "PROJECT_EXISTS" });
    const missing = await send({ ...command, requestId: "http-project-missing", input: { name: "Another project", productId: "missing" } });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "PRODUCT_MISSING" });
    expect(actions.store.loadRegistry().projects).toHaveLength(1);
    expect(actions.store.db.prepare("SELECT COUNT(*) AS count FROM action_receipts").get()?.count).toBe(2);
    expect(actions.store.db.prepare("SELECT DISTINCT actor FROM action_receipts").all()).toMatchObject([{ actor: owner }]);
  });
});

async function actionHarness(mode: string) {
  const config = loadConfig({ LIFE_OS_HOME: mkdtempSync(join(tmpdir(), "lifeos-http-actions-")) }); configs.push(config);
  const actions = new TrackerActions(config);
  const privateBase = await listen(createPrivateWebBridge(token, "10.53.0.2", 4747, {
    executeAction: async (body, actor) => actions.execute(body, actor),
  }));
  const gatewayBase = await listen(createGateway({ token, upstream: "http://10.53.0.2:4749", fetchImpl: async (url: URL, options: RequestInit) => {
    return httpPost(privateBase + url.pathname, String(options.body), { ...(options.headers as Record<string, string>), host: "10.53.0.2:4749" });
  } }));
  const handler = createVercelHandler(createWebHandler({ now: () => now, env: {
    GOOGLE_WEB_CLIENT_ID: "synthetic.apps.googleusercontent.com", GOOGLE_WEB_CLIENT_SECRET: "synthetic-only",
    LIFE_OS_SESSION_SECRET: secret, LIFE_OS_ALLOWED_EMAIL: owner, LIFE_OS_PUBLIC_URL: origin,
    LIFE_OS_GATEWAY_URL: "https://synthetic-gateway.run.app", LIFE_OS_GATEWAY_TOKEN: token,
  }, fetch: (async (url, options) => fetch(gatewayBase + new URL(String(url)).pathname, options)) as typeof fetch }));
  const browserBase = await listen(createServer(async (req, res) => {
    if (mode === "preparsed") {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      Object.defineProperty(req, "body", { value: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    }
    await handler(req, res);
  }));
  const send = (body: unknown) => httpPost(browserBase + "/api/actions", JSON.stringify(body), {
    host: new URL(origin).host, cookie, origin, "sec-fetch-site": "same-origin", "content-type": "application/json",
  });
  return { actions, send };
}
