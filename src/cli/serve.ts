import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../core/config.js";
import { createLogger } from "../core/logger.js";
import { buildServer, SERVER_NAME, SERVER_VERSION } from "../core/server.js";
import { selectToolsets } from "../core/registry.js";

export interface ServeOptions {
  /** From --toolsets; overrides LIFE_OS_TOOLSETS. */
  toolsets?: string[];
}

export async function serve(opts: ServeOptions = {}): Promise<void> {
  // FIRST: stdout is the MCP JSON-RPC stream. Rebind every console channel to
  // stderr so a stray print (ours or a dependency's) can't corrupt the
  // transport. Our logger already writes to stderr; this is the backstop.
  console.log = console.error.bind(console);
  console.info = console.error.bind(console);
  console.warn = console.error.bind(console);
  console.debug = console.error.bind(console);

  const logger = createLogger();
  const config = loadConfig();
  const filter = opts.toolsets ?? config.toolsetFilter;
  const toolsets = selectToolsets(filter);

  const server = await buildServer(toolsets, { config, logger });
  await server.connect(new StdioServerTransport());
  logger.info(`${SERVER_NAME} v${SERVER_VERSION} listening on stdio (toolsets: ${toolsets.map((t) => t.name).join(", ")})`);
}
