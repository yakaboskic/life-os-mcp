import { defineTool, type ToolDefinition } from "../../../core/toolset.js";
import { ok } from "../../../core/result.js";
import type { GmailManagerLike } from "../client.js";
import type { AccountInfo } from "../types.js";

export function accountTools(gm: () => GmailManagerLike): ToolDefinition<any>[] {
  return [
    defineTool({
      name: "gmail_list_accounts",
      title: "List connected Gmail accounts",
      description:
        "Lists the Gmail accounts connected to Life OS, with their aliases. " +
        "Every other gmail_* tool requires one of these as its `account` argument. " +
        "New accounts are connected by the user running `life-os auth add` in a terminal (not from here).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
      handler: async () => {
        const store = gm().store;
        const tokens = store.listTokenFiles();
        if (tokens.length === 0) {
          return ok({
            accounts: [],
            hint: 'No Gmail accounts connected yet. Ask the user to run "life-os auth add" in a terminal.',
          });
        }
        const aliases = store.aliases();
        const accounts: AccountInfo[] = tokens.map((t) => ({
          email: t.account,
          aliases: Object.entries(aliases)
            .filter(([, email]) => email.toLowerCase() === t.account.toLowerCase())
            .map(([alias]) => alias),
          scopes: t.scopes,
          connected_at: t.created_at,
          updated_at: t.updated_at,
        }));
        return ok({ accounts });
      },
    }),
  ];
}
