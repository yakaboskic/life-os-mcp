import type { ZodRawShape, ZodTypeAny, objectOutputType } from "zod";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { LifeOsConfig } from "./config.js";
import type { Logger } from "./logger.js";

/** Passed to every tool handler and toolset lifecycle hook. */
export interface ToolsetContext {
  config: LifeOsConfig;
  logger: Logger;
}

export interface ToolDefinition<Shape extends ZodRawShape = ZodRawShape> {
  /** Must start with `${toolset.name}_` — asserted at registration. */
  name: string;
  title?: string;
  /** Agent-facing; carries usage guidance (query syntax, where ids come from). */
  description: string;
  /** Zod RAW SHAPE (`{ q: z.string() }`), per MCP SDK v1.x convention — not z.object(). */
  inputSchema: Shape;
  annotations?: ToolAnnotations;
  handler(args: objectOutputType<Shape, ZodTypeAny>, ctx: ToolsetContext): Promise<CallToolResult>;
}

/**
 * The extensibility contract. A future domain (calendar, tasks, finance…)
 * implements this and adds one entry to ALL_TOOLSETS in core/registry.ts —
 * nothing else in core changes.
 */
export interface Toolset {
  name: string;
  description: string;
  tools: ToolDefinition<any>[];
  /** Optional warm-up / config validation. Runs once at server start. */
  init?(ctx: ToolsetContext): Promise<void>;
  /** Optional contribution to the McpServer `instructions` string. */
  instructions?(ctx: ToolsetContext): Promise<string | null>;
}

/** Identity helper so handlers typecheck against their own inputSchema at the definition site. */
export function defineTool<Shape extends ZodRawShape>(def: ToolDefinition<Shape>): ToolDefinition<Shape> {
  return def;
}
