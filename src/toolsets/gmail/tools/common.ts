import { z } from "zod";

export const accountArg = () =>
  z
    .string()
    .describe("Which Gmail account to use: an email address or configured alias. See gmail_list_accounts.");
