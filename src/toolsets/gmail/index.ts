import type { Toolset } from "../../core/toolset.js";
import { GmailAccountManager, type GmailManagerLike } from "./client.js";
import { GmailStore } from "./store.js";
import { accountTools } from "./tools/accounts.js";
import { searchTools } from "./tools/search.js";
import { readTools } from "./tools/read.js";
import { labelTools } from "./tools/labels.js";
import { trashTools } from "./tools/trash.js";
import { composeTools } from "./tools/compose.js";

export interface GmailToolsetDeps {
  /** Injectable for tests; production uses a real GmailAccountManager. */
  manager?: GmailManagerLike;
}

export function createGmailToolset(deps: GmailToolsetDeps = {}): Toolset {
  let manager: GmailManagerLike | undefined = deps.manager;
  const gm = (): GmailManagerLike => {
    if (!manager) throw new Error("gmail toolset used before init()");
    return manager;
  };

  return {
    name: "gmail",
    description: "Multi-account Gmail: triage, search, read, label, draft, reply, send.",
    init: async (ctx) => {
      manager ??= new GmailAccountManager(ctx);
      const accounts = manager.store.listTokenFiles();
      if (accounts.length === 0) {
        ctx.logger.warn('gmail: no accounts connected yet — run "life-os auth add" to connect one');
      } else {
        ctx.logger.info(`gmail: ${accounts.length} account(s) connected`);
      }
    },
    instructions: async (ctx) => {
      const store = manager?.store ?? new GmailStore(ctx.config);
      const described = store.describeAccounts();
      if (!described) {
        return (
          "Gmail toolset is enabled but NO accounts are connected. " +
          'If asked to work with email, tell the user to run "life-os auth add" in a terminal first.'
        );
      }
      return (
        `Gmail accounts connected: ${described}. Every gmail_* tool takes an "account" argument (email or alias) — ` +
        `there is no default account, so pick the right one deliberately. Search uses raw Gmail query syntax. ` +
        `Message/thread/draft ids are account-specific. Prefer gmail_create_draft over gmail_send_message unless ` +
        `the user explicitly asked to send.`
      );
    },
    tools: [
      ...accountTools(gm),
      ...searchTools(gm),
      ...readTools(gm),
      ...labelTools(gm),
      ...trashTools(gm),
      ...composeTools(gm),
    ],
  };
}
