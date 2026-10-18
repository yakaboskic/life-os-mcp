import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toCallToolResult } from "./errors.js";
import type { Toolset, ToolsetContext } from "./toolset.js";

export const SERVER_NAME = "life-os";
export const SERVER_VERSION = "0.1.0";

/**
 * Builds the McpServer from the selected toolsets. Every tool handler runs
 * through one uniform wrapper: thrown errors become `{isError: true}` results
 * with an actionable message — agents never see a raw stack trace.
 */
export async function prepareToolsets(toolsets: Toolset[], ctx: ToolsetContext): Promise<string> {
  const instructionParts: string[] = [
    `Life OS MCP server. Toolsets are namespaced by prefix (e.g. gmail_*).`,
  ];
  for (const ts of toolsets) {
    await ts.init?.(ctx);
    const extra = await ts.instructions?.(ctx);
    if (extra) instructionParts.push(extra);
  }

  return instructionParts.join("\n\n");
}

export async function buildServer(toolsets: Toolset[], ctx: ToolsetContext, preparedInstructions?: string): Promise<McpServer> {
  const instructions = preparedInstructions ?? await prepareToolsets(toolsets, ctx);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions },
  );

  for (const ts of toolsets) {
    for (const tool of ts.tools) {
      if (!tool.name.startsWith(`${ts.name}_`)) {
        throw new Error(`Tool "${tool.name}" must be prefixed with "${ts.name}_" (toolset "${ts.name}")`);
      }
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        },
        async (args: any) => {
          try {
            return await tool.handler(args, ctx);
          } catch (err) {
            return toCallToolResult(err, ctx.logger);
          }
        },
      );
    }
    ctx.logger.info(`registered toolset "${ts.name}" (${ts.tools.length} tools)`);
  }

  return server;
}
