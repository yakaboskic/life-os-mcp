const LEVELS = ["error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LEVELS)[number];

export interface Logger {
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

/**
 * All log output goes to stderr. When running under `life-os serve`, stdout is
 * the MCP stdio transport — writing anything else to it corrupts the JSON-RPC
 * stream.
 */
export function createLogger(level: string = process.env.LIFE_OS_LOG_LEVEL ?? "info"): Logger {
  const threshold = LEVELS.indexOf(level as LogLevel) === -1 ? LEVELS.indexOf("info") : LEVELS.indexOf(level as LogLevel);
  const write = (lvl: LogLevel, args: unknown[]) => {
    if (LEVELS.indexOf(lvl) > threshold) return;
    const line = args
      .map((a) => (typeof a === "string" ? a : a instanceof Error ? (a.stack ?? a.message) : JSON.stringify(a)))
      .join(" ");
    process.stderr.write(`[life-os] ${lvl}: ${line}\n`);
  };
  return {
    error: (...args) => write("error", args),
    warn: (...args) => write("warn", args),
    info: (...args) => write("info", args),
    debug: (...args) => write("debug", args),
  };
}
