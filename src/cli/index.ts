import { parseArgs } from "node:util";

const USAGE = `life-os — Life OS MCP server

Usage:
  life-os daemon                       Shared loopback backend + dashboard
  life-os serve --connect <url>         Remote stdio bridge (no local data fallback)
  life-os jobs run gmail-triage --mode dry-run|apply --wait [--scheduled]
  life-os jobs status | retry <run-id>   Durable job history / resume
  life-os automation status             Agent reviews, daily brief and delivery status
  life-os automation run review|brief|daily [--request-id <id>]
  life-os automation schedule --time HH:MM --enable|--disable
  life-os triage review list | resolve <id> --category <category>
  life-os db migrate                    Validate and import legacy tracker files
  life-os backup create --output <dir> | verify <dir>
  life-os serve [--toolsets gmail,...]   Run the MCP server on stdio (default command)
  life-os auth add [--services gmail,drive] [--alias <name>] [--login-hint <email>] [--chrome-profile <dir>]
                                         Connect a Google account (opens a browser; default service: gmail)
  life-os reauth [--dry-run] [filter]    Weekly re-auth of every connected account, one browser flow at a
                                         time, each opened in that account's own Chrome profile
  life-os auth list [--verify]           List connected accounts (--verify checks each token live)
  life-os auth alias <name> <account>    Nickname a connected account (no re-auth needed)
  life-os auth remove <account> [--no-revoke]
                                         Disconnect an account (revokes with Google unless --no-revoke)
  life-os track start <task> [--note ..] Start the stopwatch on a task (auto-stops the previous one)
  life-os track stop [--note ..]         Stop and record the entry
  life-os track status                   Stopwatch + today/this-week totals
  life-os track tasks                    List open tasks
  life-os track report [today|yesterday|this-week|last-week]
                                         Time rollup by project
  life-os web [--port 4747]              Read-only time-tracking dashboard at http://127.0.0.1:4747

Environment:
  LIFE_OS_HOME        Data dir (default ~/.life-os)
  LIFE_OS_TOOLSETS    Comma-separated toolset filter (default: all)
  LIFE_OS_LOG_LEVEL   error|warn|info|debug (default info; logs go to stderr)
  GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
                      OAuth client override (else ~/.life-os/google/client_secret.json)

Register with Claude Code:
  claude mcp add life-os -- node /abs/path/to/life-os-mcp/dist/index.js serve
`;

/**
 * One-shot CLI commands exit here instead of waiting for the event loop to
 * drain — Google API clients leave keep-alive sockets behind that would
 * otherwise keep the process visibly hanging. Exits only after stdout has
 * flushed so piped output is never truncated. Never used by `serve`.
 */
function exitAfterFlush(code = 0): never {
  process.stdout.write("", () => process.exit(code));
  return undefined as never;
}

export async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      connect: { type: "string" },
      mode: { type: "string" },
      wait: { type: "boolean" },
      scheduled: { type: "boolean" },
      time: { type: "string" },
      enable: { type: "boolean" },
      disable: { type: "boolean" },
      "request-id": { type: "string" },
      output: { type: "string" },
      category: { type: "string" },
      "no-browser": { type: "boolean" },
      "callback-port": { type: "string" },
      "dry-run": { type: "boolean" },
      toolsets: { type: "string" },
      alias: { type: "string" },
      verify: { type: "boolean" },
      "no-revoke": { type: "boolean" },
      note: { type: "string" },
      port: { type: "string" },
      services: { type: "string" },
      "login-hint": { type: "string" },
      "chrome-profile": { type: "string" },
    },
  });

  const [command, subcommand, ...rest] = positionals;

  if (values.help && !command) {
    console.log(USAGE);
    return;
  }

  switch (command ?? "serve") {
    case "serve": {
      if (values.connect || process.env.LIFE_OS_BACKEND_URL) {
        const { bridgeStdio } = await import("../runtime/client.js");
        await bridgeStdio(values.connect ?? process.env.LIFE_OS_BACKEND_URL!); return;
      }
      // Remote bridges must not load local toolsets, Google clients, or storage.
      const { serve } = await import("./serve.js");
      await serve({ toolsets: values.toolsets?.split(",").map((s) => s.trim()).filter(Boolean) });
      return;
    }

    case "auth": {
      const { authAdd, authAlias, authList, authRemove } = await import("./auth.js");
      switch (subcommand) {
        case "add":
          await authAdd({
            alias: values.alias,
            services: values.services,
            loginHint: values["login-hint"],
            chromeProfile: values["chrome-profile"],
            noBrowser: values["no-browser"],
            callbackPort: values["callback-port"] ? Number(values["callback-port"]) : undefined,
          });
          return exitAfterFlush();
        case "list":
          await authList({ verify: values.verify });
          return exitAfterFlush();
        case "alias": {
          const [aliasName, account] = rest;
          if (!aliasName || !account) throw new Error("Usage: life-os auth alias <name> <account>");
          await authAlias({ alias: aliasName, account });
          return exitAfterFlush();
        }
        case "remove": {
          const account = rest[0];
          if (!account) throw new Error("Usage: life-os auth remove <account> [--no-revoke]");
          await authRemove({ account, revoke: !values["no-revoke"] });
          return exitAfterFlush();
        }
        default:
          throw new Error(`Unknown auth subcommand "${subcommand ?? ""}".\n\n${USAGE}`);
      }
    }

    case "reauth": {
      const { reauth } = await import("./reauth.js");
      const okAll = await reauth({ dryRun: values["dry-run"], filter: subcommand });
      return exitAfterFlush(okAll ? 0 : 1);
    }

    case "track": {
      if (process.env.LIFE_OS_BACKEND_URL || values.connect) {
        if (values.connect) process.env.LIFE_OS_BACKEND_URL = values.connect;
        const { callRemoteTool } = await import("../runtime/client.js");
        const names: Record<string,string> = {start:"track_start",stop:"track_stop",status:"track_status",tasks:"track_overview",report:"track_report"};
        const name=names[subcommand??""]; if(!name) throw new Error("Unknown track command");
        const args=subcommand==="start" ? {task:rest.join(" "),note:values.note} : subcommand==="stop" ? {note:values.note} : subcommand==="report" ? {range:(rest[0]??"this_week").replaceAll("-","_")} : {};
        const result=await callRemoteTool(name,args);
        console.log(JSON.stringify(result,null,2)); if(result.isError) process.exitCode=1; return;
      }
      const { trackReport, trackStart, trackStatus, trackStop, trackTasks } = await import("./track.js");
      switch (subcommand) {
        case "start":
          await trackStart(rest, values.note);
          return;
        case "stop":
          await trackStop(values.note);
          return;
        case "status":
          await trackStatus();
          return;
        case "tasks":
          await trackTasks();
          return;
        case "report":
          await trackReport(rest[0]);
          return;
        default:
          throw new Error(`Unknown track subcommand "${subcommand ?? ""}".\n\n${USAGE}`);
      }
    }

    case "web": {
      const { loadConfig } = await import("../core/config.js");
      const { createWebServer } = await import("../web/server.js");
      const port = values.port ? Number(values.port) : 4747;
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid --port "${values.port}"`);
      const server = createWebServer(loadConfig());
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      console.log(`life-os web portal (read-only): http://127.0.0.1:${port}`);
      console.log("Ctrl-C to stop.");
      return; // server keeps the process alive
    }

    case "daemon": {
      const {daemon}=await import("./runtime.js"); await daemon(); return;
    }
    case "agent-runner": {
      const {agentRunner}=await import("../runtime/claude-runner.js");await agentRunner();return;
    }
    case "jobs": {
      const {jobsCommand}=await import("./runtime.js");
      if(values.connect) process.env.LIFE_OS_BACKEND_URL=values.connect;
      await jobsCommand(subcommand,rest,{mode:values.mode,wait:values.wait,scheduled:values.scheduled});return;
    }
    case "automation": {
      const {automationCommand}=await import("./runtime.js");
      if(values.connect) process.env.LIFE_OS_BACKEND_URL=values.connect;
      await automationCommand(subcommand,rest,{time:values.time,enable:values.enable,disable:values.disable,requestId:values["request-id"]});return;
    }
    case "triage": {
      const {requestBackend}=await import("../runtime/client.js");
      if(subcommand!=="review") throw new Error("Usage: life-os triage review list|resolve <id> --category <category>");
      if(rest[0]==="list") console.log(JSON.stringify(await requestBackend("/v1/triage/reviews"),null,2));
      else if(rest[0]==="resolve"&&rest[1]&&values.category) console.log(JSON.stringify(await requestBackend(`/v1/triage/reviews/${encodeURIComponent(rest[1])}`,{method:"POST",body:{category:values.category}}),null,2));
      else throw new Error("Use review list, or review resolve <id> --category <category>");
      return;
    }
    case "db": {
      if(subcommand!=="migrate") throw new Error("Usage: life-os db migrate");
      process.env.LIFE_OS_ACCESS_MODE="migrate";
      const {loadConfig}=await import("../core/config.js");
      const {migrateDatabase}=await import("../state/migrate.js");
      console.log(JSON.stringify(migrateDatabase(loadConfig()),null,2));return;
    }
    case "backup": {
      process.env.LIFE_OS_ACCESS_MODE="backup";
      const {createBackup,verifyBackup}=await import("../state/backup.js");
      if(subcommand==="verify"&&rest[0]) console.log(JSON.stringify(verifyBackup(rest[0]),null,2));
      else if(subcommand==="create"&&values.output) {
        const {loadConfig}=await import("../core/config.js");console.log(JSON.stringify(await createBackup(loadConfig(),values.output),null,2));
      } else throw new Error("Usage: life-os backup create --output <empty-directory> or backup verify <directory>");
      return;
    }
    case "help":
      console.log(USAGE);
      return;

    default:
      throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
  }
}
