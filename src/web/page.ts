/**
 * Private, read-only Starfleet-inspired operations console.
 * Self-contained assets; every chart and status is derived from live API data.
 */
export const PORTAL_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Life OS</title>
<meta name="theme-color" content="#050a0f">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="LifeOS">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/svg+xml" href="/icons/life-os.svg">
<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png">
<style>
  :root {
    color-scheme: dark;
    --paper: #050a0f;
    --surface: #101c25;
    --surface-deep: #0a131b;
    --ink: #e2f4f4;
    --ink-2: #b3cbd3;
    --muted: #8da9b5;
    --line: #243d49;
    --rule: #3b6474;
    --accent: #71e1ed;
    --accent-2: #9ceaf2;
    --accent-soft: #142e39;
    --amber: #e7b16b;
    --red: #f29184;
    --yellow: #ebc66f;
    --green: #87c99e;
    --blue: #7eaff1;
    --src-email-fg: #9ceaf2; --src-email-bg: #173744;
    --src-slack-fg: #d5b3e9; --src-slack-bg: #30263d;
    --src-drive-fg: #e7b16b; --src-drive-bg: #3b3024;
    --sans: "Aptos", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
    --mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  }
  * { box-sizing: border-box; margin: 0; }
  html { scrollbar-gutter: stable; }
  body { background: var(--paper); color: var(--ink); font: 15px/1.5 var(--sans); max-width: 1600px; margin: 0 auto; padding: max(28px, env(safe-area-inset-top)) clamp(18px, 3.8vw, 60px) max(32px, env(safe-area-inset-bottom)); }
  a { color: var(--accent-2); text-underline-offset: 3px; }
  button, input { font: inherit; }
  button { cursor: pointer; }
  :focus-visible { outline: 2px solid var(--amber); outline-offset: 4px; }
  [hidden] { display: none !important; }
  .skip-link { position: absolute; top: -60px; left: 24px; padding: 10px 18px; background: var(--ink); color: var(--paper); z-index: 20; }
  .skip-link:focus { top: 12px; }
  .masthead { display: flex; align-items: center; gap: 24px; padding: 0 0 18px 18px; border-left: 4px solid var(--accent); }
  .identity { display: flex; align-items: center; gap: 20px; }
  .masthead h1 { font-size: 28px; line-height: 1; letter-spacing: .12em; font-weight: 600; white-space: nowrap; }
  .identity-label { border-left: 1px solid var(--rule); padding-left: 20px; color: var(--muted); font-size: 12px; line-height: 1.4; }
  .identity-label strong { display: block; color: var(--ink-2); font-weight: 500; }
  .tabs { display: flex; gap: 5px; margin-left: auto; align-self: stretch; align-items: center; }
  .tabs a { min-width: 84px; text-align: center; padding: 9px 18px; background: var(--surface-deep); color: var(--ink-2); text-decoration: none; border: 1px solid var(--line); border-bottom: 3px solid var(--rule); font-size: 13px; font-weight: 600; }
  .tabs a:first-child { border-top-left-radius: 14px; }
  .tabs a:last-child { border-bottom-right-radius: 14px; }
  .tabs a:hover { border-color: var(--accent); color: var(--ink); }
  .tabs a.active { background: var(--accent); border-color: var(--accent); color: #07151d; }
  .dateline { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; padding: 12px 0; border-top: 1px solid var(--rule); color: var(--ink-2); font-size: 12px; }
  .dateline .sub { margin-left: auto; color: var(--muted); }
  .systems-strip { display: grid; grid-template-columns: 1fr 1.1fr 1.3fr 1fr; border: 1px solid var(--rule); border-left: 4px solid var(--rule); background: var(--surface-deep); margin-bottom: 32px; }
  .system-cell { padding: 12px 16px; min-width: 0; border-left: 1px solid var(--line); }
  .system-cell:first-child { border-left: 0; }
  .system-label { display: block; color: var(--muted); font-size: 11px; margin-bottom: 4px; }
  .system-value { display: block; color: var(--ink-2); font-size: 12px; overflow-wrap: anywhere; }
  .system-value.connected { color: var(--accent); }
  .system-value.attention { color: var(--amber); }
  .system-value.disconnected { color: var(--red); }
  .connection-dot { display: inline-block; width: 6px; height: 6px; background: currentColor; margin-right: 6px; vertical-align: middle; }
  section { margin-bottom: 28px; min-width: 0; }
  h2 { font-size: 22px; font-weight: 550; letter-spacing: .015em; margin-bottom: 10px; }
  .section-kicker { display: none; }
  .section-intro { color: var(--muted); font-size: 13px; margin-bottom: 22px; max-width: 76ch; }
  .mutetext { color: var(--muted); }
  .note { color: var(--ink-2); }
  .panel, .soft-panel { background: var(--surface); border: 1px solid var(--rule); border-radius: 2px 18px 2px 2px; position: relative; min-width: 0; }
  .soft-panel { background: var(--surface-deep); border-color: var(--rule); }
  .time-focus { display: grid; grid-template-columns: minmax(240px, .65fr) minmax(0, 1.5fr); gap: 16px; margin-bottom: 16px; }
  .timer-card { padding: 22px 24px; min-height: 184px; display: flex; flex-direction: column; justify-content: space-between; border-left: 4px solid var(--amber); }
  .timer-card .label { color: var(--amber); font-size: 12px; }
  .timer-card .value { margin: 24px 0 10px; font: 400 42px/1 var(--mono); font-variant-numeric: tabular-nums; letter-spacing: -.05em; }
  .timer-card .value .live { color: var(--accent); }
  .timer-card .detail { color: var(--ink-2); font-size: 13px; overflow-wrap: anywhere; }
  .tape-card { padding: 18px 24px 16px; }
  .panel-label { color: var(--ink-2); font-size: 12px; margin-bottom: 4px; }
  .tape { position: relative; height: 104px; margin: 0 4px 12px; }
  .tape .baseline { position: absolute; left: 0; right: 0; bottom: 24px; border-bottom: 1px solid var(--rule); }
  .tape .tick { position: absolute; bottom: 19px; width: 1px; height: 6px; background: var(--rule); }
  .tape .ticklbl { position: absolute; bottom: 0; transform: translateX(-50%); font: 10px var(--mono); color: var(--muted); }
  .tape .block { position: absolute; bottom: 35px; height: 24px; border-radius: 1px 5px 1px 1px; background: var(--accent); min-width: 3px; }
  .tape .block.live { background: var(--accent-soft); border: 1px solid var(--accent); box-shadow: inset 0 0 12px #71e1ed15; }
  .tape .nowline { position: absolute; top: 18px; bottom: 20px; width: 1px; background: var(--amber); }
  .tape .nowlbl { position: absolute; top: 0; transform: translateX(-50%); font: 10px var(--mono); color: var(--amber); }
  .tape .agentmark { position: absolute; bottom: 10px; width: 6px; height: 6px; transform: translateX(-50%) rotate(45deg); background: var(--amber); }
  .tapelegend { font-size: 11px; color: var(--muted); display: flex; gap: 8px 18px; flex-wrap: wrap; }
  .tapelegend .key { display: inline-flex; align-items: center; gap: 6px; }
  .tapelegend .swatch { width: 14px; height: 6px; background: var(--accent); }
  .tapelegend .diamond { width: 6px; height: 6px; transform: rotate(45deg); background: var(--amber); }
  .statband { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--line); background: var(--surface-deep); }
  .stat { padding: 18px 24px; border-left: 1px solid var(--line); }
  .stat:first-child { border-left: 0; }
  .stat .label { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
  .stat .value { font: 400 26px/1.2 var(--mono); font-variant-numeric: tabular-nums; }
  .stat .detail { font-size: 12px; color: var(--muted); margin-top: 6px; }
  .meter { height: 4px; background: var(--line); margin-top: 12px; overflow: hidden; }
  .meter > div { height: 100%; background: var(--amber); }
  .time-secondary { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(280px, 1fr); gap: 16px; }
  .time-secondary > section { padding: 20px 24px; margin: 0; }
  .time-secondary h2 { font-size: 17px; }
  .weekchart { display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px; align-items: end; height: 180px; padding: 18px 0 14px; }
  .daycol { display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; justify-content: flex-end; }
  .daycol .val { font: 10px var(--mono); color: var(--ink-2); }
  .daycol .bar { width: 54%; max-width: 40px; background: var(--accent); min-height: 2px; }
  .daycol .bar.zero { background: var(--rule); height: 2px !important; }
  .daycol .lbl { font-size: 11px; color: var(--muted); border-top: 1px solid var(--line); width: 100%; text-align: center; padding-top: 6px; }
  .daycol.today .bar { background: var(--amber); }
  .daycol.today .lbl { color: var(--amber); }
  .tablewrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: var(--muted); font-size: 11px; font-weight: 500; padding: 8px 10px; border-bottom: 1px solid var(--rule); white-space: nowrap; }
  td { padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  td.num { font-family: var(--mono); font-size: 11px; white-space: nowrap; text-align: right; }
  tbody tr:hover td { background: #71e1ed06; }
  .share { display: inline-block; height: 4px; background: var(--accent); vertical-align: middle; }
  .sharetrack { display: inline-block; width: 84px; height: 4px; background: var(--line); vertical-align: middle; margin-right: 6px; overflow: hidden; }
  .status { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; padding: 2px 7px; border: 1px solid var(--line); color: var(--ink-2); background: var(--surface-deep); }
  .status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); flex: none; }
  .status.st-green::before { background: var(--green); }
  .status.st-yellow::before { background: var(--yellow); }
  .status.st-red::before { background: var(--red); }
  .status.st-white::before { background: #f5f5f1; border: 1px solid #bfcbd0; }
  .status.st-black::before { background: #050505; border: 1px solid #8da9b5; }
  .status.st-blue::before { background: var(--blue); }
  .status .cad { color: var(--muted); }
  .status.overdue-chip { border-color: var(--red); }
  .chip { font-size: 11px; color: var(--ink-2); border: 1px solid var(--line); padding: 2px 7px; background: var(--surface-deep); }
  .chip.role { color: var(--accent-2); }
  .deadline { color: var(--muted); }
  .overdue { color: var(--red); }
  .duerow { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px 12px; padding: 12px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
  .duerow:last-child { border-bottom: 0; }
  .duerow .kind { display: none; }
  .duerow .status { justify-self: end; }
  .duerow .due { grid-column: 1 / -1; color: var(--muted); font-size: 11px; }
  .duerow .due.late { color: var(--red); }
  .portfolio-section { margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--rule); }
  .portfolio-heading { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
  .portfolio-heading h2 { margin: 0; font-size: 19px; }
  .quiet-button { border: 1px solid var(--rule); border-radius: 2px 8px 2px 2px; background: var(--surface-deep); color: var(--ink-2); padding: 8px 12px; font: 500 12px var(--sans); }
  .quiet-button:hover { color: var(--ink); border-color: var(--accent); }
  #portfolio { display: grid; grid-template-columns: repeat(auto-fit, minmax(285px, 1fr)); gap: 16px; }
  .prodcard { padding: 18px; border: 1px solid var(--line); border-top: 2px solid var(--rule); background: var(--surface-deep); min-width: 0; }
  .prodhead { margin-bottom: 14px; }
  .prodhead .name { display: block; font-size: 15px; font-weight: 550; }
  .prodhead .status { margin-top: 7px; }
  .product-goal { margin: 8px 0 0; color: var(--muted); font-size: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .project-stack { display: grid; gap: 8px; }
  .portfolio-project { width: 100%; border: 1px solid var(--line); background: var(--surface); color: var(--ink); padding: 12px; text-align: left; font: inherit; }
  .portfolio-project:hover { border-color: var(--accent); background: var(--accent-soft); }
  .project-card-top { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
  .project-card-name { font-size: 13px; font-weight: 550; line-height: 1.4; }
  .project-card-count { flex: none; color: var(--muted); font-size: 11px; white-space: nowrap; }
  .project-card-next { display: block; margin-top: 7px; color: var(--ink-2); font-size: 12px; line-height: 1.45; }
  .project-card-meta { display: flex; gap: 7px; align-items: center; margin-top: 9px; color: var(--muted); font-size: 11px; }
  .project-card-meta .status { padding: 0; border: 0; background: transparent; font-size: 11px; }
  .project-card-meta .status .cad { display: none; }
  .todaygrid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr); gap: 20px; align-items: start; }
  .briefing-card { padding: 28px; min-height: 180px; border-left: 3px solid var(--amber); }
  .briefing-label { color: var(--amber); font-size: 12px; margin-bottom: 18px; }
  .briefing-card .mdbody { max-width: 70ch; font-size: 17px; line-height: 1.65; }
  .briefing-card .mdbody b { color: var(--ink); }
  .queue-card { padding: 20px; position: sticky; top: 18px; }
  .queuehead { font-size: 16px; font-weight: 550; }
  .queue-sub { color: var(--muted); font-size: 12px; margin: 4px 0 12px; }
  .queuerow { display: grid; grid-template-columns: auto 1fr; gap: 5px 10px; padding: 14px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
  .queuerow:last-child { border-bottom: 0; }
  .queuerow .qnote { grid-column: 2; color: var(--muted); font-size: 11px; }
  .src { display: inline-block; align-self: start; font-size: 10px; font-weight: 550; border-radius: 2px; padding: 2px 6px; }
  .src-email { color: var(--src-email-fg); background: var(--src-email-bg); }
  .src-slack { color: var(--src-slack-fg); background: var(--src-slack-bg); }
  .src-drive { color: var(--src-drive-fg); background: var(--src-drive-bg); }
  .src-briefing { color: var(--accent-2); background: var(--accent-soft); }
  .more-details { border-top: 1px solid var(--line); }
  .more-details summary { cursor: pointer; color: var(--ink-2); font-size: 12px; padding-top: 12px; }
  .taskbar { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; margin-bottom: 14px; font-size: 12px; color: var(--ink-2); }
  .taskbar label { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; }
  .taskbar input { accent-color: var(--accent); }
  #task-count { margin-left: auto; }
  .task-list { overflow: hidden; }
  .task-item { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 0 14px; align-items: start; padding: 17px 20px; border-bottom: 1px solid var(--line); }
  .task-item:last-child { border-bottom: 0; }
  .task-check { width: 11px; height: 11px; margin-top: 5px; border: 1px solid var(--rule); }
  .task-title { font-size: 14px; line-height: 1.45; }
  .task-meta { display: flex; flex-wrap: wrap; gap: 6px 10px; margin-top: 7px; color: var(--muted); font-size: 11px; }
  .task-age { color: var(--muted); font: 10px var(--mono); white-space: nowrap; padding-top: 4px; }
  .task-note-button, .inline-detail-button { appearance: none; border: 0; background: transparent; color: var(--accent-2); padding: 9px 0 0; font: 500 12px var(--sans); text-align: left; text-decoration: underline; text-underline-offset: 4px; }
  .task-note-button { grid-column: 2 / 4; justify-self: start; }
  .task-note-button:hover, .inline-detail-button:hover { color: var(--ink); }
  .task-item.is-done .task-title { color: var(--muted); text-decoration: line-through; }
  .task-item.is-done .task-check { background: var(--accent); box-shadow: inset 0 0 0 2px var(--surface); }
  .operations-panel { padding: 22px 24px; margin-bottom: 28px; }
  .operations-top { display: flex; justify-content: space-between; align-items: start; gap: 16px; margin-bottom: 20px; }
  .operations-top h3 { font-size: 17px; font-weight: 550; }
  .operations-top p { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .job-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; padding: 16px 0 20px; border-top: 1px solid var(--line); }
  .job-summary dt { color: var(--muted); font-size: 11px; }
  .job-summary dd { font-size: 14px; margin-top: 5px; }
  .job-state { display: inline-block; padding: 3px 8px; border: 1px solid var(--rule); color: var(--ink-2); font-size: 11px; white-space: nowrap; }
  .job-state.good { color: var(--accent); border-color: #376671; }
  .job-state.warn { color: var(--amber); border-color: #72573b; }
  .job-state.error { color: var(--red); border-color: #754a48; }
  .job-history { margin-top: 18px; }
  .job-history summary { color: var(--ink-2); cursor: pointer; font-size: 12px; padding-bottom: 10px; }
  #triage-reports { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 20px; align-items: start; }
  .report { padding: 20px 24px; border: 1px solid var(--line); background: var(--surface-deep); min-width: 0; }
  .reporthead { display: flex; align-items: baseline; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; }
  .reporthead .name { font-size: 17px; font-weight: 550; text-transform: capitalize; }
  .reporthead .stamp { font-size: 11px; color: var(--muted); }
  .srcdot { width: 6px; height: 6px; align-self: center; background: var(--muted); }
  .srcdot-email, .srcdot-briefing { background: var(--accent); }
  .srcdot-slack { background: var(--src-slack-fg); }
  .mdbody { font-size: 13px; max-width: 78ch; overflow-wrap: anywhere; }
  .mdbody h3 { font-size: 15px; font-weight: 550; margin: 20px 0 10px; }
  .mdbody h3:first-child { margin-top: 0; }
  .mdbody h4 { font-size: 13px; font-weight: 550; margin: 14px 0 6px; }
  .mdbody p { margin: 7px 0; color: var(--ink-2); }
  .mdbody ul, .mdbody ol { margin: 6px 0 14px; padding-left: 20px; color: var(--ink-2); }
  .mdbody li { margin: 5px 0; }
  .mdbody code { font: 11px var(--mono); background: var(--paper); border: 1px solid var(--line); padding: 1px 4px; }
  .mdbody b { color: var(--ink); font-weight: 550; }
  #tooltip { position: fixed; pointer-events: none; background: var(--surface); border: 1px solid var(--rule); padding: 8px 12px; font-size: 12px; opacity: 0; z-index: 10; max-width: min(320px, calc(100vw - 24px)); }
  dialog { width: min(720px, calc(100vw - 32px)); max-height: min(84vh, 820px); margin: auto; padding: 0; color: var(--ink); background: var(--surface); border: 1px solid var(--rule); border-top: 3px solid var(--accent); border-radius: 2px 18px 2px 2px; box-shadow: 0 24px 80px #0008; overflow: hidden; }
  dialog::backdrop { background: #02070bcc; backdrop-filter: blur(3px); }
  .dialog-shell { display: flex; flex-direction: column; max-height: min(84vh, 820px); }
  .dialog-header { display: flex; align-items: start; justify-content: space-between; gap: 18px; padding: 24px 26px 18px; border-bottom: 1px solid var(--line); }
  .dialog-header > div { min-width: 0; }
  .dialog-header h2 { margin: 6px 0 0; font-size: 22px; }
  .dialog-kicker { color: var(--muted); font-size: 12px; }
  .dialog-close { flex: none; border: 0; background: transparent; color: var(--muted); font: 300 28px/1 var(--sans); padding: 0 3px; }
  .dialog-close:hover { color: var(--ink); }
  .dialog-body { overflow-y: auto; padding: 22px 26px 28px; }
  .dialog-status { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 20px; }
  .dialog-section { padding-top: 18px; margin-top: 18px; border-top: 1px solid var(--line); }
  .dialog-section:first-child { padding-top: 0; margin-top: 0; border-top: 0; }
  .dialog-label { margin-bottom: 6px; color: var(--muted); font-size: 12px; }
  .dialog-copy { color: var(--ink-2); line-height: 1.55; overflow-wrap: anywhere; }
  .dialog-task { position: relative; padding: 10px 0 10px 22px; border-bottom: 1px solid var(--line); font-size: 14px; }
  .dialog-task:last-child { border-bottom: 0; }
  .dialog-task::before { content: ""; position: absolute; left: 1px; top: 17px; width: 8px; height: 8px; border: 1px solid var(--rule); }
  .dayhead td { font-weight: 550; padding-top: 18px; border-bottom: 1px solid var(--rule); }
  .reading-body { width: min(100%, 68ch); margin: 0 auto; font-size: 15px; line-height: 1.72; overflow-wrap: anywhere; }
  .reading-body h3 { margin: 28px 0 10px; padding-top: 22px; border-top: 1px solid var(--line); font-size: 18px; line-height: 1.35; }
  .reading-body h3:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
  .reading-body h4 { margin: 22px 0 8px; font-size: 14px; }
  .reading-body p { margin: 0 0 16px; color: var(--ink-2); }
  .reading-body b { color: var(--ink); font-weight: 550; }
  .reading-body ul, .reading-body ol { margin: 8px 0 20px; padding-left: 24px; color: var(--ink-2); }
  .reading-body li { margin: 9px 0; }
  .reading-body code { font: 12px var(--mono); background: var(--paper); border: 1px solid var(--line); padding: 1px 5px; }
  .install-control { margin-left: auto; }
  .install-control button { border: 0; background: none; color: var(--accent-2); padding: 0; font-size: 12px; text-decoration: underline; text-underline-offset: 3px; }
  .install-copy p { margin-bottom: 16px; color: var(--ink-2); }
  .install-copy strong { color: var(--ink); }
  @media (display-mode: standalone) { .install-control { display: none; } }
  footer { color: var(--muted); font-size: 11px; margin-top: 34px; padding-top: 14px; border-top: 1px solid var(--rule); }
  @media (min-width: 1200px) { .masthead h1 { font-size: 32px; } }
  @media (max-width: 980px) {
    .identity-label { display: none; }
    .todaygrid { grid-template-columns: minmax(0, 1.3fr) minmax(260px, 1fr); }
    .time-secondary { grid-template-columns: 1fr; }
    .systems-strip { grid-template-columns: repeat(2, 1fr); }
    .system-cell:nth-child(3) { border-left: 0; }
    .system-cell:nth-child(n+3) { border-top: 1px solid var(--line); }
  }
  @media (max-width: 720px) {
    body { padding: max(20px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) max(28px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left)); }
    .masthead { flex-wrap: wrap; gap: 20px; padding-left: 12px; }
    .masthead h1 { font-size: 25px; }
    .tabs { width: 100%; margin-left: 0; }
    .tabs a { flex: 1; min-width: 0; padding: 9px 7px; }
    .dateline .sub { margin-left: 0; }
    .systems-strip { margin-bottom: 26px; }
    .system-cell { padding: 10px 12px; }
    .system-value { font-size: 11px; }
    .time-focus, .todaygrid { grid-template-columns: 1fr; }
    .timer-card { min-height: 140px; }
    .timer-card .value { margin-top: 14px; }
    .tape-card { padding: 18px; }
    .stat { padding: 15px 12px; }
    .stat .value { font-size: 19px; }
    .stat .detail { font-size: 10px; }
    .stat .label { font-size: 11px; }
    .time-secondary > section { padding: 18px; }
    .queue-card { position: static; }
    .briefing-card { padding: 22px; }
    .portfolio-heading { align-items: center; }
    #portfolio { grid-template-columns: 1fr; }
    .task-item { grid-template-columns: 12px minmax(0, 1fr); padding: 16px; gap: 0 10px; }
    .task-age { grid-column: 2; padding-top: 8px; }
    .task-note-button { grid-column: 2; }
    .operations-panel { padding: 18px; }
    .account-results table, .account-results tbody { display: block; }
    .account-results thead { display: none; }
    .account-results tr { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 12px 0; border-top: 1px solid var(--line); }
    .account-results td { border: 0; padding: 3px 0; }
    .account-results td:first-child { grid-column: 1 / 3; align-self: center; }
    .account-results td:nth-child(2) { justify-self: end; }
    .account-results td.num { text-align: left; }
    .account-results td[data-label]::before { content: attr(data-label); display: block; color: var(--muted); font: 10px var(--sans); margin-bottom: 4px; }
    .operations-top { flex-wrap: wrap; }
    .job-summary { grid-template-columns: 1fr; gap: 12px; }
    .job-summary > div { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
    .job-summary dd { text-align: right; font-size: 12px; }
    .report { padding: 18px; }
    .dialog-header, .dialog-body { padding: 18px; }
  }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
</style>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to content</a>
  <header>
    <div class="masthead">
      <div class="identity"><h1>Life OS</h1><div class="identity-label"><strong>Personal systems</strong>Operations console</div></div>
      <nav class="tabs" aria-label="Main navigation">
        <a href="#time" data-tab="time">Time</a>
        <a href="#today" data-tab="today">Today</a>
        <a href="#tasks" data-tab="tasks">Tasks</a>
        <a href="#triage" data-tab="triage">Triage</a>
      </nav>
    </div>
    <div class="dateline">
      <span class="today" id="today-line"></span>
      <span class="sub" id="updated">Connecting to LifeOS…</span>
      <span class="install-control"><button id="install-app" type="button">Install LifeOS</button></span>
    </div>
  </header>
  <div class="systems-strip" aria-label="System status">
    <div class="system-cell"><span class="system-label">Connection</span><span class="system-value" id="connection-state" role="status">Connecting…</span></div>
    <div class="system-cell"><span class="system-label">Last successful triage</span><span class="system-value" id="last-job">Loading…</span></div>
    <div class="system-cell"><span class="system-label">Next Gmail triage</span><span class="system-value" id="next-job">Loading…</span></div>
    <div class="system-cell"><span class="system-label">Needs review</span><span class="system-value" id="attention-count">Loading…</span></div>
  </div>
  <main id="main-content" tabindex="-1">
  <div id="view-time">
    <section>
      <span class="section-kicker">Time</span>
      <h2>Time & focus</h2>
      <p class="section-intro">Your current session, tracked time, and project check-ins.</p>
      <div class="time-focus">
        <div class="timer-card soft-panel">
          <div class="label">Current focus</div>
          <div><div class="value" id="timer-value">—</div><div class="detail" id="timer-detail">Waiting for data</div></div>
        </div>
        <div class="tape-card panel"><div class="panel-label">Today’s activity</div><div class="tape" id="daytape"></div><div class="tapelegend" id="tapelegend"></div></div>
      </div>
      <div class="statband">
        <div class="stat"><div class="label">Today</div><div class="value" id="today-value">—</div><div class="detail" id="today-detail"></div></div>
        <div class="stat"><div class="label">This week</div><div class="value" id="week-value">—</div><div class="detail" id="week-detail"></div><div class="meter"><div id="week-meter" style="width:0%"></div></div></div>
        <div class="stat"><div class="label">Open tasks</div><div class="value" id="tasks-value">—</div><div class="detail" id="tasks-detail"></div></div>
      </div>
    </section>

    <div class="time-secondary">
      <section class="panel"><h2>This week</h2><div id="week-empty" class="mutetext" style="display:none; font-size:13px;">No time tracked this week.</div><div class="weekchart" id="weekchart"></div><div class="tablewrap" id="byproject"></div></section>
      <section class="panel"><h2>Needs a check-in</h2><div id="checkins"></div></section>
    </div>
    <section class="portfolio-section">
      <div class="portfolio-heading"><div><span class="section-kicker">Details</span><h2>Portfolio</h2></div><button class="quiet-button" id="recent-time-button" type="button">View recent time</button></div>
      <div id="portfolio"></div>
      <div id="entries" hidden></div>
    </section>
  </div>

  <div id="view-today" hidden>
    <section><span class="section-kicker">Today</span><h2>Daily briefing</h2>
      <p class="section-intro">Your latest briefing alongside the action queue.</p>
      <div class="todaygrid">
        <div id="today-briefing"><p class="mutetext">Loading…</p></div>
        <div id="today-queue"></div>
      </div>
    </section>
  </div>

  <div id="view-tasks" hidden>
    <section><span class="section-kicker">Tasks</span><h2>Task queue</h2>
      <p class="section-intro">Open tasks across your projects. Source notes include the original context.</p>
      <div class="taskbar">
        <label><input type="checkbox" id="show-done"> Show completed</label>
        <span class="mutetext" id="task-count"></span>
      </div>
      <div class="tablewrap" id="tasktable"></div>
    </section>
  </div>

  <div id="view-triage" hidden>
    <section><h2>Gmail operations</h2>
      <p class="section-intro">Scheduled triage, account health, and decisions awaiting review.</p>
      <div id="job-operations" class="operations-panel panel"><p class="mutetext">Loading job status…</p></div>
      <h2>Run reports</h2>
      <div class="taskbar">
        <label><input type="radio" name="tfilter" value="today" checked> Today</label>
        <label><input type="radio" name="tfilter" value="all"> All reports</label>
      </div>
      <div id="triage-reports"><p class="mutetext">Loading…</p></div>
    </section>
  </div>

  </main>
  <div id="tooltip" role="tooltip"></div>
  <dialog id="detail-dialog" aria-labelledby="dialog-title">
    <div class="dialog-shell">
      <header class="dialog-header">
        <div><div class="dialog-kicker" id="dialog-kicker"></div><h2 id="dialog-title"></h2></div>
        <button class="dialog-close" id="dialog-close" type="button" aria-label="Close dialog">×</button>
      </header>
      <div class="dialog-body" id="dialog-body"></div>
    </div>
  </dialog>
  <footer>Private LifeOS console · Read-only view · Make changes through your connected agent or the LifeOS CLI.</footer>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  let data = null;
  let triage = null; // /api/triage payload, shared by the day tape and the Triage tab
  let latestBriefing = null;
  let jobs = null;
  let dataAvailable = false;
  let jobsAvailable = false;
  let triageAvailable = false;

  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const startOfWeek = (d) => { const s = startOfDay(d); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return s; };
  const fmt = (secs) => { const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60); return h > 0 ? h + "h " + m + "m" : m + "m"; };
  const fmtClock = (secs) => { const h = Math.floor(secs/3600), m = Math.floor((secs%3600)/60), s = Math.floor(secs%60); return (h? h+":"+pad(m) : m) + ":" + pad(s); };
  const hrs = (secs) => Math.round(secs / 36) / 100;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const timeHM = (iso) => { const d = new Date(iso); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  const srcBadge = (name) => "<span class='src src-" + esc(String(name).toLowerCase()) + "'>" + esc(name) + "</span>";
  const TASK_SRC = /^(Email|Slack|Drive):\\s*(.*)$/;

  const tooltip = $("tooltip");
  function hover(el, html) {
    el.addEventListener("mouseenter", () => { tooltip.innerHTML = html; tooltip.style.opacity = "1"; });
    el.addEventListener("mousemove", (e) => {
      tooltip.style.left = Math.min(e.clientX + 12, window.innerWidth - tooltip.offsetWidth - 8) + "px";
      tooltip.style.top = (e.clientY + 14) + "px";
    });
    el.addEventListener("mouseleave", () => { tooltip.style.opacity = "0"; });
  }

  // ---- day tape (signature) ----
  function renderTape() {
    if (!data) return;
    const el = $("daytape");
    el.innerHTML = "";
    const now = new Date();
    const dayStart = startOfDay(now);
    const todays = data.entries.filter((e) => new Date(e.start) >= dayStart);
    const hourOf = (d) => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;

    let h0 = 6, h1 = 22;
    for (const e of todays) {
      h0 = Math.min(h0, Math.floor(hourOf(new Date(e.start))));
      h1 = Math.max(h1, Math.ceil(hourOf(new Date(e.end))));
    }
    if (data.activeTimer) h0 = Math.min(h0, Math.floor(hourOf(new Date(data.activeTimer.start))));
    h1 = Math.max(h1, Math.min(24, Math.ceil(hourOf(now)) + 1));
    for (const run of jobs?.runs || []) {
      if (run.startedAt && dayKey(new Date(run.startedAt)) === dayKey(now)) h0 = Math.min(h0, Math.floor(hourOf(new Date(run.startedAt))));
    }
    const span = h1 - h0;
    const pct = (h) => Math.max(0, Math.min(100, ((h - h0) / span) * 100));

    const base = document.createElement("div"); base.className = "baseline"; el.append(base);
    const step = span > 14 ? 3 : 2;
    for (let h = h0; h <= h1; h++) {
      const t = document.createElement("div"); t.className = "tick"; t.style.left = pct(h) + "%"; el.append(t);
      if ((h - h0) % step === 0) {
        const l = document.createElement("div"); l.className = "ticklbl"; l.style.left = pct(h) + "%";
        l.textContent = pad(h) + ":00"; el.append(l);
      }
    }

    const tasksById = new Map(data.tasks.map((t) => [t.id, t]));
    const addBlock = (startIso, endIso, cls, label) => {
      const s = hourOf(new Date(startIso)), e = hourOf(new Date(endIso));
      const b = document.createElement("div");
      b.className = "block" + (cls ? " " + cls : "");
      b.style.left = pct(s) + "%";
      b.style.width = Math.max(0.35, pct(e) - pct(s)) + "%";
      hover(b, label);
      el.append(b);
    };
    for (const e of todays) {
      const t = tasksById.get(e.taskId);
      addBlock(e.start, e.end, "", "<b>" + esc(t ? t.title : e.taskId) + "</b><br>" + timeHM(e.start) + "–" + timeHM(e.end) + " · " + fmt(e.seconds) + (e.note ? "<br>" + esc(e.note) : ""));
    }
    if (data.activeTimer) {
      const t = tasksById.get(data.activeTimer.taskId);
      addBlock(data.activeTimer.start, now.toISOString(), "live", "<b>" + esc(t ? t.title : data.activeTimer.taskId) + "</b><br>running since " + timeHM(data.activeTimer.start));
    }

    const events = jobs ? (jobs.runs || []).filter((r) => r.startedAt).map((r) => ({
      at: r.startedAt, label: "Gmail triage · " + jobStatus(r.status),
    })) : [];
    for (const event of events) {
      const m = new Date(event.at);
      if (dayKey(m) !== dayKey(now)) continue;
      const mark = document.createElement("div");
      mark.className = "agentmark";
      mark.style.left = pct(hourOf(m)) + "%";
      hover(mark, "<b>" + esc(event.label) + "</b><br>started " + timeHM(event.at));
      el.append(mark);
    }

    const nl = document.createElement("div"); nl.className = "nowline"; nl.style.left = pct(hourOf(now)) + "%"; el.append(nl);
    const nlbl = document.createElement("div"); nlbl.className = "nowlbl"; nlbl.style.left = pct(hourOf(now)) + "%";
    nlbl.textContent = timeHM(now.toISOString()); el.append(nlbl);

    $("tapelegend").innerHTML =
      "<span class='key'><span class='swatch'></span>tracked time</span>" +
      "<span class='key'><span class='diamond'></span>agent run</span>" +
      (todays.length === 0 && !data.activeTimer ? "<span>No tracked sessions today.</span>" : "");
  }

  function render() {
    if (!data) return;
    const tasksById = new Map(data.tasks.map((t) => [t.id, t]));
    const projectsById = new Map(data.projects.map((p) => [p.id, p]));
    const projOf = (taskId) => { const t = tasksById.get(taskId); return t && t.projectId ? projectsById.get(t.projectId) : undefined; };

    const now = new Date();
    const todayStart = startOfDay(now), weekStart = startOfWeek(now);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);

    let todaySecs = 0, weekSecs = 0;
    const byDay = new Map(), byProject = new Map();
    for (const e of data.entries) {
      const start = new Date(e.start);
      if (start >= weekStart && start < weekEnd) {
        weekSecs += e.seconds;
        const k = dayKey(start);
        byDay.set(k, (byDay.get(k) || 0) + e.seconds);
        const proj = projOf(e.taskId);
        const pk = proj ? proj.id : "(none)";
        const row = byProject.get(pk) || { name: proj ? proj.name : "(no project)", secs: 0 };
        row.secs += e.seconds;
        byProject.set(pk, row);
      }
      if (start >= todayStart) todaySecs += e.seconds;
    }

    $("today-line").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(now);
    $("updated").textContent = "Read-only · data refreshed " + timeHM(data.generatedAt);
    const timer = data.activeTimer;
    if (timer) {
      const t = tasksById.get(timer.taskId);
      $("timer-detail").textContent = (t ? t.title : timer.taskId) + (timer.note ? " — " + timer.note : "");
    } else {
      $("timer-value").textContent = "—";
      $("timer-detail").textContent = "not running";
    }
    $("today-value").textContent = fmt(todaySecs);
    $("today-detail").textContent = todaySecs ? "across " + data.entries.filter((e) => new Date(e.start) >= todayStart).length + " entr" + (data.entries.filter((e) => new Date(e.start) >= todayStart).length === 1 ? "y" : "ies") : "no entries yet";
    $("week-value").textContent = fmt(weekSecs);
    const target = data.weeklyTargetHours;
    $("week-detail").textContent = hrs(weekSecs) + "h of " + target + "h target";
    $("week-meter").style.width = (target > 0 ? Math.min(100, (weekSecs / 36 / target)) : 0) + "%";
    const open = data.tasks.filter((t) => t.status === "open");
    $("tasks-value").textContent = String(open.length);
    $("tasks-detail").textContent = data.projects.length + (data.projects.length === 1 ? " project · " : " projects · ") + data.products.length + (data.products.length === 1 ? " product" : " products");

    // week bars (Mon–Sun, single series)
    $("week-empty").style.display = weekSecs ? "none" : "block";
    const wc = $("weekchart"); wc.innerHTML = "";
    const names = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    const weekDay = (i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; };
    const vals = names.map((_, i) => byDay.get(dayKey(weekDay(i))) || 0);
    const max = Math.max(...vals, 3600);
    names.forEach((name, i) => {
      const col = document.createElement("div");
      col.className = "daycol" + (dayKey(weekDay(i)) === dayKey(now) ? " today" : "");
      const val = document.createElement("div"); val.className = "val"; val.textContent = vals[i] ? hrs(vals[i]) + "h" : "";
      const bar = document.createElement("div"); bar.className = "bar" + (vals[i] ? "" : " zero");
      bar.style.height = Math.max(2, Math.round((vals[i] / max) * 100)) + "px";
      const lbl = document.createElement("div"); lbl.className = "lbl"; lbl.textContent = name;
      hover(bar, "<b>" + name + "</b> — " + fmt(vals[i]));
      col.append(val, bar, lbl); wc.append(col);
    });

    // by project
    const bp = $("byproject");
    const rows = [...byProject.values()].sort((a, b) => b.secs - a.secs);
    bp.innerHTML = rows.length === 0 ? '<span class="mutetext">No time recorded this week yet.</span>'
      : "<table><tr><th>Project</th><th style='text-align:right'>Hours</th><th>Share</th></tr>" + rows.map((r) => {
          const pct = weekSecs ? Math.round((r.secs / weekSecs) * 100) : 0;
          return "<tr><td>" + esc(r.name) + "</td><td class='num'>" + fmt(r.secs) + "</td>" +
            "<td><span class='sharetrack'><span class='share' style='width:" + Math.max(2, pct) + "%'></span></span>" +
            "<span class='mutetext'>" + pct + "%</span></td></tr>";
        }).join("") + "</table>";

    // portfolio cards — full project context opens in the detail dialog
    const todayK = dayKey(now);
    const due = (d) => !d ? "" :
      " <span class='deadline'>(due " + d + (d < todayK ? " — <span class='overdue'>overdue</span>" : "") + ")</span>";
    const sem = data.statusSemantics || {};
    const statusChip = (s, checkIn) => {
      const k = String(s).toLowerCase();
      const known = ["green", "yellow", "red", "white", "black", "blue"].includes(k);
      const cadence = sem[k] ? sem[k].cadence : "";
      const late = checkIn && checkIn.daysOverdue > 0;
      return (
        "<span class='status" + (known ? " st-" + k : "") + (late ? " overdue-chip" : "") + "'" +
        (sem[k] ? " title='" + esc(sem[k].meaning) + "'" : "") + ">" + esc(s) +
        (cadence && cadence !== "none" ? " <span class='cad'>· " + esc(cadence) + "</span>" : "") + "</span>"
      );
    };
    const projBlock = (p) => {
      const openCount = data.tasks.filter((t) => t.projectId === p.id && t.status === "open").length;
      const next = p.nextMilestone ? esc(p.nextMilestone) + due(p.nextMilestoneDeadline) : "No next milestone set";
      return "<button class='portfolio-project' type='button' data-project-id='" + esc(p.id) + "'>" +
        "<span class='project-card-top'><span class='project-card-name'>" + esc(p.name) + "</span>" +
        "<span class='project-card-count'>" + openCount + " open</span></span>" +
        "<span class='project-card-next'>" + next + "</span>" +
        "<span class='project-card-meta'>" + (p.status ? statusChip(p.status, p.checkIn) : "") +
        (p.role ? "<span>" + esc(p.role) + "</span>" : "") + "</span></button>";
    };
    $("portfolio").innerHTML = data.products.map((prod) => {
      const projs = data.projects.filter((p) => p.productId === prod.id);
      return "<div class='prodcard'><div class='prodhead'><span class='name'>" + esc(prod.name) + "</span>" +
        (prod.status ? statusChip(prod.status, prod.checkIn) : "") +
        (prod.goal ? "<p class='product-goal'>" + esc(prod.goal) + "</p>" : "") + "</div>" +
        "<div class='project-stack'>" + projs.map(projBlock).join("") + "</div></div>";
    }).join("") + (() => {
      const orphans = data.projects.filter((p) => !p.productId);
      return orphans.length ? "<div class='prodcard'><div class='prodhead'><span class='name'>Other projects</span></div><div class='project-stack'>" + orphans.map(projBlock).join("") + "</div></div>" : "";
    })();

    // check-ins due (status colors are a cadence)
    const dueItems = [
      ...data.products.map((p) => ({ kind: "product", name: p.name, status: p.status, ci: p.checkIn })),
      ...data.projects.map((p) => ({ kind: "project", name: p.name, status: p.status, ci: p.checkIn })),
    ]
      .filter((x) => x.ci && x.ci.due)
      .sort((a, b) => (b.ci.daysOverdue || 0) - (a.ci.daysOverdue || 0));
    const noStatus = [...data.products, ...data.projects].filter((x) => !x.status).length;
    $("checkins").innerHTML =
      (dueItems.length === 0
        ? "<span class='mutetext'>Nothing due — every item with a status color is within its check-in cadence.</span>"
        : dueItems
            .map((x) => {
              const late = x.ci.daysOverdue > 0;
              const when = x.ci.lastCheckIn
                ? (late ? x.ci.daysOverdue + "d overdue" : "due today") + " · last " + x.ci.lastCheckIn
                : "never checked in";
              return "<div class='duerow'><span class='kind'>" + x.kind + "</span>" +
                "<span>" + esc(x.name) + "</span>" + statusChip(x.status, x.ci) +
                "<span class='due" + (late ? " late" : "") + "'>" + esc(when) + "</span></div>";
            })
            .join("")) +
      (noStatus > 0
        ? "<div class='mutetext' style='margin-top:8px; font-size:12.5px'>" + noStatus +
          " item(s) have no status color — set one to put them on a cadence.</div>"
        : "");

    // recent entries grouped by day
    const byDayEntries = new Map();
    for (const e of data.entries) {
      const k = dayKey(new Date(e.start));
      if (!byDayEntries.has(k)) byDayEntries.set(k, []);
      byDayEntries.get(k).push(e);
    }
    const days = [...byDayEntries.keys()].sort().reverse().slice(0, 14);
    $("entries").innerHTML = days.length === 0 ? '<span class="mutetext">No entries yet — start the stopwatch or log time via your agent.</span>'
      : "<table>" + days.map((k) => {
          const list = byDayEntries.get(k).sort((a, b) => b.start.localeCompare(a.start));
          const total = list.reduce((acc, e) => acc + e.seconds, 0);
          const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(k + "T00:00:00"));
          return "<tr class='dayhead'><td colspan='3'>" + dayLabel + "</td><td class='num'>" + fmt(total) + "</td></tr>" +
            list.map((e) => {
              const t = tasksById.get(e.taskId);
              const proj = projOf(e.taskId);
              return "<tr><td class='num mutetext'>" + timeHM(e.start) + "–" + timeHM(e.end) + "</td>" +
                "<td>" + esc(t ? t.title : e.taskId) + (proj ? " <span class='mutetext'>· " + esc(proj.name) + "</span>" : "") + "</td>" +
                "<td class='note'>" + esc(e.note || "") + "</td><td class='num'>" + fmt(e.seconds) + "</td></tr>";
            }).join("");
        }).join("") + "</table>";

    renderTape();
    renderTasks();
    renderToday();
  }

  // ---- shared detail dialog ----
  function openDetailDialog(kicker, title, body) {
    $("dialog-kicker").textContent = kicker;
    $("dialog-title").textContent = title;
    $("dialog-body").innerHTML = body;
    const dialog = $("detail-dialog");
    if (!dialog.open) dialog.showModal();
  }

  function openProjectDialog(projectId) {
    if (!data) return;
    const p = data.projects.find((item) => item.id === projectId);
    if (!p) return;
    const product = p.productId ? data.products.find((item) => item.id === p.productId) : null;
    const sem = data.statusSemantics || {};
    const status = String(p.status || "");
    const statusKey = status.toLowerCase();
    const cadence = sem[statusKey] ? sem[statusKey].cadence : "";
    const chip = status ? "<span class='status st-" + esc(statusKey) + "'>" + esc(status) +
      (cadence && cadence !== "none" ? " <span class='cad'>· " + esc(cadence) + "</span>" : "") + "</span>" : "";
    const badges = chip + (p.role ? "<span class='chip role'>" + esc(p.role) + "</span>" : "") +
      (p.lead ? "<span class='chip'>lead: " + esc(p.lead) + "</span>" : "");
    const dateCopy = (date) => !date ? "" : " <span class='deadline'>· due " + esc(date) + "</span>" +
      (date < dayKey(new Date()) ? " <span class='overdue'>· overdue</span>" : "");
    const tasks = data.tasks.filter((t) => t.projectId === p.id && t.status === "open");
    const body =
      (badges ? "<div class='dialog-status'>" + badges + "</div>" : "") +
      "<div class='dialog-section'><div class='dialog-label'>Goal</div><div class='dialog-copy'>" + esc(p.goal || "No goal recorded yet.") + dateCopy(p.deadline) + "</div></div>" +
      "<div class='dialog-section'><div class='dialog-label'>Next milestone</div><div class='dialog-copy'>" + esc(p.nextMilestone || "No next milestone recorded yet.") + dateCopy(p.nextMilestoneDeadline) + "</div></div>" +
      "<div class='dialog-section'><div class='dialog-label'>Open tasks · " + tasks.length + "</div>" +
      (tasks.length ? tasks.map((t) => "<div class='dialog-task'>" + esc(t.title) + "</div>").join("") : "<div class='dialog-copy'>Nothing open for this project.</div>") + "</div>";
    openDetailDialog(product ? product.name : "Other projects", p.name, body);
  }

  function openRecentTimeDialog() {
    const content = $("entries").innerHTML || "<p class='mutetext'>No entries yet.</p>";
    openDetailDialog("Time", "Recent entries", "<div class='tablewrap'>" + content + "</div>");
  }

  function sourceNotesToHtml(notes) {
    const structured = String(notes)
      .replace(/\\s+VERBATIM:\\s*/i, "\\n\\n### Message excerpt\\n\\n")
      .replace(/\\s+WHY THIS MATTERS[^.]*\\.\\s*/i, "\\n\\n### Why this matters\\n\\n")
      .replace(/\\s+DRAFT WAITING[^—]*—\\s*/i, "\\n\\n### Draft waiting\\n\\n");
    return mdToHtml(structured);
  }

  function openTaskNotesDialog(taskId) {
    if (!data) return;
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task || !task.notes) return;
    const match = task.title.match(TASK_SRC);
    const source = match ? match[1] : "Task";
    const title = match ? match[2] : task.title;
    openDetailDialog(source + " source notes", title, "<div class='reading-body source-note-body'>" + sourceNotesToHtml(task.notes) + "</div>");
  }

  function openBriefingDialog() {
    if (!latestBriefing) return;
    openDetailDialog(latestBriefing.heading, "Morning briefing", "<article class='reading-body'>" + latestBriefing.html + "</article>");
  }

  // ---- tasks table ----
  function renderTasks() {
    if (!data) return;
    const projectsById = new Map(data.projects.map((p) => [p.id, p]));
    const productsById = new Map(data.products.map((p) => [p.id, p]));
    const showDone = $("show-done").checked;
    const num = (t) => parseInt(String(t.id).replace(/\\D/g, ""), 10) || 0;
    const open = data.tasks.filter((t) => t.status === "open").sort((a, b) => num(b) - num(a));
    const done = data.tasks.filter((t) => t.status !== "open").sort((a, b) => num(b) - num(a));
    const list = showDone ? open.concat(done) : open;
    $("task-count").textContent = open.length + " open · " + done.length + " done";
    const projCell = (t) => {
      const proj = t.projectId ? projectsById.get(t.projectId) : undefined;
      if (!proj) return "<span class='mutetext'>—</span>";
      const prod = proj.productId ? productsById.get(proj.productId) : undefined;
      return esc(proj.name) + (prod ? " <span class='mutetext'>· " + esc(prod.name) + "</span>" : "");
    };
    $("tasktable").innerHTML = list.length === 0
      ? '<div class="panel" style="padding:24px"><span class="mutetext">No open tasks.</span></div>'
      : "<div class='task-list panel'>" + list.map((t) => {
          const m = t.title.match(TASK_SRC);
          const title = m ? esc(m[2]) : esc(t.title);
          const source = m ? srcBadge(m[1]) : "";
          const created = String(t.created_at || "").slice(0, 10);
          const notes = String(t.notes || "").trim();
          return "<article class='task-item" + (t.status === "open" ? "" : " is-done") + "' title='" + esc(t.id) + "'>" +
            "<span class='task-check' aria-hidden='true'></span>" +
            "<div class='task-main'><div class='task-title'>" + title + "</div><div class='task-meta'>" + source +
            "<span>" + projCell(t) + "</span>" + (t.status === "open" ? "" : "<span>completed</span>") + "</div></div>" +
            "<span class='task-age'>" + esc(created) + "</span>" +
            (notes ? "<button class='task-note-button' type='button' data-task-notes-id='" + esc(t.id) + "'>View source notes</button>" : "") +
            "</article>";
        }).join("") + "</div>";
  }

  // ---- triage reports ----
  // Tokenize source text before adding markup, so URLs never match generated HTML.
  function inlineMarkdown(source) {
    const token = /\`([^\`]+)\`|\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)|\\*\\*([^*]+)\\*\\*|https?:\\/\\/[^\\s<>"']+/g;
    let html = "", cursor = 0;
    const anchor = (url, label) => "<a href='" + esc(url) + "' target='_blank' rel='noopener noreferrer'>" + esc(label) + "</a>";
    for (const match of String(source).matchAll(token)) {
      html += esc(String(source).slice(cursor, match.index));
      if (match[1] !== undefined) html += "<code>" + esc(match[1]) + "</code>";
      else if (match[2] !== undefined) html += anchor(match[3], match[2]);
      else if (match[4] !== undefined) html += "<b>" + esc(match[4]) + "</b>";
      else {
        const url = match[0].replace(/[.,;:!?\\)]+$/, "");
        html += anchor(url, url) + esc(match[0].slice(url.length));
      }
      cursor = match.index + match[0].length;
    }
    return html + esc(String(source).slice(cursor));
  }
  function mdToHtml(src) {
    const inline = inlineMarkdown;
    const out = [];
    let listType = null, para = [];
    const closeList = () => { if (listType) { out.push("</" + listType + ">"); listType = null; } };
    // Consecutive text lines flow into ONE paragraph (markdown semantics) —
    // rendering each source line as its own <p> is what made reports look
    // full of stray carriage returns.
    const flushPara = () => { if (para.length) { out.push("<p>" + para.map(inline).join(" ") + "</p>"); para = []; } };
    const addListItem = (type, content) => {
      flushPara();
      if (listType !== type) { closeList(); out.push("<" + type + ">"); listType = type; }
      out.push("<li>" + inline(content) + "</li>");
    };
    for (const raw of src.split("\\n")) {
      const line = raw.trimEnd();
      if (/^#\\s/.test(line)) { flushPara(); closeList(); continue; } // file title — the section already names it
      if (/^##\\s/.test(line)) { flushPara(); closeList(); out.push("<h3>" + inline(line.slice(3)) + "</h3>"); continue; }
      if (/^###\\s/.test(line)) { flushPara(); closeList(); out.push("<h4>" + inline(line.slice(4)) + "</h4>"); continue; }
      if (/^[-*]\\s/.test(line)) { addListItem("ul", line.slice(2)); continue; }
      if (/^\\d+[.)]\\s/.test(line)) { addListItem("ol", line.replace(/^\\d+[.)]\\s*/, "")); continue; }
      if (line.trim() === "") { flushPara(); closeList(); continue; }
      closeList();
      para.push(line);
    }
    flushPara();
    closeList();
    return out.join("");
  }

  const REPORT_ORDER = ["briefing", "email", "slack"];
  // A log file is "# Title" then dated "## …" run sections, newest first.
  const splitSections = (content) => {
    const sections = [];
    let cur = null;
    for (const line of content.split("\\n")) {
      if (/^##\\s/.test(line)) { cur = { heading: line.replace(/^##\\s*/, "").trim(), body: [] }; sections.push(cur); continue; }
      if (cur) cur.body.push(line);
    }
    return sections;
  };
  let triageFilter = "today";
  function renderTriage() {
    if (!triage) return;
    const todayK = dayKey(new Date());
    const reports = (triage.reports || []).slice().sort((a, b) => {
      const ai = REPORT_ORDER.indexOf(a.name), bi = REPORT_ORDER.indexOf(b.name);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.name.localeCompare(b.name);
    });
    $("triage-reports").innerHTML = reports.length === 0
      ? "<p class='mutetext'>No reports yet. Reports appear after a completed triage run.</p>"
      : reports.map((r) => {
          let sections = splitSections(r.content);
          if (triageFilter === "today") sections = sections.filter((s) => s.heading.slice(0, 10) === todayK);
          const body = sections.length === 0
            ? "<p class='mutetext'>No " + esc(r.name) + " runs today — switch to all runs to see history.</p>"
            : sections.map((s) => "<h3>" + esc(s.heading) + "</h3>" + mdToHtml(s.body.join("\\n"))).join("");
          return "<div class='report'><div class='reporthead'><span class='srcdot srcdot-" + esc(r.name.toLowerCase()) + "'></span><span class='name'>" + esc(r.name) + "</span>" +
            "<span class='stamp'>updated " + new Date(r.modified).toLocaleString() + "</span></div>" +
            "<div class='mdbody'>" + body + "</div></div>";
        }).join("");
  }

  // ---- Today: the morning briefing + the open action queue ----
  function renderToday() {
    if (!triage && !data) return;
    const todayK = dayKey(new Date());
    let html = "";
    const briefing = triage ? (triage.reports || []).find((r) => r.name === "briefing") : null;
    if (briefing) {
      const latest = splitSections(briefing.content)[0];
      if (latest) {
        const isToday = latest.heading.slice(0, 10) === todayK;
        const body = latest.body.join("\\n");
        latestBriefing = { heading: latest.heading, html: mdToHtml(body) };
        const lines = latest.body.map((line) => line.trim()).filter(Boolean);
        const keyLine = lines.find((line) => /one sentence that matters/i.test(line)) ||
          lines.find((line) => !/^#{1,4}\\s/.test(line)) || "Your briefing is ready.";
        html += "<div class='briefing-card panel'><div class='briefing-label'>Start here</div>" +
          (isToday ? "" : "<p class='mutetext' style='margin:8px 0'>From " + esc(latest.heading) + " · latest available briefing</p>") +
          "<div class='mdbody'>" + mdToHtml(keyLine) + "</div>" +
          "<button class='inline-detail-button' id='briefing-full-button' type='button'>Read the full briefing</button></div>";
      }
    } else {
      html += "<p class='mutetext'>No briefing available. A briefing will appear here when your agent writes one.</p>";
    }
    $("today-briefing").innerHTML = html || "<p class='mutetext'>Nothing queued.</p>";
    if (data) {
      const queue = data.tasks.filter((t) => t.status === "open" && TASK_SRC.test(t.title));
      const queueRow = (t) => {
        const m = t.title.match(TASK_SRC);
        return "<div class='queuerow'>" + srcBadge(m[1]) + "<span>" + esc(m[2]) + "</span>" +
          "<span class='qnote'>added " + esc(String(t.created_at || "").slice(0, 10)) + "</span></div>";
      };
      $("today-queue").innerHTML = queue.length === 0
        ? "<div class='queue-card soft-panel'><h3 class='queuehead'>Action queue</h3><p class='queue-sub'>Nothing is waiting for you.</p></div>"
        : "<div class='queue-card soft-panel'><h3 class='queuehead'>Action queue</h3><p class='queue-sub'>" + queue.length + " items from triage</p>" +
          queue.slice(0, 4).map(queueRow).join("") +
          (queue.length > 4 ? "<details class='more-details'><summary>Show " + (queue.length - 4) + " more</summary>" + queue.slice(4).map(queueRow).join("") + "</details>" : "") + "</div>";
    }
  }

  async function refreshTriage() {
    try {
      const res = await fetch("/api/triage", { cache: "no-store" });
      if (!res.ok) throw new Error("Reports unavailable");
      triage = await res.json();
      triageAvailable = true;
      renderTriage();
      renderToday();
      renderTape();
    } catch {
      triageAvailable = false;
      if (triage) {
        renderTriage();
        $("triage-reports").insertAdjacentHTML("afterbegin", "<p class='mutetext'>Reports could not be refreshed. Showing the last received reports.</p>");
      } else $("triage-reports").innerHTML = "<p class='mutetext'>Reports are unavailable. Check your LifeOS connection; retrying automatically.</p>";
    }
  }

  // Job status is a read-only projection of the daemon's durable run records.
  const jobTime = (iso) => {
    if (!iso || !Number.isFinite(new Date(iso).getTime())) return "Not available";
    return new Intl.DateTimeFormat(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: jobs?.schedule?.timeZone || "America/New_York", timeZoneName: "short",
    }).format(new Date(iso));
  };
  const jobStatus = (status) => String(status || "unknown").replaceAll("_", " ");
  const successful = (run) => ["completed", "succeeded", "success"].includes(run.status) && run.mode !== "dry-run";
  const count = (n) => Number.isFinite(n) && n >= 0 ? n : 0;
  const jobBadge = (status) => {
    const tone = ["completed", "succeeded", "success", "ready"].includes(status) ? "good"
      : ["failed", "auth_blocked", "error"].includes(status) ? "error"
      : ["needs_review", "partial", "running", "retryable", "blocked"].includes(status) ? "warn" : "";
    return "<span class='job-state " + tone + "'>" + esc(jobStatus(status)) + "</span>";
  };
  function renderConnection() {
    const el = $("connection-state");
    const stale = !dataAvailable;
    el.className = "system-value " + (stale ? "disconnected" : "connected");
    el.innerHTML = "<span class='connection-dot' aria-hidden='true'></span>" +
      (dataAvailable ? "Connected" : data ? "Disconnected · cached data" : "Data unavailable");
    if (stale) $("updated").textContent = data
      ? "Last data refresh " + timeHM(data.generatedAt) + " · reconnect your LifeOS connection"
      : "Check your LifeOS connection. Retrying automatically.";
  }
  function renderJobs() {
    if (!jobs) return;
    const runs = Array.isArray(jobs.runs) ? jobs.runs : [];
    const latest = runs[0];
    const lastSuccess = runs.find(successful);
    const reviews = count(jobs.reviewCount);
    $("last-job").textContent = lastSuccess ? jobTime(lastSuccess.finishedAt || lastSuccess.startedAt) : "No successful run yet";
    $("next-job").textContent = jobs.schedule?.nextRunAt ? jobTime(jobs.schedule.nextRunAt) : "Schedule not active";
    $("attention-count").textContent = reviews + (reviews === 1 ? " decision" : " decisions");
    $("attention-count").className = "system-value" + (reviews > 0 ? " attention" : "");
    const schedule = jobs.schedule;
    const scheduleCopy = schedule ? "Daily at " + esc(schedule.localTime || "05:53") + " · " + esc(schedule.timeZone || "America/New_York") : "Schedule not configured";
    const accounts = Array.isArray(latest?.accounts) ? latest.accounts : [];
    const accountsTable = accounts.length ? "<div class='tablewrap account-results'><table><thead><tr><th>Account</th><th>Status</th><th>Processed</th><th>Held</th><th>Failed</th></tr></thead><tbody>" +
      accounts.map((a) => "<tr><td>" + esc(a.account) + "</td><td>" + jobBadge(a.status) + "</td><td class='num' data-label='Processed'>" + count(a.processed) +
        "</td><td class='num' data-label='Held'>" + count(a.held) + "</td><td class='num' data-label='Failed'>" + count(a.failed) + "</td></tr>").join("") + "</tbody></table></div>"
      : "<p class='mutetext'>" + (latest ? "No account results recorded for this run." : "No runs yet. Account results will appear after the first Gmail triage.") + "</p>";
    $("job-operations").innerHTML = "<div class='operations-top'><div><h3>Gmail triage</h3><p>" + scheduleCopy + "</p></div>" +
      (latest ? jobBadge(latest.status) : "<span class='job-state'>Awaiting first run</span>") + "</div>" +
      "<dl class='job-summary'><div><dt>Latest run</dt><dd>" + (latest ? jobTime(latest.startedAt) : "No run recorded") + "</dd></div>" +
      "<div><dt>Mode</dt><dd>" + (latest ? esc(latest.mode || "Unknown") : "—") + "</dd></div>" +
      "<div><dt>Jev decisions to review</dt><dd>" + reviews + "</dd></div></dl>" + accountsTable +
      (reviews ? "<p class='mutetext' style='font-size:12px; margin-top:14px'>Held messages remain in your inbox. Review them with your connected agent or the LifeOS CLI.</p>" : "") +
      (runs.length ? "<details class='job-history'><summary>Run history · " + runs.length + "</summary><div class='tablewrap'><table><thead><tr><th>Started</th><th>Mode</th><th>Status</th><th>Finished</th></tr></thead><tbody>" +
        runs.map((r) => "<tr><td>" + jobTime(r.startedAt) + "</td><td>" + esc(r.mode || "Unknown") + "</td><td>" + jobBadge(r.status) + "</td><td>" +
          (r.finishedAt ? jobTime(r.finishedAt) : "—") + "</td></tr>").join("") + "</tbody></table></div></details>" : "");
    if (!jobsAvailable) {
      $("job-operations").insertAdjacentHTML("afterbegin", "<p class='mutetext' style='margin-bottom:16px'>Job status is stale. Showing the last received records; retrying automatically.</p>");
      $("last-job").textContent += " · stale";
      $("next-job").textContent += " · stale";
      $("attention-count").textContent += " · stale";
    }
  }
  async function refreshJobs() {
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      if (!res.ok) throw new Error("Job status unavailable");
      const payload = await res.json();
      if (!Array.isArray(payload.runs)) throw new Error("Invalid job status");
      jobs = payload;
      jobsAvailable = true;
      renderJobs(); renderTape();
    } catch {
      jobsAvailable = false;
      if (jobs) renderJobs();
      else {
        $("last-job").textContent = "Status unavailable";
        $("next-job").textContent = "Status unavailable";
        $("attention-count").textContent = "Status unavailable";
        $("job-operations").innerHTML = "<p class='mutetext'>Job status is unavailable. Check your LifeOS connection; this panel retries automatically.</p>";
      }
    }
  }

  // Installation is optional; no personal data is written to browser storage.
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installPrompt = event; });
  window.addEventListener("appinstalled", () => { installPrompt = null; $("install-app").parentElement.hidden = true; });
  $("install-app").addEventListener("click", async () => {
    if (installPrompt) {
      const prompt = installPrompt; installPrompt = null;
      await prompt.prompt();
      return;
    }
    openDetailDialog("LifeOS", "Install on your devices", "<div class='install-copy'><p><strong>On iPhone</strong><br>Open LifeOS in Safari, tap Share, then Add to Home Screen. Keep Open as Web App enabled if offered.</p><p><strong>On Mac</strong><br>Open LifeOS in Safari and choose File → Add to Dock.</p><p>Use your private HTTPS address so LifeOS stays reachable on every device. Sign in if prompted. Tasks and email reports require a connection.</p></div>");
  });
  if (navigator.standalone === true) $("install-app").parentElement.hidden = true;
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("/service-worker.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // The connected dashboard remains usable if offline-shell installation fails.
    });
  }

  // ---- tab routing ----
  const TABS = ["time", "today", "tasks", "triage"];
  function currentTab() {
    const t = (location.hash || "#time").slice(1);
    return TABS.includes(t) ? t : "time";
  }
  function showTab() {
    const t = currentTab();
    for (const k of TABS) {
      $("view-" + k).hidden = k !== t;
      const link = document.querySelector("[data-tab=" + k + "]");
      link.classList.toggle("active", k === t);
      if (k === t) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    }
  }
  window.addEventListener("hashchange", showTab);
  $("show-done").addEventListener("change", renderTasks);
  for (const r of document.querySelectorAll("input[name=tfilter]")) {
    r.addEventListener("change", () => { triageFilter = r.value; renderTriage(); });
  }
  $("portfolio").addEventListener("click", (event) => {
    const card = event.target.closest("[data-project-id]");
    if (card) openProjectDialog(card.dataset.projectId);
  });
  $("tasktable").addEventListener("click", (event) => {
    const button = event.target.closest("[data-task-notes-id]");
    if (button) openTaskNotesDialog(button.dataset.taskNotesId);
  });
  $("today-briefing").addEventListener("click", (event) => {
    if (event.target.closest("#briefing-full-button")) openBriefingDialog();
  });
  $("recent-time-button").addEventListener("click", openRecentTimeDialog);
  $("dialog-close").addEventListener("click", () => $("detail-dialog").close());
  $("detail-dialog").addEventListener("click", (event) => {
    if (event.target === $("detail-dialog")) $("detail-dialog").close();
  });

  function tick() {
    if (!data || !data.activeTimer) return;
    const secs = Math.max(0, (Date.now() - new Date(data.activeTimer.start).getTime()) / 1000);
    $("timer-value").innerHTML = "<span class='live'>" + fmtClock(secs) + "</span>";
  }

  async function refresh() {
    try {
      const res = await fetch("/api/data", { cache: "no-store" });
      if (!res.ok) throw new Error("Data unavailable");
      const payload = await res.json();
      if (!Array.isArray(payload.tasks) || !Array.isArray(payload.entries) || !Array.isArray(payload.projects) || !Array.isArray(payload.products)) throw new Error("Invalid data");
      data = payload;
      dataAvailable = true;
      render(); tick(); renderConnection();
    } catch {
      dataAvailable = false;
      renderConnection();
    }
  }
  showTab();
  refresh();
  refreshTriage();
  refreshJobs();
  setInterval(() => { refresh(); refreshTriage(); refreshJobs(); }, 15000);
  setInterval(tick, 1000);
})();
</script>
</body>
</html>
`;
