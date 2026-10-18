import { main } from "./cli/index.js";

main(process.argv.slice(2)).catch((err: unknown) => {
  process.stderr.write(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
