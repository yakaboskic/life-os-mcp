import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "./logger.js";
import { fail } from "./result.js";

/** The agent passed bad arguments (unknown account, missing field, bad label). */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

/** Authorization for an account is missing, expired, or insufficient. */
export class AuthError extends Error {
  constructor(
    message: string,
    public readonly account?: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** The upstream API (Gmail) rejected or failed the request. */
export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/**
 * Every tool handler is wrapped with this mapper: agents always receive an
 * actionable one-liner as `{isError: true}`, never a stack trace. Unexpected
 * errors get their stack logged to stderr.
 */
export function toCallToolResult(err: unknown, logger: Logger): CallToolResult {
  if (err instanceof ToolInputError || err instanceof AuthError || err instanceof UpstreamError) {
    return fail(err.message);
  }
  logger.error("unexpected tool error:", err instanceof Error ? err : String(err));
  const message = err instanceof Error ? err.message : String(err);
  return fail(`Unexpected error: ${message}`);
}
