/**
 * Private, interactive Starfleet-inspired operations console.
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
  button, input, select, textarea { font: inherit; }
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
  .portfolio-heading .section-actions { margin: 0; justify-content: flex-end; }
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
    .portfolio-heading { align-items: center; flex-wrap: wrap; }
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

  .action-button, .text-button { min-height: 44px; padding: 10px 14px; border: 1px solid var(--accent); background: var(--accent); color: var(--paper); font-size: 13px; font-weight: 600; border-radius: 2px 8px 2px 2px; }
  .action-button:hover { background: var(--accent-2); }
  .quiet-button { min-height: 44px; }
  .text-button { background: transparent; color: var(--ink-2); border-color: transparent; }
  .text-button:hover { color: var(--accent); background: var(--accent-soft); }
  .danger-text { color: var(--red); }
  button:disabled { cursor: not-allowed; opacity: .45; }
  .focus-controls { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 20px; }
  .focus-controls .danger-text { padding-left: 0; font-size: 12px; }
  .focus-help { color: var(--muted); font-size: 12px; margin: -8px 0 14px; }
  .focus-help + .focus-help { margin-top: 0; }
  .focus-results { max-height: 260px; overflow-y: auto; overscroll-behavior: contain; border: 1px solid var(--rule); margin: 0 0 18px; }
  .focus-option { display: grid; width: 100%; min-height: 64px; gap: 3px; text-align: left; padding: 12px 14px; color: var(--ink); background: var(--surface-deep); border: 0; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
  .focus-option:last-child { border-bottom: 0; }
  .focus-option:hover, .focus-option.is-active, .focus-option[aria-selected="true"] { background: var(--accent-soft); box-shadow: inset 3px 0 var(--accent); }
  .focus-option strong { font-size: 14px; font-weight: 550; }
  .focus-option > span { font-size: 12px; color: var(--muted); }
  .focus-option .focus-option-kind { color: var(--amber); font: 10px var(--mono); text-transform: uppercase; letter-spacing: .06em; }
  .focus-selection { display: grid; gap: 4px; padding: 12px 14px; margin: 0 0 18px; border-left: 3px solid var(--accent); background: var(--accent-soft); overflow-wrap: anywhere; }
  .focus-selection > span, .focus-selection small { color: var(--muted); font-size: 12px; }
  .focus-selection strong { font-size: 14px; font-weight: 550; }
  .section-actions, .task-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .section-actions { margin-bottom: 18px; }
  .task-item:has(.task-toggle) { grid-template-columns: 44px minmax(0, 1fr) auto; }
  .task-toggle { width: 44px; min-height: 44px; padding: 0; color: var(--accent); background: var(--surface-deep); border: 1px solid var(--rule); font-size: 20px; }
  .task-toggle:hover { border-color: var(--accent); }
  .task-actions { grid-column: 2 / -1; margin-top: 8px; }
  .task-actions button { font-size: 12px; padding: 8px 12px; }
  .action-feedback, .session-notice { padding: 12px 16px; margin: 0 0 18px; border-left: 3px solid var(--accent); background: var(--accent-soft); color: var(--ink-2); font-size: 13px; overflow-wrap: anywhere; }
  .action-feedback.is-error, .session-notice { border-color: var(--amber); }
  .session-notice a { display: inline-block; padding: 10px 6px; }
  .action-description { color: var(--muted); margin-bottom: 20px; font-size: 13px; }
  .action-fields { border: 0; padding: 0; min-width: 0; }
  .form-field { display: grid; gap: 7px; margin-bottom: 18px; font-size: 13px; color: var(--ink-2); min-width: 0; }
  .form-field input, .form-field select, .form-field textarea { width: 100%; min-width: 0; min-height: 44px; border: 1px solid var(--rule); border-radius: 2px; background: var(--surface-deep); color: var(--ink); padding: 10px 12px; font-size: 16px; }
  .form-field textarea { resize: vertical; }
  .form-field small { color: var(--muted); }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .form-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; padding-top: 16px; border-top: 1px solid var(--line); }
  .form-error { padding: 12px; border-left: 3px solid var(--red); background: #352523; color: var(--ink); margin-bottom: 16px; font-size: 13px; }
  #action-dialog { width: min(600px, calc(100vw - 24px)); max-height: 90dvh; }
  #action-dialog .dialog-shell { max-height: 90dvh; }
  #action-dialog .dialog-close { min-width: 44px; min-height: 44px; }
  @media (max-width: 600px) {
    .form-grid { grid-template-columns: 1fr; gap: 0; }
    .form-actions > button { flex: 1; }
    .task-item:has(.task-toggle) { grid-template-columns: 44px minmax(0, 1fr); }
    .task-actions { gap: 4px; }
    .task-actions button { padding: 8px; }
  }


  #automation-panel { margin-top: 28px; }
  .automation-summary { color: var(--ink-2); font-size: 13px; margin-bottom: 16px; }
  .automation-detail { color: var(--muted); font-size: 12px; margin: 8px 0; overflow-wrap: anywhere; }
  .automation-history-row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; border-bottom: 1px solid var(--line); padding: 12px 0; font-size: 12px; }
  .automation-history-row small { display: block; color: var(--muted); margin-top: 3px; }
  .automation-history-row > span:last-child { text-align: right; color: var(--muted); }
  .review-row { display: flex; gap: 16px; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid var(--line); }
  .review-row:last-child { border-bottom: 0; }
  .review-row h3 { font-size: 14px; font-weight: 550; overflow-wrap: anywhere; }
  .review-row p, #review-queue .portfolio-heading p { color: var(--muted); font-size: 12px; margin-top: 5px; overflow-wrap: anywhere; }
  .review-row > div { min-width: 0; }
  .review-row button { flex-shrink: 0; }
  .review-context { padding: 14px; margin-bottom: 20px; background: var(--surface-deep); border-left: 3px solid var(--amber); overflow-wrap: anywhere; }
  .review-context p { color: var(--muted); font-size: 13px; margin: 5px 0; }
  .review-context a { display: inline-block; padding: 12px 0 0; }
  .review-rationale { border-left-color: var(--accent); }
  .review-rationale .rationale-text { color: var(--ink); white-space: pre-wrap; }
  .review-diagnostics h3, .review-rationale h3 { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
  .review-diagnostics .review-hold-reason { color: var(--ink); }
  .review-score-table { width: 100%; max-width: 420px; border-collapse: collapse; margin: 14px 0 10px; font-size: 13px; }
  .review-score-table caption { text-align: left; color: var(--ink-2); margin-bottom: 6px; }
  .review-score-table th, .review-score-table td { padding: 6px 8px 6px 0; border-bottom: 1px solid var(--line); text-align: left; font-weight: 400; }
  .review-score-table thead th { color: var(--muted); font-size: 12px; }
  .review-score-table th:last-child, .review-score-table td:last-child { text-align: right; padding-right: 0; white-space: nowrap; }
  .review-score-table td:last-child { font-family: var(--mono); color: var(--accent-2); }
  .decision-history { margin-top: 18px; }
  .decision-history summary { color: var(--ink-2); cursor: pointer; font-size: 12px; padding-bottom: 10px; }
  .decision-history .review-context { margin-bottom: 10px; }
  .form-check { display: flex; align-items: center; gap: 10px; min-height: 44px; margin-bottom: 14px; font-size: 14px; }
  .form-check input { width: 20px; height: 20px; accent-color: var(--accent); }
  @media (max-width: 600px) { .review-row { display: block; padding: 16px; } .review-row button { margin-top: 12px; } .automation-history-row { grid-template-columns: 1fr auto; } .automation-history-row > span:last-child { grid-column: 1 / -1; text-align: left; } }

  #review-workspace { margin-top: 28px; }
  .review-filters { display: grid; grid-template-columns: minmax(220px, 1.6fr) repeat(3, minmax(130px, 1fr)); gap: 12px; padding: 18px; margin: 18px 0 0; border: 1px solid var(--rule); background: var(--surface-deep); }
  .review-filters .form-field { margin: 0; }
  .review-filter-actions { grid-column: 1 / -1; display: flex; gap: 10px; align-items: center; }
  .review-filter-actions p { margin-left: auto; color: var(--muted); font-size: 12px; }
  .review-selection-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 12px 18px; background: var(--accent-soft); border: 1px solid var(--rule); border-top: 0; }
  .review-selection-bar .form-check { margin: 0; font-size: 13px; }
  .review-selection-bar > span { color: var(--ink-2); font-size: 13px; }
  .review-selection-bar .action-button { margin-left: auto; }
  .review-selection-bar button, .review-pager button, .review-filter-actions button { min-height: 44px; }
  .review-queue-status { padding: 12px 0; color: var(--muted); font-size: 13px; }
  .review-queue-status.is-error { color: var(--amber); }
  .review-results { border: 1px solid var(--rule); background: var(--surface); }
  .review-conversation { display: grid; grid-template-columns: 44px minmax(0, 1fr) minmax(145px, .28fr) auto; align-items: center; gap: 10px 16px; padding: 14px 18px 14px 8px; border-bottom: 1px solid var(--line); }
  .review-conversation:last-child { border-bottom: 0; }
  .review-conversation:has(input:checked) { background: var(--accent-soft); box-shadow: inset 3px 0 var(--accent); }
  .review-check { display: flex; width: 44px; min-height: 44px; align-items: center; justify-content: center; }
  .review-check input { width: 20px; height: 20px; accent-color: var(--accent); }
  .review-conversation h3 { font-size: 14px; font-weight: 550; overflow-wrap: anywhere; }
  .review-conversation p { color: var(--muted); font-size: 12px; margin-top: 4px; overflow-wrap: anywhere; }
  .review-conversation .review-suggestion { color: var(--ink-2); }
  .review-conversation button { min-height: 44px; }
  .review-conversation > div { min-width: 0; }
  .review-empty { padding: 28px 20px; color: var(--muted); }
  .review-pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding-top: 14px; font-size: 13px; color: var(--muted); }
  .review-pager > div { display: flex; gap: 8px; }
  .review-progress { padding: 16px 18px; margin: 16px 0; border-left: 3px solid var(--accent); background: var(--surface-deep); font-size: 13px; }
  .review-progress summary, .review-preferences > summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; color: var(--ink-2); }
  .review-progress p, .review-progress li { color: var(--muted); margin: 5px 0; overflow-wrap: anywhere; }
  .review-progress ul { padding-left: 20px; }
  .review-preferences { margin-top: 20px; padding: 10px 18px; border: 1px solid var(--line); background: var(--surface-deep); font-size: 13px; }
  .review-preference { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 12px 0; border-top: 1px solid var(--line); }
  .review-preference > div { min-width: 0; overflow-wrap: anywhere; }
  .review-preference p { color: var(--muted); font-size: 12px; }
  .review-preference button { min-height: 44px; }
  .review-confirm-list { max-height: 170px; overflow-y: auto; margin: 12px 0 20px; padding-left: 22px; font-size: 13px; color: var(--ink-2); }
  .review-confirm-list li { margin: 6px 0; overflow-wrap: anywhere; }
  .review-effect { color: var(--ink-2); border-left: 3px solid var(--amber); background: var(--surface-deep); padding: 12px; margin-bottom: 16px; font-size: 13px; }
  #detail-dialog.review-detail-dialog { width: min(900px, calc(100vw - 24px)); max-height: 90dvh; }
  .review-detail-dialog .dialog-shell { max-height: 90dvh; }
  .review-detail-dialog .dialog-close { min-width: 44px; min-height: 44px; }
  .review-message { margin: 18px 0 0; padding: 18px 0 0; border-top: 1px solid var(--line); }
  .review-message h3 { font-size: 14px; overflow-wrap: anywhere; }
  .review-message .review-message-meta { margin: 6px 0 14px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
  .review-message-body { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.65; color: var(--ink-2); max-width: 78ch; }
  @media (max-width: 900px) { .review-filters { grid-template-columns: 1fr 1fr; } .review-conversation { grid-template-columns: 44px minmax(0, 1fr) auto; } .review-conversation-status { grid-column: 2; } .review-conversation > button { grid-column: 3; grid-row: 1 / 3; } }
  @media (max-width: 600px) {
    .review-filters { padding: 14px; gap: 12px; } .review-filters > .form-field:first-child { grid-column: 1 / -1; }
    .review-filter-actions { flex-wrap: wrap; } .review-filter-actions p { width: 100%; margin: 0; }
    .review-selection-bar { padding: 10px 14px; gap: 6px 12px; } .review-selection-bar .action-button { margin-left: 0; }
    .review-conversation { gap: 4px 8px; padding: 12px 12px 12px 4px; grid-template-columns: 44px minmax(0, 1fr); }
    .review-conversation > button { grid-column: 2; grid-row: auto; justify-self: start; margin-top: 6px; }
    .review-check { align-self: start; } .review-preference { align-items: start; flex-wrap: wrap; }
  }

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
  <div id="session-notice" class="session-notice" hidden>Sign in again to continue. <a href="/auth/login" target="_blank" rel="noopener">Sign in with Google</a><button id="refresh-connection" class="quiet-button" type="button">I’ve signed in · refresh</button></div>
  <p id="action-feedback" class="action-feedback" role="status" aria-live="polite" hidden></p>
  <div id="view-time">
    <section>
      <span class="section-kicker">Time</span>
      <h2>Time & focus</h2>
      <p class="section-intro">Your current session, tracked time, and project check-ins.</p>
      <div class="time-focus">
        <div class="timer-card soft-panel">
          <div class="label">Current focus</div>
          <div><div class="value" id="timer-value">—</div><div class="detail" id="timer-detail">Waiting for data</div></div>
          <div id="focus-controls" class="focus-controls"></div>
        </div>
        <div class="tape-card panel"><div class="panel-label">Today’s activity</div><div class="tape" id="daytape"></div><div class="tapelegend" id="tapelegend"></div></div>
      </div>
      <div class="section-actions"><button id="log-time-button" class="quiet-button" type="button" data-write-control hidden>Log time</button></div>
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
      <div class="portfolio-heading"><div><span class="section-kicker">Details</span><h2>Projects</h2></div><div class="section-actions"><button class="action-button" id="new-project-button" type="button" data-write-control data-project-create hidden>New project</button><button class="quiet-button" id="recent-time-button" type="button">View recent time</button></div></div>
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
      <div id="automation-panel" class="operations-panel panel" hidden></div>
    </section>
  </div>

  <div id="view-tasks" hidden>
    <section><span class="section-kicker">Tasks</span><h2>Task queue</h2>
      <p class="section-intro">Open tasks across your projects. Source notes include the original context.</p>
      <div class="taskbar">
        <button id="new-task-button" class="action-button" type="button" data-write-control hidden>New task</button>
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
      <section id="review-queue" hidden></section>
      <section id="review-workspace" aria-labelledby="review-heading" hidden>
        <div class="portfolio-heading"><div><h2 id="review-heading">Review inbox</h2><p class="mutetext">Inspect held conversations and choose what happens next.</p></div><span class="chip" id="review-total"></span></div>
        <p id="review-backlog" class="automation-detail"></p>
        <form id="review-search-form" class="review-filters">
          <div class="form-field"><label for="review-search">Search sender or conversation</label><input id="review-search" name="search" type="search" maxlength="200" placeholder="Name, address, subject or words" autocomplete="off"></div>
          <div class="form-field"><label for="review-bucket">Review status</label><select id="review-bucket" name="bucket"><option value="all">All held conversations</option><option value="awaitingAgent">Awaiting Claude</option><option value="needsDecision">Needs your decision</option><option value="needsContext">Needs more context</option><option value="queued">Queued for changes</option></select></div>
          <div class="form-field"><label for="review-account">Gmail account</label><select id="review-account" name="account"><option value="">All accounts</option></select></div>
          <div class="form-field"><label for="review-category">Suggested category</label><select id="review-category" name="category"><option value="">All categories</option></select></div>
          <div class="review-filter-actions"><button class="quiet-button" type="submit">Search queue</button><button class="text-button" id="review-reset" type="button">Reset filters</button><p>Searches the full queue. Up to 50 conversations per page.</p></div>
        </form>
        <div id="review-command-progress" aria-live="polite"></div>
        <div class="review-selection-bar"><label class="form-check"><input id="review-select-page" type="checkbox"><span>Select this page</span></label><span id="review-selection-count">0 selected</span><button id="review-bulk-button" class="action-button" type="button">Choose category</button><button id="review-clear" class="text-button" type="button">Clear selection</button></div>
        <p id="review-queue-status" class="review-queue-status" role="status" aria-live="polite"></p>
        <div id="review-results" class="review-results" aria-busy="false"></div>
        <nav class="review-pager" aria-label="Review pages"><span id="review-page-label"></span><div><button id="review-previous" class="quiet-button" type="button">Previous</button><button id="review-next" class="quiet-button" type="button">Next</button></div></nav>
        <details id="review-preferences" class="review-preferences" hidden><summary>Remembered sender preferences</summary><p class="mutetext">Guidance for future reviews. Every conversation still goes through the review rules.</p><div id="review-preference-list"></div></details>
      </section>
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
  <dialog id="action-dialog" aria-labelledby="action-title" aria-describedby="action-description">
    <div class="dialog-shell">
      <header class="dialog-header"><div><div class="dialog-kicker">Shared with your agents</div><h2 id="action-title"></h2></div><button id="action-close" class="dialog-close" type="button" aria-label="Close form">×</button></header>
      <div class="dialog-body"><p id="action-description" class="action-description"></p>
        <form id="action-form"><fieldset id="action-fields" class="action-fields"></fieldset>
          <p id="action-error" class="form-error" role="alert" hidden></p>
          <div id="action-session" class="session-notice" hidden><a href="/auth/login" target="_blank" rel="noopener">Sign in with Google</a><button id="action-refresh-session" class="quiet-button" type="button">I’ve signed in · refresh</button></div>
          <div class="form-actions"><button id="action-cancel" class="quiet-button" type="button">Cancel</button><button id="action-submit" class="action-button" type="submit">Save</button></div>
        </form>
      </div>
    </div>
  </dialog>
  <footer id="portal-footer">Private LifeOS console · Read-only view · Make changes through your connected agent or the LifeOS CLI.</footer>

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
    $("updated").textContent = (data.capabilities?.actions ? "Data refreshed " : "Read-only · data refreshed ") + timeHM(data.generatedAt);
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
    $("entries").innerHTML = days.length === 0 ? '<span class="mutetext">No entries yet — start a focus session or log time.</span>'
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
                "<td class='note'>" + esc(e.note || "") + "</td><td class='num'>" + fmt(e.seconds) + (data.capabilities?.actions ? "<br><button class='text-button' type='button' data-write-control data-entry-edit='" + esc(e.id) + "'>Edit</button>" : "") + "</td></tr>";
            }).join("");
        }).join("") + "</table>";

    renderFocusControls();
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
    dialog.classList.remove("review-detail-dialog");
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
    openDetailDialog("Time", "Recent entries", (data?.capabilities?.actions ? "<div class='section-actions'><button class='action-button' type='button' data-write-control data-log-time>Log time</button></div>" : "") + "<div class='tablewrap'>" + content + "</div>");
    refreshActionControls();
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
            (data.capabilities?.actions ? "<button class='task-toggle' type='button' data-write-control data-task-toggle='" + esc(t.id) + "' aria-label='" + esc((t.status === "open" ? "Complete " : "Reopen ") + t.title) + "'>" + (t.status === "open" ? "□" : "✓") + "</button>" : "<span class='task-check' aria-hidden='true'></span>") +
            "<div class='task-main'><div class='task-title'>" + title + "</div><div class='task-meta'>" + source +
            "<span>" + projCell(t) + "</span>" + (t.status === "open" ? "" : "<span>completed</span>") + "</div></div>" +
            "<span class='task-age'>" + esc(created) + "</span>" +
            (data.capabilities?.actions ? "<div class='task-actions'><button class='text-button' type='button' data-write-control data-task-edit='" + esc(t.id) + "'>Edit task</button>" + (t.status === "open" ? "<button class='quiet-button' type='button' data-write-control data-task-focus='" + esc(t.id) + "'" + (data.activeTimer?.taskId === t.id ? " data-current-focus disabled" : "") + ">" + (data.activeTimer?.taskId === t.id ? "In focus" : "Start focus") + "</button>" : "") + "</div>" : "") +
            (notes ? "<button class='task-note-button' type='button' data-task-notes-id='" + esc(t.id) + "'>View source notes</button>" : "") +
            "</article>";
        }).join("") + "</div>";
    refreshActionControls();
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
    latestBriefing = null;
    if (automation?.briefing) {
      const artifact = automation.briefing;
      latestBriefing = { heading: artifact.day, html: mdToHtml(artifact.markdown) };
      const summary = String(artifact.markdown).split("\\n").map((line) => line.trim()).find((line) => line && !line.startsWith("#")) || "Your briefing is ready.";
      html = "<div class='briefing-card panel'><div class='briefing-label'>Start here · " + esc(artifact.day) + "</div>" +
        "<div class='mdbody'>" + mdToHtml(summary) + "</div><p class='automation-detail'>Generated " + jobTime(artifact.createdAt) + (automationAvailable ? "" : " · last received briefing") + "</p>" +
        "<button class='inline-detail-button' id='briefing-full-button' type='button'>Read the full briefing</button></div>";
    } else if (briefing) {
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
  const successful = (run) => run.scheduled && run.mode === "apply" && run.finishedAt &&
    ["completed", "succeeded", "success", "partial"].includes(run.status) && run.accounts?.length > 0 &&
    run.accounts.every((account) => ["success", "partial"].includes(account.status) && account.failed === 0);
  const count = (n) => Number.isFinite(n) && n >= 0 ? n : 0;
  const jobBadge = (status) => {
    const tone = ["completed", "succeeded", "success", "ready", "sent"].includes(status) ? "good"
      : ["failed", "auth_blocked", "error", "uncertain"].includes(status) ? "error"
      : ["needs_review", "partial", "running", "retryable", "blocked", "pending", "queued", "retry_wait", "sending"].includes(status) ? "warn" : "";
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
    const lastSuccess = Object.hasOwn(jobs, "lastSuccessfulRun") ? jobs.lastSuccessfulRun : runs.find(successful);
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
      "<div><dt>Held conversations</dt><dd>" + reviews + "</dd></div></dl>" + accountsTable +
      (reviews ? "<p class='mutetext' style='font-size:12px; margin-top:14px'>Held messages remain in your inbox. Claude reviews eligible conversations; uncertain decisions remain available below for your review.</p>" : "") +
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

  // ---- shared browser actions ----
  let authExpired = false;
  let actionEditor = null;
  let actionBusy = false;
  let refreshSequence = 0;
  const canAct = () => !!data?.capabilities?.actions && dataAvailable && !authExpired && !actionBusy;
  function localInputValue(value) {
    const d = new Date(value);
    return dayKey(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }
  function timeInputToIso(value) {
    if (!value) throw new Error("Choose a date and time.");
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) throw new Error("Choose a valid date and time.");
    // A spring-forward gap is silently normalized by Date; do not save a different wall time.
    if (localInputValue(d).slice(0, value.length) !== value) throw new Error("That time does not exist in your current time zone. Choose another time.");
    return d.toISOString();
  }
  function actionRequest(previous, action, input) {
    const fingerprint = JSON.stringify({ action, input });
    return previous?.fingerprint === fingerprint ? previous : { fingerprint, body: { requestId: crypto.randomUUID(), action, input } };
  }
  function actionErrorMessage(code, fallback = "The operation could not finish. Try again after checking the connection.") {
    const messages = {
      CLAUDE_LOGIN_REQUIRED: "Sign in to Claude Code on the VM, then run the workflow again.",
      CLAUDE_QUOTA_EXHAUSTED: "Claude usage is exhausted. Wait for your allowance to reset before running again.",
      CLAUDE_RUNNER_UNAVAILABLE: "The Claude worker is unavailable on the VM. Check that Claude Code is installed and ready.",
      CLAUDE_RUNNER_TIMEOUT: "The Claude worker timed out. Check its run status before trying again.",
      CLAUDE_RUNNER_CANCELLED: "The Claude worker was interrupted. Check its run status before trying again.",
      CLAUDE_RUNNER_FAILED: "The Claude worker could not finish. Check its sign-in and try again.",
      AUTOMATION_DEADLINE: "The workflow reached its time limit. Review its progress before trying again.",
      AUTOMATION_BUSY: "Another workflow is running. Wait for it to finish, then retry.",
      AUTOMATION_DRAINING: "LifeOS is updating. Retry when the connection is ready.",
      AUTOMATION_NOT_CONFIGURED: "The workflow is not ready. Check the Claude worker and your briefing email settings on the VM.",
      DAILY_MODEL_BUDGET_EXHAUSTED: "The daily Claude budget has been reached. The workflow can resume after the daily reset.",
      BRIEF_DELIVERY_NOT_CONFIGURED: "Connect the Gmail account used to email your briefing, then try again.",
      BRIEF_SEND_UNCERTAIN: "Email delivery is being checked before another send is attempted.",
      BRIEF_RECONCILIATION_PENDING: "Email delivery is still being checked. Do not resend manually.",
      SEND_INTERRUPTED: "Sending was interrupted. LifeOS will check whether the email arrived before sending again.",
      DAEMON_RESTARTED: "LifeOS restarted during this run. Check the latest attempt for progress.",
      REVIEW_NOT_ELIGIBLE: "This review is no longer actionable. Refresh the queue to see its current state.",
      REVIEW_SERVICE_UNAVAILABLE: "Email review is temporarily unavailable. Check the connected Gmail account and try again.",
      REVIEW_REVISION_CHANGED: "This conversation changed. Inspect its latest messages before choosing a category again.",
      REVIEW_EVIDENCE_CHANGED: "The conversation changed before the action could run. Inspect it again.",
      REVIEW_NOT_FOUND: "This conversation is no longer in the review queue.",
      REVIEW_CONTEXT_INCOMPLETE: "More conversation context is needed before a category can be applied.",
      INSUFFICIENT_OR_TRUNCATED_CONTEXT: "The available conversation text is incomplete. Open Gmail to inspect the full thread.",
    };
    if (Object.hasOwn(messages, code)) return messages[code];
    return /^[A-Z][A-Z0-9_]+$/.test(String(fallback)) ? "The workflow could not finish. Check its latest run and try again." : fallback;
  }
  function actionFeedback(message, failed = false) {
    const el = $("action-feedback"); el.textContent = message; el.hidden = !message;
    el.classList.toggle("is-error", failed);
  }
  function refreshActionControls() {
    const enabled = !!data?.capabilities?.actions;
    document.querySelectorAll("[data-write-control]").forEach((el) => { el.hidden = !enabled || (el.hasAttribute("data-project-create") && data?.capabilities?.projectCreate !== true); el.disabled = !canAct() || el.hasAttribute("data-current-focus") || el.hasAttribute("data-review-unavailable") || ((el.hasAttribute("data-automation-run") || el.hasAttribute("data-automation-settings") || el.hasAttribute("data-review-item")) && (!automationAvailable || automation?.paused || (el.hasAttribute("data-automation-run") && !automation?.configured))); });
    $("session-notice").hidden = !authExpired;
    $("action-session").hidden = !authExpired;
    $("action-close").disabled = actionBusy;
    $("action-cancel").disabled = actionBusy;
    $("portal-footer").textContent = enabled ? "Private LifeOS console · Shared with your connected agents" : "Private LifeOS console · Read-only view · Make changes through your connected agent or the LifeOS CLI.";
    if (actionEditor) {
      const selection = actionEditor.focus?.selected;
      const focusReady = !actionEditor.focus || actionEditor.uncertain || (selection && (selection.kind === 'task' || $('action-field-focusTitle').value.trim()));
      $("action-submit").disabled = !canAct() || !focusReady || (actionEditor.action === "project.create" && data?.capabilities?.projectCreate !== true);
      $("action-fields").disabled = actionBusy || actionEditor.uncertain === true;
      $("action-dialog").setAttribute("aria-busy", String(actionBusy));
    }
    refreshReviewControls();
  }
  function renderFocusControls() {
    const active = data?.activeTimer;
    $("focus-controls").innerHTML = active
      ? '<button class="action-button" type="button" data-write-control data-focus-action="stop">Stop and save</button><button class="quiet-button" type="button" data-write-control data-focus-action="start">Switch task</button><button class="text-button danger-text" type="button" data-write-control data-focus-action="cancel">Discard session</button>'
      : '<button class="action-button" type="button" data-write-control data-focus-action="start">Start focus</button>';
    refreshActionControls();
  }
  const field = (label, control, hint = "") => {
    const name = control.split('name="')[1].split('"')[0];
    const id = "action-field-" + name;
    return '<div class="form-field"><label for="' + id + '">' + esc(label) + '</label>' + control.replace('name="', 'id="' + id + '" name="') + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</div>';
  };
  const inputControl = (name, value, extra = "") => '<input name="' + name + '" value="' + esc(value ?? "") + '" ' + extra + '>';
  const notesControl = (name, value) => '<textarea name="' + name + '" rows="4" maxlength="20000">' + esc(value || "") + '</textarea>';
  function taskOptions(selected, openOnly = false) {
    return data.tasks.filter((t) => !openOnly || t.status === "open").map((t) => '<option value="' + esc(t.id) + '"' + (t.id === selected ? ' selected' : '') + '>' + esc(t.title) + (t.status === "done" ? ' · completed' : '') + '</option>').join("");
  }
  function openActionEditor({ title, description = "", fields = "", submit, action, input, onSuccess, immediate = false }) {
    if (!canAct()) return;
    if ($("detail-dialog").open) $("detail-dialog").close();
    actionEditor = { action, input, onSuccess, request: null, uncertain: false, submit };
    $("action-title").textContent = title;
    $("action-description").textContent = description;
    $("action-fields").innerHTML = fields;
    $("action-error").textContent = "";
    $("action-error").hidden = true;
    $("action-submit").textContent = submit;
    $("action-dialog").showModal();
    refreshActionControls();
    if (immediate) $("action-form").requestSubmit();
  }
  function closeActionEditor() {
    if (actionBusy) return;
    if (actionEditor?.uncertain) actionFeedback("The last request could not be confirmed. Refresh your data before trying that action again.", true);
    $("action-dialog").close(); actionEditor = null;
  }
  // Focus always belongs to a task; project choices explicitly create a visible task.
  function focusCatalog(snapshot, currentTaskId) {
    const products = new Map(snapshot.products.map((item) => [item.id, item]));
    const projects = new Map(snapshot.projects.map((item) => [item.id, item]));
    const tasks = snapshot.tasks.filter((task) => task.status === 'open' && task.id !== currentTaskId);
    const context = (project) => [products.get(project?.productId)?.name, project?.name].filter(Boolean).join(' › ') || 'No project';
    const terms = (project) => [project?.id, project?.name, project?.productId, products.get(project?.productId)?.name].filter(Boolean);
    return [
      ...tasks.map((task) => { const project = projects.get(task.projectId); return { key: 'task:' + task.id, kind: 'task', id: task.id, title: task.title, context: context(project), search: [task.id, task.title, ...terms(project)] }; }),
      ...snapshot.projects.map((project) => ({ key: 'project:' + project.id, kind: 'project', id: project.id, title: project.name, context: context(project), openTasks: tasks.filter((task) => task.projectId === project.id).length, search: terms(project) })),
    ];
  }
  function focusSearch(catalog, query) {
    const normalize = (value) => String(value || '').normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().trim();
    const needle = normalize(query), words = needle.split(/\\s+/).filter(Boolean);
    const score = (row) => normalize(row.id) === needle || normalize(row.title) === needle ? 0 : normalize(row.title).startsWith(needle) ? 1 : words.every((word) => normalize(row.title).includes(word)) ? 2 : 3;
    const matches = catalog.filter((row) => words.every((word) => row.search.some((term) => normalize(term).includes(word))))
      .sort((a, b) => (needle ? score(a) - score(b) : 0) || (a.kind === b.kind ? 0 : a.kind === 'task' ? -1 : 1) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
    return { rows: matches.slice(0, 40), total: matches.length };
  }
  function focusStartInput(selected, title, note, expectedTimerRevision) {
    if (!selected) throw new Error('Choose a task or a project first.');
    const shared = { note, expectedTimerRevision };
    if (selected.kind === 'task') return { taskId: selected.id, ...shared };
    title = title.trim();
    if (!title || title.length > 500) throw new Error('Give the new task a title of 1 to 500 characters.');
    return { newTask: { title, ...(selected.kind === 'project' ? { projectId: selected.id } : {}) }, ...shared };
  }
  function renderFocusPicker() {
    const editor = actionEditor, picker = editor?.focus;
    if (!picker) return;
    const result = focusSearch(picker.catalog, picker.query);
    picker.rows = [...result.rows, { key: 'new', kind: 'new', title: 'Create an unassigned task', context: 'No project · choose a title below' }];
    const list = $('focus-results'), search = $('action-field-focusSearch');
    list.hidden = !picker.open;
    search.setAttribute('aria-expanded', String(picker.open));
    const activeId = picker.open && picker.activeIndex >= 0 ? 'focus-option-' + picker.activeIndex : null;
    if (activeId) search.setAttribute('aria-activedescendant', activeId); else search.removeAttribute('aria-activedescendant');
    $('focus-search-status').textContent = result.total ? (result.total > 40 ? 'Showing 40 of ' + result.total + ' matches. Refine your search.' : result.total + ' ' + (result.total === 1 ? 'match' : 'matches') + '.') : 'No matching tasks or projects. You can create an unassigned task.';
    list.innerHTML = picker.rows.map((row, index) => '<button type="button" role="option" tabindex="-1" id="focus-option-' + index + '" data-focus-option="' + index + '" aria-selected="' + (picker.selected?.key === row.key) + '" class="focus-option' + (index === picker.activeIndex ? ' is-active' : '') + '"><span class="focus-option-kind">' + (row.kind === 'task' ? 'Task · ' + esc(row.id) : row.kind === 'project' ? 'Project · ' + row.openTasks + ' available ' + (row.openTasks === 1 ? 'task' : 'tasks') : 'New task') + '</span><strong>' + esc(row.title) + '</strong><span>' + esc(row.context) + (row.kind === 'project' ? ' · Create a task here' : '') + '</span></button>').join('');
    const selected = picker.selected, creating = !!selected && selected.kind !== 'task';
    $('focus-selection').hidden = !selected;
    $('focus-selection').innerHTML = selected ? '<span>' + (creating ? 'New task in' : 'Selected task') + '</span><strong>' + esc(creating ? selected.kind === 'project' ? selected.title : 'No project' : selected.title) + '</strong><small>' + esc(selected.context) + '</small>' : '';
    $('focus-new-task').hidden = !creating;
    const title = $('action-field-focusTitle'); title.required = creating; title.disabled = !creating;
    editor.submit = creating ? 'Create task and start' : picker.switching ? 'Save current and start' : 'Start focus';
    if (!actionBusy && !editor.uncertain) $('action-submit').textContent = editor.submit;
    refreshActionControls();
  }
  function selectFocusOption(index) {
    const picker = actionEditor?.focus;
    if (!picker || !canAct() || actionEditor.uncertain) return;
    const selected = picker.rows[index]; if (!selected) return;
    picker.selected = selected; picker.open = false; picker.activeIndex = -1;
    if (selected.kind === 'new' && !$('action-field-focusTitle').value) $('action-field-focusTitle').value = picker.query.trim();
    renderFocusPicker();
    (selected.kind === 'task' ? $('action-submit') : $('action-field-focusTitle')).focus();
  }
  function openFocusEditor(taskId) {
    if (!canAct()) return;
    const timer = data.activeTimer, catalog = focusCatalog(data, timer?.taskId);
    const selected = catalog.find((row) => row.kind === 'task' && row.id === taskId) || null;
    const picker = { catalog, selected, query: '', rows: [], activeIndex: -1, open: !selected, switching: !!timer };
    const current = timer && data.tasks.find((task) => task.id === timer.taskId);
    openActionEditor({ title: timer ? 'Switch focus' : 'Start focus', submit: timer ? 'Save current and start' : 'Start focus', action: 'timer.start',
      description: timer ? 'Your current session on “' + (current?.title || timer.taskId) + '” will be saved when the new session starts.' : 'Choose a task, or create one in a project. Your session keeps running when you close LifeOS.',
      fields: field('Search tasks, projects, or products', inputControl('focusSearch', '', 'type="search" maxlength="500" role="combobox" aria-autocomplete="list" aria-controls="focus-results" aria-expanded="true" aria-describedby="focus-search-help focus-search-status" autocomplete="off" autocapitalize="off"')) + '<p id="focus-search-help" class="focus-help">Search names or IDs. Choose a project to create a task in it.</p><p id="focus-search-status" class="focus-help" role="status" aria-live="polite"></p><div id="focus-results" class="focus-results" role="listbox" aria-label="Focus search results"></div><div id="focus-selection" class="focus-selection" hidden></div><div id="focus-new-task" hidden>' + field('New task title', inputControl('focusTitle', '', 'maxlength="500"'), 'This task will appear in Tasks, with your focus time attached.') + '</div>' + field('Session note · optional', notesControl('note', '')),
      input: (form) => focusStartInput(picker.selected, String(form.get('focusTitle') || ''), String(form.get('note') || ''), timer?.revision ?? null),
    });
    actionEditor.focus = picker;
    renderFocusPicker();
    (selected ? $('action-submit') : $('action-field-focusSearch')).focus();
  }
  function openStopEditor(discard = false) {
    const timer = data?.activeTimer;
    if (!timer || !canAct()) return;
    const task = data.tasks.find((t) => t.id === timer.taskId);
    openActionEditor({ title: discard ? "Discard this session?" : "Save focus session", submit: discard ? "Discard session" : "Stop and save", action: discard ? "timer.cancel" : "timer.stop",
      description: discard ? 'The running session on “' + (task?.title || timer.taskId) + '” will be removed without recording time.' : 'Timing “' + (task?.title || timer.taskId) + '” until you choose Stop and save.',
      fields: discard ? "" : field("What did you work on? · optional", notesControl("note", timer.note)),
      input: (form) => ({ expectedTimerRevision: timer.revision, ...(discard ? {} : { note: String(form.get("note") || "") }) }),
    });
  }
  function projectCatalog(snapshot) {
    const products = new Map(snapshot.products.map((item) => [item.id, item]));
    return snapshot.projects.map((project) => {
      const product = products.get(project.productId);
      return { key: 'project:' + project.id, kind: 'project', id: project.id, title: project.name,
        context: (product?.name || 'Independent project') + ' · ' + project.id,
        search: [project.id, project.name, project.productId, product?.name].filter(Boolean) };
    });
  }
  function taskEditorInput(form, task, selected) {
    const title = String(form.get('title') || '').trim();
    if (!title || title.length > 500) throw new Error('Give the task a title of 1 to 500 characters.');
    // Search text is a filter only. Only a deliberately selected row supplies an ID.
    const projectId = selected?.id || null, notes = String(form.get('notes') || '');
    return task ? { taskId: task.id, expectedRevision: task.revision, title, projectId, notes }
      : { title, ...(projectId ? { projectId } : {}), notes };
  }
  function projectCreateInput(form) {
    const name = String(form.get('name') || '').trim(), productId = String(form.get('productId') || '');
    const goal = String(form.get('goal') || ''), notes = String(form.get('notes') || '');
    if (!name || name.length > 200) throw new Error('Give the project a name of 1 to 200 characters.');
    if (goal.length > 2000 || notes.length > 20000) throw new Error('Keep the goal under 2,000 characters and notes under 20,000 characters.');
    return { name, ...(productId ? { productId } : {}), ...(goal ? { goal } : {}), ...(notes ? { notes } : {}) };
  }
  function renderProjectPicker() {
    const picker = actionEditor?.project;
    if (!picker) return;
    const result = focusSearch(picker.catalog, picker.query);
    picker.rows = [...result.rows, { key: 'none', kind: 'none', id: null, title: 'No project', context: 'Keep this task unassigned' }];
    const list = $('project-results'), search = $('action-field-projectSearch');
    list.hidden = !picker.open; search.setAttribute('aria-expanded', String(picker.open));
    if (picker.open && picker.activeIndex >= 0) search.setAttribute('aria-activedescendant', 'project-option-' + picker.activeIndex);
    else search.removeAttribute('aria-activedescendant');
    $('project-search-status').textContent = result.total ? (result.total > 40 ? 'Showing 40 of ' + result.total + ' projects. Refine your search.' : result.total + (result.total === 1 ? ' project found.' : ' projects found.')) : 'No matching projects. You can keep this task unassigned.';
    list.innerHTML = picker.rows.map((row, index) => '<button type="button" role="option" tabindex="-1" id="project-option-' + index + '" data-project-option="' + index + '" aria-selected="' + ((picker.selected?.id || null) === row.id) + '" class="focus-option' + (index === picker.activeIndex ? ' is-active' : '') + '"><strong>' + esc(row.title) + '</strong><span>' + esc(row.context) + '</span></button>').join('');
    const selected = picker.selected;
    $('project-selection').innerHTML = '<span>Selected project</span><strong>' + esc(selected?.title || 'No project') + '</strong><small>' + esc(selected?.id ? selected.context : 'This task will not belong to a project.') + '</small><div><button id="project-change" type="button" class="text-button">Change project</button>' + (selected?.id ? '<button id="project-clear" type="button" class="text-button">No project</button>' : '') + '</div>';
  }
  function selectProjectOption(index) {
    const picker = actionEditor?.project;
    if (!picker || !canAct() || actionEditor.uncertain) return;
    const selected = picker.rows[index]; if (!selected) return;
    picker.selected = selected.id ? selected : null; picker.open = false; picker.activeIndex = -1; picker.query = '';
    $('action-field-projectSearch').value = '';
    renderProjectPicker(); $('action-field-notes').focus();
  }
  function projectPickerKey(event) {
    const picker = actionEditor?.project;
    if (!picker || event.target.name !== 'projectSearch' || !canAct() || actionEditor.uncertain) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); picker.open = true;
      picker.activeIndex = event.key === 'Home' ? 0 : event.key === 'End' ? picker.rows.length - 1
        : event.key === 'ArrowDown' ? Math.min(picker.activeIndex + 1, picker.rows.length - 1)
        : picker.activeIndex < 0 ? picker.rows.length - 1 : Math.max(0, picker.activeIndex - 1);
      renderProjectPicker(); $('project-option-' + picker.activeIndex)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault(); if (picker.open && picker.activeIndex >= 0) selectProjectOption(picker.activeIndex);
    } else if (event.key === 'Escape' && picker.open) {
      event.preventDefault(); event.stopPropagation(); picker.open = false; picker.activeIndex = -1; renderProjectPicker();
    } else if (event.key === 'Tab' && picker.open) {
      picker.open = false; picker.activeIndex = -1; renderProjectPicker();
    }
  }
  function openTaskEditor(taskId) {
    const task = taskId ? data?.tasks.find((t) => t.id === taskId) : null;
    if (!canAct() || (taskId && !task)) return;
    const catalog = projectCatalog(data);
    const selected = catalog.find((row) => row.id === task?.projectId) || (task?.projectId ? { id: task.projectId, title: 'Unavailable project', context: task.projectId } : null);
    const picker = { catalog, selected, query: '', rows: [], activeIndex: -1, open: false };
    openActionEditor({ title: task ? "Edit task" : "New task", submit: task ? "Save changes" : "Create task", action: task ? "task.update" : "task.create",
      description: task ? "Update the task without changing its source links unless you edit its notes." : "Give this task a clear outcome. You can start a focus session on it next.",
      fields: field('Title', inputControl('title', task?.title, 'required maxlength="500"')) + field('Search projects', inputControl('projectSearch', '', 'type="search" maxlength="500" role="combobox" aria-autocomplete="list" aria-controls="project-results" aria-expanded="false" aria-describedby="project-search-help project-search-status" autocomplete="off" autocapitalize="off"')) + '<p id="project-search-help" class="focus-help">Search project names, IDs, or products. Searching keeps the selection below until you choose a result.</p><p id="project-search-status" class="focus-help" role="status" aria-live="polite"></p><div id="project-results" class="focus-results" role="listbox" aria-label="Project search results" hidden></div><div id="project-selection" class="focus-selection"></div>' + field('Notes · optional', notesControl('notes', task?.notes)),
      input: (form) => taskEditorInput(form, task, picker.selected),
    });
    actionEditor.project = picker; renderProjectPicker();
  }
  function openProjectEditor() {
    if (!canAct() || data?.capabilities?.projectCreate !== true) return;
    const products = '<option value="">No product</option>' + data.products.map((product) => '<option value="' + esc(product.id) + '">' + esc(product.name) + ' · ' + esc(product.id) + '</option>').join('');
    openActionEditor({ title: 'New project', submit: 'Create project', action: 'project.create',
      description: 'Create a project for related tasks and focus sessions. You can connect it to a product or keep it independent.',
      fields: field('Name', inputControl('name', '', 'required maxlength="200"')) + field('Product · optional', '<select name="productId">' + products + '</select>') + field('Goal · optional', '<textarea name="goal" rows="2" maxlength="2000"></textarea>') + field('Notes · optional', notesControl('notes', '')),
      input: projectCreateInput,
    });
  }
  function toggleTask(taskId) {
    const task = data?.tasks.find((t) => t.id === taskId);
    if (!task || !canAct()) return;
    const completing = task.status === "open";
    const timer = completing && data.activeTimer?.taskId === task.id ? data.activeTimer : null;
    const title = timer ? "Stop and complete task" : completing ? "Complete task" : "Reopen task";
    openActionEditor({ title, submit: title, action: "task.update", immediate: !timer,
      description: timer ? 'The current session on “' + task.title + '” will be saved and the task marked complete.' : task.title,
      input: () => ({ taskId: task.id, expectedRevision: task.revision, status: completing ? "done" : "open", ...(timer ? { expectedTimerRevision: timer.revision } : {}) }),
    });
  }
  function openTimeEditor(entryId) {
    const entry = entryId ? data?.entries.find((e) => e.id === entryId) : null;
    if (!canAct() || (entryId && !entry)) return;
    if (!data.tasks.length) { openTaskEditor(); actionFeedback("Create a task before recording time."); return; }
    const end = entry?.end || new Date().toISOString();
    const start = entry?.start || new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const startValue = localInputValue(start), endValue = localInputValue(end);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    openActionEditor({ title: entry ? "Edit time entry" : "Log time", submit: entry ? "Save time entry" : "Record time", action: entry ? "time.update" : "time.log",
      description: "Dates and times use " + zone + ". This records a work session without changing your running focus timer.",
      fields: field("Task", '<select name="taskId" required>' + taskOptions(entry?.taskId || data.activeTimer?.taskId) + '</select>') + '<div class="form-grid">' + field("Start", inputControl("start", startValue, 'type="datetime-local" step="1" required')) + field("End", inputControl("end", endValue, 'type="datetime-local" step="1" required')) + '</div>' + field("Work note · optional", notesControl("note", entry?.note)),
      input: (form) => {
        const startInput = String(form.get("start")), endInput = String(form.get("end"));
        const from = entry && timeInputToIso(startInput) === timeInputToIso(startValue) ? entry.start : timeInputToIso(startInput);
        const to = entry && timeInputToIso(endInput) === timeInputToIso(endValue) ? entry.end : timeInputToIso(endInput);
        if (new Date(to) < new Date(from) || (!entry && new Date(to).getTime() === new Date(from).getTime())) throw new Error("End must be after start.");
        return { ...(entry ? { entryId: entry.id, expectedRevision: entry.revision } : {}), taskId: form.get("taskId"), start: from, end: to, note: String(form.get("note") || "") };
      },
    });
  }
  async function submitAction(event) {
    event.preventDefault();
    const editor = actionEditor;
    if (!editor || !canAct() || (editor.action === "project.create" && data?.capabilities?.projectCreate !== true)) return;
    const errorEl = $("action-error");
    let dispatched = false;
    try {
      const input = editor.uncertain ? editor.request.body.input : editor.input(new FormData($("action-form")));
      editor.request = actionRequest(editor.request, editor.action, input);
      actionBusy = true; refreshActionControls();
      errorEl.hidden = true; $("action-submit").textContent = "Saving…";
      dispatched = true;
      const res = await fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(editor.request.body), cache: "no-store", signal: AbortSignal.timeout(20000) });
      const receipt = await res.json();
      if (!res.ok) {
        if (res.status === 401) { authExpired = true; throw Object.assign(new Error("Your session expired. Sign in again, then retry this request."), { known: true }); }
        const reason = actionErrorMessage(receipt.code || receipt.error, String(receipt.error || "The change could not be saved."));
        const changed = res.status === 409 && editor.action !== "project.create" && !editor.action.startsWith("automation.") && !editor.action.startsWith("review.");
        const message = changed ? reason + " Your draft is preserved. Close this form and reopen it to use the latest version." : reason;
        throw Object.assign(new Error(message), { known: res.status < 500 });
      }
      if (receipt.ok !== true || receipt.requestId !== editor.request.body.requestId) throw new Error("Invalid action receipt");
      editor.uncertain = false;
      const successMessage = editor.onSuccess?.(receipt.result);
      $("action-dialog").close(); actionEditor = null;
      actionFeedback(successMessage || (editor.action === "automation.run" ? "Queued. Follow progress in Today." : editor.action === "review.resolve" ? "Category saved. Gmail changes are queued; follow progress in Today." : "Saved. Your agents will see this change too."));
      await refresh();
      if (data?.capabilities?.automation) await refreshAutomation();
      if (!dataAvailable) actionFeedback("Saved. Waiting for the latest dashboard data.");
    } catch (error) {
      editor.uncertain = dispatched && error.known !== true;
      errorEl.textContent = editor.uncertain ? "The response could not be confirmed. Retry sends the same request safely; your form is locked until it is confirmed." : error.message;
      errorEl.hidden = false;
      if (!editor.uncertain && dispatched) { editor.request = null; await refresh(); }
    } finally {
      actionBusy = false;
      if (actionEditor === editor) $("action-submit").textContent = editor.uncertain ? "Retry same request" : editor.submit;
      refreshActionControls();
    }
  }

  // ---- scheduled reviews and daily briefing ----
  let automation = null;
  let automationAvailable = false;
  let automationSequence = 0;
  const REVIEW_CATEGORIES = ["ACTION/NOW", "ACTION/SOON", "WAITING", "CALENDAR", "FINANCE/RECEIPT", "LEGAL/COMPLIANCE", "FYI/READ", "NEWSLETTER", "SPAM/SUSPECT"];
  function reviewPercent(value, threshold) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return null;
    const rounded = Number((value * 100).toFixed(2));
    return typeof threshold === 'number' && value < threshold && rounded >= threshold * 100 ? '<' + Number((threshold * 100).toFixed(2)) + '%' : rounded + '%';
  }
  function reviewIsPolicy(review) { return review?.source === 'policy' || review?.model === 'policy'; }
  function reviewHoldText(item) {
    if (item.reason !== 'LOW_CONFIDENCE') return reviewOutcomeText(item.reason);
    const classification = item.classification;
    const confidence = reviewPercent(classification?.confidence, classification?.minimumConfidence), threshold = reviewPercent(classification?.minimumConfidence);
    return confidence && threshold ? 'Jev confidence ' + confidence + '; automatic filing currently requires at least ' + threshold + '.' : 'Classifier confidence was below the automatic-filing threshold. Classification diagnostics are not available here.';
  }
  function reviewSuggestions(item) {
    const classification = item.classification, review = item.agentReview;
    const initial = classification?.category ? '<p class="review-suggestion">Jev suggested: ' + esc(classification.category) + '</p>' : item.category ? '<p class="review-suggestion">Recorded category: ' + esc(item.category) + '</p>' : '';
    const subsequent = reviewIsPolicy(review) ? 'Review blocked by policy' : review ? 'Claude proposal: ' + (review.category || 'No clear category') : 'No Claude review recorded for this version';
    return initial + '<p class="review-suggestion">' + esc(subsequent) + '</p>';
  }
  function reviewDiagnostics(item) {
    const classification = item.classification;
    const scores = classification?.probabilities && typeof classification.probabilities === 'object' ? Object.entries(classification.probabilities).filter(([category, value]) => REVIEW_CATEGORIES.includes(category) && reviewPercent(value) !== null).sort((a, b) => b[1] - a[1] || REVIEW_CATEGORIES.indexOf(a[0]) - REVIEW_CATEGORIES.indexOf(b[0])).slice(0, 3) : [];
    const table = scores.length ? '<table class="review-score-table"><caption>Top recorded category probabilities</caption><thead><tr><th scope="col">Category</th><th scope="col">Probability</th></tr></thead><tbody>' + scores.map(([category, value]) => '<tr><th scope="row">' + esc(category) + '</th><td>' + esc(reviewPercent(value)) + '</td></tr>').join('') + '</tbody></table><p>Confidence summarizes the category probabilities and is separate from the selected category’s probability. Automatic filing checks the confidence.</p>' : '<p>Category probabilities were not recorded for this item.</p>';
    return '<section class="review-context review-diagnostics" aria-label="Why held"><h3>Why held</h3><p class="review-hold-reason">' + esc(reviewHoldText(item)) + '</p>' +
      (classification ? '<p>Jev suggested: <strong>' + esc(classification.category) + '</strong></p><p>Model: ' + esc(classification.model) + '</p>' + (item.reason !== 'LOW_CONFIDENCE' ? '<p>Recorded Jev confidence: ' + esc(reviewPercent(classification.confidence) || 'not recorded') + '. Current confidence requirement: ' + esc(reviewPercent(classification.minimumConfidence) || 'not recorded') + '.</p>' : '') + table + '<p>Jev returned scores, not a written explanation.</p>' : '<p>' + (item.reason === 'INSUFFICIENT_OR_TRUNCATED_CONTEXT' ? 'The context check stopped classification before Jev produced a result.' : 'No original Jev classification details are available for this item.') + '</p>') + '</section>';
  }
  function reviewRationale(review) {
    if (!review) return '<div class="review-context review-rationale"><h3>Claude review</h3><p>No Claude review is recorded for this version of the conversation.</p></div>';
    if (reviewIsPolicy(review)) return '<div class="review-context review-rationale"><h3>Review blocked by policy</h3><p class="rationale-text">' + esc(reviewOutcomeText(review.reason)) + '</p><p>' + jobTime(review.createdAt) + '</p><p>This is a recorded policy check, not a Claude explanation.</p></div>';
    const confidence = reviewPercent(review.confidence, review.minimumConfidence), threshold = reviewPercent(review.minimumConfidence);
    const checks = { accepted: 'Claude confidence and clarity checks passed. This does not confirm Gmail changes.', needs_context: 'Claude requested more context.', not_clear: 'Claude did not mark the category as clear.', no_category: 'Claude did not choose a category.', below_threshold: 'Claude confidence did not meet the automatic-review requirement.' };
    const flags = typeof review.clear === 'boolean' && typeof review.needsMoreContext === 'boolean' ? '<p>Clear category: ' + (review.clear ? 'yes' : 'no') + '. More context requested: ' + (review.needsMoreContext ? 'yes' : 'no') + '.</p>' : '<p>The clear-category and context checks were not recorded for this review.</p>';
    return '<div class="review-context review-rationale"><h3>Claude review</h3><p>Proposal: <strong>' + esc(review.category || 'No clear category') + '</strong></p><p class="rationale-text">' + esc(review.reason) + '</p>' +
      '<p>' + (confidence ? 'Recorded confidence: ' + esc(confidence) + (threshold ? '; automatic review currently requires at least ' + esc(threshold) : '') + '.' : 'Confidence was not recorded for this review.') + '</p>' + flags +
      (checks[review.gateReason] ? '<p>' + esc(checks[review.gateReason]) + '</p>' : '') + '<p>Model: ' + esc(review.model) + ' · ' + jobTime(review.createdAt) + '</p><p>Choose the category you want to apply.</p></div>';
  }
  function decisionHistory(decisions, open) {
    if (!Array.isArray(decisions) || !decisions.length) return '';
    return '<details class="decision-history"' + (open ? ' open' : '') + '><summary>Recent classification decisions · ' + decisions.length + '</summary>' + decisions.slice(0, 20).map((decision) => '<div class="review-context review-rationale"><strong>' + esc(decision.category || 'No clear category') + ' · ' + esc(jobStatus(decision.state)) + '</strong><p>' + esc(decision.account) + '</p><p class="rationale-text">' + esc(decision.reason) + '</p><p>' + esc(decision.model) + ' · ' + jobTime(decision.createdAt) + '</p></div>').join('') + '</details>';
  }
  function renderAutomation() {
    const supported = !!data?.capabilities?.automation;
    $("automation-panel").hidden = !supported;
    $("review-queue").hidden = !supported || data?.capabilities?.reviewQueue === true;
    $("review-workspace").hidden = data?.capabilities?.reviewQueue !== true;
    if (!supported) return;
    if (!automation) {
      $("automation-panel").innerHTML = '<h3>Daily workflow</h3><p class="mutetext">' + (automationAvailable ? 'Loading…' : 'Automation status is unavailable. Retrying automatically.') + '</p>';
      return;
    }
    const schedule = automation.schedule;
    const runs = Array.isArray(automation.runs) ? automation.runs : [];
    const deliveries = Array.isArray(automation.deliveries) ? automation.deliveries : [];
    const delivery = deliveries[0];
    const latest = runs[0];
    const historyOpen = $("automation-panel").querySelector(".job-history")?.open;
    const decisionsOpen = $("automation-panel").querySelector(".decision-history")?.open;
    const status = automation.paused ? "paused for maintenance" : !automation.configured ? "Workflow setup needed" : schedule.enabled ? "Daily workflow enabled" : "Daily workflow paused";
    $("automation-panel").innerHTML = '<div class="operations-top"><div><h3>Daily workflow</h3><p>After Gmail triage · fallback ' + esc(schedule.localTime) + ' Eastern</p></div>' + jobBadge(status) + '</div>' +
      (!automationAvailable ? '<p class="form-error">Status is stale. Reconnect before running an automation.</p>' : '') +
      '<p class="automation-summary">' + (schedule.reviewEnabled ? 'Review held email' : 'Email review paused') + ' · ' + (schedule.briefEnabled ? 'Prepare and email the daily brief' : 'Daily brief paused') + '</p>' +
      '<div class="section-actions"><button class="action-button" type="button" data-write-control data-automation-run="daily">Run daily workflow</button><button class="quiet-button" type="button" data-write-control data-automation-run="review">Run email review</button><button class="quiet-button" type="button" data-write-control data-automation-run="brief">Generate &amp; email brief</button><button class="text-button" type="button" data-write-control data-automation-settings>Schedule settings</button></div>' +
      '<dl class="job-summary"><div><dt>Latest run</dt><dd>' + (latest ? jobBadge(latest.state) + ' · ' + esc(latest.kind) : 'No runs yet') + '</dd></div>' +
      '<div><dt>Brief email</dt><dd>' + (delivery ? jobBadge(delivery.state) : 'No delivery yet') + '</dd></div>' +
      '<div><dt>Next fallback</dt><dd>' + (schedule.enabled ? jobTime(schedule.nextRunAt) : 'Paused') + '</dd></div></dl>' +
      (delivery ? '<p class="automation-detail">' + esc(delivery.day) + ' · ' + esc(delivery.recipient) + (delivery.sentAt ? ' · sent ' + jobTime(delivery.sentAt) : '') + (delivery.state === 'uncertain' ? ' · Delivery is being checked before another send is attempted.' : '') + '</p>' : '') +
      (latest ? '<p class="automation-detail">' + count(latest.reviewed) + ' reviewed · ' + count(latest.applied) + ' applied · ' + count(latest.held) + ' held for you · ' + count(latest.failed) + ' failed' + (latest.nextAttemptAt ? ' · next attempt ' + jobTime(latest.nextAttemptAt) : '') + (latest.errorCode ? ' · ' + esc(actionErrorMessage(latest.errorCode)) : '') + '</p>' : '') +
      (runs.length ? '<details class="job-history"' + (historyOpen ? ' open' : '') + '><summary>Workflow history · ' + runs.length + '</summary><div class="automation-history">' + runs.slice(0, 12).map((run) => '<div class="automation-history-row"><span>' + esc(run.kind) + '<small>' + jobTime(run.startedAt || run.createdAt) + '</small></span>' + jobBadge(run.state) + '<span>' + count(run.applied) + ' applied · ' + count(run.held) + ' held</span></div>').join('') + '</div></details>' : '') + decisionHistory(automation.recentDecisions, decisionsOpen);
    const reviews = (automation.reviews || []).filter((item) => !item.resolvedAt);
    const backlog = automation.backlog;
    const total = backlog ? count(backlog.total) : reviews.length;
    $("review-queue").innerHTML = '<div class="portfolio-heading"><div><h2>Held conversations</h2><p class="mutetext">Held messages stay in your inbox until a category is resolved.</p></div><span class="chip">' + total + ' held</span></div>' +
      (backlog ? '<p class="automation-detail">' + count(backlog.awaitingAgent) + ' awaiting Claude review · ' + count(backlog.needsDecision) + ' need your decision · ' + count(backlog.needsContext) + ' need more context</p>' : '') +
      (total > reviews.length ? '<p class="mutetext">Showing ' + reviews.length + ' of ' + total + ' held conversations.</p>' : '') +
      (reviews.length ? '<div class="review-list panel">' + reviews.map((item) => '<article class="review-row"><div><h3>' + esc(item.subject || '(No subject)') + '</h3><p>' + esc(item.sender) + ' · ' + esc(item.account) + '</p><p class="review-reason">' + esc(jobStatus(item.reason)) + (item.category ? ' · suggested ' + esc(item.category) : '') + '</p></div><button class="quiet-button" type="button" data-write-control data-review-item="' + esc(item.id) + '"' + (item.reviewable === false ? ' data-review-unavailable' : '') + '>' + (item.reviewable === false ? 'Not actionable' : 'Review classification') + '</button></article>').join('') + '</div>' : '<p class="mutetext">No decisions are waiting for your review.</p>');
    refreshActionControls();
  }
  async function refreshAutomation() {
    if (!data?.capabilities?.automation) { renderAutomation(); return; }
    const sequence = ++automationSequence;
    try {
      const res = await fetch('/api/automation', { cache: 'no-store' });
      if (sequence === automationSequence && res.status === 401) authExpired = true;
      if (!res.ok) throw new Error('Automation unavailable');
      const snapshot = await res.json();
      if (!snapshot.schedule || !Array.isArray(snapshot.runs) || !Array.isArray(snapshot.reviews)) throw new Error('Invalid automation status');
      if (sequence !== automationSequence) return;
      automation = snapshot; automationAvailable = true;
    } catch {
      if (sequence !== automationSequence) return;
      automationAvailable = false;
    }
    renderAutomation(); renderToday(); refreshActionControls();
  }
  function openAutomationRun(kind) {
    if (!automationAvailable || !automation?.configured || automation.paused) return;
    const labels = { daily: 'Run daily workflow', review: 'Run email review', brief: 'Generate & email brief' };
    if (!Object.hasOwn(labels, kind)) return;
    const description = kind === 'review' ? 'Claude will review eligible held Gmail conversations. Clear decisions can apply the permitted labels and archive actions; ambiguous messages stay for you.'
      : kind === 'brief' ? 'Create today’s briefing and email it to your configured address. An existing briefing or delivery for today is reused so it is not sent twice.'
      : 'Run the enabled email-review and daily-brief stages. The brief is emailed to your configured address; today’s existing delivery is reused.';
    openActionEditor({ title: labels[kind], description, submit: labels[kind], action: 'automation.run', input: () => ({ kind }) });
  }
  function openScheduleEditor() {
    if (!automationAvailable || !automation || automation.paused) return;
    const schedule = automation.schedule;
    const checkbox = (name, checked, label) => '<label class="form-check"><input type="checkbox" name="' + name + '"' + (checked ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
    openActionEditor({ title: 'Daily workflow settings', description: 'The workflow follows scheduled Gmail triage. The Eastern fallback time starts it if the triage handoff was missed. Manual runs remain available when the schedule is paused.', submit: 'Save schedule', action: 'automation.schedule',
      fields: checkbox('enabled', schedule.enabled, 'Enable the daily workflow') + field('Fallback time · Eastern', inputControl('localTime', schedule.localTime || '07:00', 'type="time" required')) + checkbox('reviewEnabled', schedule.reviewEnabled, 'Review held email with Claude') + checkbox('briefEnabled', schedule.briefEnabled, 'Prepare and email the daily brief'),
      input: (form) => ({ enabled: form.has('enabled'), localTime: String(form.get('localTime')), reviewEnabled: form.has('reviewEnabled'), briefEnabled: form.has('briefEnabled') }),
    });
  }
  function openReviewEditor(itemId) {
    const item = automation?.reviews?.find((candidate) => candidate.id === itemId && !candidate.resolvedAt);
    if (!item || item.reviewable === false || !automationAvailable || automation.paused) return;
    const source = 'https://mail.google.com/mail/u/?authuser=' + encodeURIComponent(item.account) + '#all/' + encodeURIComponent(item.threadId);
    const suggested = item.agentReview?.category || item.category;
    const options = '<option value="" disabled' + (REVIEW_CATEGORIES.includes(suggested) ? '' : ' selected') + '>Choose a category</option>' + REVIEW_CATEGORIES.map((category) => '<option value="' + esc(category) + '"' + (category === suggested ? ' selected' : '') + '>' + esc(category) + '</option>').join('');
    openActionEditor({ title: 'Review email category', description: 'Your choice queues the permitted Gmail labels and archive actions for this conversation. Action categories can also create follow-up tasks.', submit: 'Apply this category', action: 'review.resolve',
      fields: '<div class="review-context"><strong>' + esc(item.subject || '(No subject)') + '</strong><p>' + esc(item.sender) + '</p><p>' + esc(item.account) + '</p><p>' + esc(jobStatus(item.reason)) + '</p><a href="' + esc(source) + '" target="_blank" rel="noopener noreferrer">Open conversation in Gmail</a></div>' + reviewRationale(item.agentReview) + field('Category', '<select name="category" required>' + options + '</select>'),
      input: (form) => ({ itemId: item.id, category: String(form.get('category')) }),
    });
  }

  // ---- paged email review workspace ----
  const REVIEW_BUCKET_LABELS = { awaitingAgent: 'Awaiting Claude', needsDecision: 'Needs your decision', needsContext: 'Needs more context', queued: 'Changes queued' };
  const reviewWorkspace = { snapshot: null, accounts: [], available: false, loading: false, filters: { bucket: 'all', search: '', account: '', category: '' }, cursors: [null], page: 0, selected: new Map(), sequence: 0, controller: null, notice: '', error: '', latestCommand: null };
  let reviewDetailSequence = 0, reviewDetailController = null, reviewDetailItem = null;
  function reviewActionable(item) { return item?.reviewable === true && typeof item.revision === 'string' && !!item.revision && item.bucket !== 'queued'; }
  function reviewCanWrite() { return data?.capabilities?.reviewQueue === true && canAct() && reviewWorkspace.available && automationAvailable && !automation?.paused; }
  function reviewQueueQuery(filters, cursor) {
    const query = new URLSearchParams({ bucket: filters.bucket || 'all', limit: '50' });
    for (const key of ['search', 'account', 'category']) if (filters[key]) query.set(key, filters[key]);
    if (cursor) query.set('cursor', cursor);
    return query.toString();
  }
  function stableReviewSelection(selected, items) {
    const current = new Map(items.map((item) => [item.id, item]));
    return new Map([...selected].filter(([id, item]) => reviewActionable(current.get(id)) && current.get(id).revision === item.revision).map(([id]) => [id, current.get(id)]));
  }
  function bulkReviewInput(items, category, rememberPreference) {
    if (!items.length || items.length > 50 || new Set(items.map((item) => item.id)).size !== items.length) throw new Error('Choose between 1 and 50 different conversations.');
    if (!REVIEW_CATEGORIES.includes(category)) throw new Error('Choose the category to apply.');
    if (items.some((item) => !reviewActionable(item))) throw new Error('Some conversations are no longer actionable. Refresh the queue and inspect them again.');
    return { items: items.map((item) => ({ itemId: item.id, revision: item.revision, category })), rememberPreference: rememberPreference === true };
  }
  function reviewCategoryEffect(category, total) {
    if (!REVIEW_CATEGORIES.includes(category)) return 'Choose a category to see the changes for ' + total + (total === 1 ? ' conversation.' : ' conversations.');
    const effects = ['Apply ' + category + ', remove other LifeOS category labels, and archive the reviewed messages.'];
    if (['ACTION/NOW', 'ACTION/SOON', 'WAITING', 'LEGAL/COMPLIANCE'].includes(category)) effects.push('Star these messages.');
    if (['ACTION/NOW', 'ACTION/SOON'].includes(category)) effects.push('Create or update a LifeOS follow-up task.');
    if (category === 'SPAM/SUSPECT') effects.push('This applies a label; it does not report spam.');
    return effects.join(' ');
  }
  function reviewSource(item) { return 'https://mail.google.com/mail/u/?authuser=' + encodeURIComponent(item.account) + '#all/' + encodeURIComponent(item.threadId); }
  function reviewOutcomeText(code) {
    const known = { LOW_CONFIDENCE: 'Classifier confidence was below the automatic-filing threshold.', REVIEW_STALE: 'Conversation changed; inspect it again.', REVIEW_EVIDENCE_CHANGED: 'Conversation changed; inspect it again.', REVIEW_REVISION_MISMATCH: 'Conversation changed; inspect it again.', REVIEW_CONTEXT_CHANGED: 'Conversation changed; inspect it again.', MAIL_CHANGED_SINCE_DISCOVERY: 'Gmail labels changed after the conversation was captured.', MAIL_CHANGED_BEFORE_APPLY: 'The conversation or its labels changed before changes could be applied.', GMAIL_POSTCONDITION_CHANGED: 'Gmail no longer matched the expected result; further changes were held.', REVIEW_NOT_ELIGIBLE: 'No longer actionable.', REVIEW_NOT_FOUND: 'No longer in the queue.', REVIEW_CONTEXT_INCOMPLETE: 'More context is needed.', REVIEW_INCOMPLETE_CONTEXT: 'The available message text did not pass the complete-context check.', INSUFFICIENT_OR_TRUNCATED_CONTEXT: 'Message text is missing, truncated, or exceeds the review limit.', REVIEW_IDENTITY_MISMATCH: 'The proposal did not match this conversation and revision.', REVIEW_NOT_CLEAR: 'The proposal did not pass the clear-category and confidence checks.', REVIEW_INVALID_EVIDENCE: 'The proposal did not pass the supporting-message evidence checks.', REVIEW_NOT_RESOLVABLE: 'The current conversation state does not permit another classification.', REVIEW_ALREADY_QUEUED: 'This conversation already has queued changes.', UNCERTAIN_GMAIL_MUTATION: 'Gmail changes need reconciliation before another action.', HUMAN_REVIEW_APPLY_FAILED: 'The Gmail change could not finish. Inspect its current state.', REVIEW_PREFERENCE_CHANGED: 'A sender preference changed. Review the conversation again.' };
    return known[code] || (code ? actionErrorMessage(code, 'This item needs another look. Inspect its latest conversation.') : '');
  }
  function renderReviewCommands(commands) {
    const rows = Array.isArray(commands) ? commands.slice(0, 5) : [];
    const local = reviewWorkspace.latestCommand;
    if (local && !rows.some((item) => item.requestId === local.requestId)) rows.unshift(local);
    $('review-command-progress').innerHTML = rows.map((command) => {
      const items = Array.isArray(command.items) ? command.items : [];
      const totals = {};
      for (const item of items) totals[item.status] = (totals[item.status] || 0) + 1;
      const summary = ['queued', 'accepted', 'applied', 'stale', 'held', 'failed', 'rejected'].filter((status) => totals[status]).map((status) => totals[status] + ' ' + (status === 'accepted' ? 'validated' : status)).join(' · ');
      const issues = items.filter((item) => ['stale', 'held', 'failed', 'rejected'].includes(item.status));
      return '<div class="review-progress"><strong>Category changes · ' + esc(jobStatus(command.state || 'queued')) + '</strong><p>' + esc(summary || 'Waiting for the queue') + '</p>' +
        (issues.length ? '<details><summary>' + issues.length + ' need attention</summary><ul>' + issues.map((item) => '<li>' + esc(jobStatus(item.status)) + (item.code ? ': ' + esc(reviewOutcomeText(item.code)) : '') + ' <button class="text-button" type="button" data-review-inspect="' + esc(item.itemId) + '">Inspect conversation</button></li>').join('') + '</ul><p>Changed or rejected conversations were not approved by this selection. Inspect the latest context before retrying.</p></details>' : '') +
        (items.some((item) => item.preferenceSaved) ? '<p>Confirmed sender preferences were saved for future review guidance.</p>' : '') + '</div>';
    }).join('');
  }
  function refreshReviewControls() {
    if (!data?.capabilities?.reviewQueue) return;
    const state = reviewWorkspace, actionable = (state.snapshot?.items || []).filter(reviewActionable);
    const check = $('review-select-page'), selected = state.selected.size;
    check.disabled = !reviewCanWrite() || !actionable.length;
    check.checked = actionable.length > 0 && actionable.every((item) => state.selected.has(item.id));
    check.indeterminate = selected > 0 && !check.checked;
    $('review-selection-count').textContent = selected + ' selected on this page';
    $('review-bulk-button').disabled = !reviewCanWrite() || !selected;
    $('review-clear').disabled = !selected || actionBusy;
    $('review-previous').disabled = state.loading || !state.page;
    $('review-next').disabled = state.loading || !state.available || !state.snapshot?.nextCursor;
    document.querySelectorAll('[data-review-select]').forEach((node) => { const item = state.snapshot?.items.find((row) => row.id === node.dataset.reviewSelect); node.disabled = !reviewCanWrite() || !reviewActionable(item); node.checked = state.selected.has(node.dataset.reviewSelect); });
    document.querySelectorAll('[data-review-forget], [data-review-detail-apply]').forEach((node) => { node.disabled = !reviewCanWrite() || (node.hasAttribute('data-review-detail-apply') && !reviewActionable(reviewDetailItem)); });
    if (actionEditor?.action === 'review.bulkResolve' || actionEditor?.action === 'review.forgetPreference') $('action-submit').disabled = !reviewCanWrite();
  }
  function renderReviewWorkspace() {
    const state = reviewWorkspace, snapshot = state.snapshot;
    $('review-workspace').hidden = data?.capabilities?.reviewQueue !== true;
    if ($('review-workspace').hidden) return;
    const counts = snapshot?.counts || snapshot?.backlog;
    $('review-total').textContent = counts ? count(counts.total) + ' held' : 'Review queue';
    $('review-backlog').textContent = counts ? count(counts.awaitingAgent) + ' awaiting Claude · ' + count(counts.needsDecision) + ' need your decision · ' + count(counts.needsContext) + ' need more context · ' + count(counts.queued) + ' queued' : 'Conversations stay held until a category is explicitly chosen or a review completes.';
    const account = $('review-account'), accounts = state.accounts;
    const accountSignature = JSON.stringify(accounts);
    if (account.dataset.options !== accountSignature) { const selected = account.value; account.innerHTML = '<option value="">All accounts</option>' + accounts.map((value) => '<option value="' + esc(value) + '">' + esc(value) + '</option>').join(''); account.value = selected; account.dataset.options = accountSignature; }
    if (!$('review-category').dataset.ready) { $('review-category').innerHTML = '<option value="">All categories</option>' + REVIEW_CATEGORIES.map((category) => '<option value="' + esc(category) + '">' + esc(category) + '</option>').join(''); $('review-category').dataset.ready = 'true'; }
    const items = snapshot?.items || [], results = $('review-results');
    const focused = document.activeElement, focusedId = focused?.dataset?.reviewSelect || focused?.dataset?.reviewInspect;
    const focusedType = focused?.hasAttribute?.('data-review-select') ? 'data-review-select' : 'data-review-inspect';
    results.setAttribute('aria-busy', String(state.loading));
    results.innerHTML = items.length ? items.map((item) => {
      return '<article class="review-conversation"><label class="review-check"><input type="checkbox" data-review-select="' + esc(item.id) + '" aria-label="Select ' + esc(item.subject || 'conversation without subject') + '"' + (state.selected.has(item.id) ? ' checked' : '') + (!reviewActionable(item) ? ' disabled' : '') + '></label><div><h3>' + esc(item.subject || '(No subject)') + '</h3><p>' + esc(item.sender) + '</p><p>' + esc(item.account) + ' · ' + jobTime(item.createdAt) + '</p>' + reviewSuggestions(item) + '</div><div class="review-conversation-status">' + jobBadge(REVIEW_BUCKET_LABELS[item.bucket] || 'Held for review') + '<p>' + esc(reviewHoldText(item)) + '</p></div><button class="quiet-button" type="button" data-review-inspect="' + esc(item.id) + '">Inspect conversation</button></article>';
    }).join('') : '<p class="review-empty">' + (state.loading && !snapshot ? 'Loading conversations…' : snapshot ? 'No conversations match these filters. Try another search or reset the filters.' : 'The review queue is unavailable. Retry after the connection is ready.') + '</p>';
    if (focusedId && results.contains(focused) === false && focused?.isConnected === false) [...results.querySelectorAll('[' + focusedType + ']')].find((node) => node.getAttribute(focusedType) === focusedId)?.focus({ preventScroll: true });
    const status = $('review-queue-status');
    status.textContent = state.error || state.notice || (state.loading ? 'Refreshing the queue…' : snapshot ? snapshot.total + ' matching conversations. Selections apply only to this page.' : '');
    status.classList.toggle('is-error', !!state.error);
    $('review-page-label').textContent = 'Page ' + (state.page + 1) + (snapshot ? ' · ' + items.length + ' shown of ' + snapshot.total : '');
    renderReviewCommands(snapshot?.pendingCommands);
    const preferences = snapshot?.preferences || [];
    $('review-preferences').hidden = !preferences.length;
    $('review-preference-list').innerHTML = preferences.map((item) => '<div class="review-preference"><div><strong>' + esc(item.sender) + '</strong><p>' + esc(item.account) + ' · ' + esc(item.category) + '</p></div><button class="quiet-button" type="button" data-review-forget="' + esc(item.id) + '">Forget preference</button></div>').join('');
    refreshReviewControls();
  }
  async function refreshReviewQueue() {
    if (data?.capabilities?.reviewQueue !== true || currentTab() !== 'triage' || document.hidden) return;
    const state = reviewWorkspace, sequence = ++state.sequence;
    state.controller?.abort(); state.controller = new AbortController(); state.loading = true;
    renderReviewWorkspace();
    try {
      const res = await fetch('/api/reviews?' + reviewQueueQuery(state.filters, state.cursors[state.page]), { cache: 'no-store', signal: AbortSignal.any([state.controller.signal, AbortSignal.timeout(20000)]) });
      if (sequence !== state.sequence) return;
      if (res.status === 401) authExpired = true;
      if (!res.ok) throw new Error(res.status === 401 ? 'Sign in again to load your review queue.' : 'The queue could not refresh. Your selections cannot be applied until it reconnects.');
      const snapshot = await res.json();
      if (!Array.isArray(snapshot.items) || snapshot.items.length > 50 || !Number.isSafeInteger(snapshot.total) || snapshot.total < 0) throw new Error('The queue response could not be read. Try refreshing again.');
      if (sequence !== state.sequence) return;
      const selected = stableReviewSelection(state.selected, snapshot.items), removed = state.selected.size - selected.size;
      state.selected = selected; state.snapshot = snapshot; state.accounts = snapshot.accounts || state.accounts; state.available = true; state.error = '';
      if (removed) state.notice = removed + (removed === 1 ? ' selection was' : ' selections were') + ' cleared because the conversation changed or left this page. Inspect it again before applying a category.';
      if (state.latestCommand && snapshot.pendingCommands?.some((item) => item.requestId === state.latestCommand.requestId)) state.latestCommand = null;
    } catch (error) {
      if (sequence !== state.sequence) return;
      state.available = false; state.error = error.message || 'The queue is unavailable. Retry after reconnecting.';
    } finally { if (sequence === state.sequence) { state.loading = false; renderReviewWorkspace(); refreshActionControls(); } }
  }
  function changeReviewPage(direction) {
    const state = reviewWorkspace;
    if (state.loading || (direction > 0 && !state.snapshot?.nextCursor) || (direction < 0 && state.page === 0)) return;
    if (direction > 0) { state.cursors = state.cursors.slice(0, state.page + 1); state.cursors.push(state.snapshot.nextCursor); }
    state.page += direction;
    state.notice = state.selected.size ? 'Selection cleared. Choose conversations on this page.' : '';
    state.selected.clear(); state.available = false; state.snapshot = null;
    void refreshReviewQueue();
  }
  function searchReviewQueue(reset = false) {
    const state = reviewWorkspace;
    if (reset) $('review-search-form').reset();
    const form = new FormData($('review-search-form'));
    state.filters = { bucket: String(form.get('bucket') || 'all'), search: String(form.get('search') || '').trim(), account: String(form.get('account') || ''), category: String(form.get('category') || '') };
    state.cursors = [null]; state.page = 0;
    state.notice = state.selected.size ? 'Selection cleared for the new search.' : '';
    state.selected.clear(); state.available = false; state.snapshot = null;
    void refreshReviewQueue();
  }
  function selectReviewItem(id, checked) {
    if (!reviewCanWrite()) return;
    const state = reviewWorkspace, item = state.snapshot?.items.find((row) => row.id === id);
    if (!checked) state.selected.delete(id);
    else if (reviewActionable(item) && state.selected.size < 50) state.selected.set(id, item);
    state.notice = ''; refreshReviewControls();
  }
  function reviewConversationHtml(detail) {
    const item = detail.item;
    return '<div class="review-context"><p>' + esc(item.sender) + '</p><p>' + esc(item.account) + '</p><p>' + esc(REVIEW_BUCKET_LABELS[item.bucket] || jobStatus(item.reason)) + '</p><a href="' + esc(reviewSource(item)) + '" target="_blank" rel="noopener noreferrer">Open conversation in Gmail</a></div>' +
      reviewDiagnostics(item) + reviewRationale(item.agentReview) +
      (detail.changed ? '<p class="review-effect">The conversation changed since this queue entry was captured. Refresh and review the latest context before applying a category.</p>' : '') +
      (detail.blockedReason ? '<p class="review-effect">' + esc(reviewOutcomeText(detail.blockedReason)) + '</p>' : '') +
      (reviewActionable(item) && !detail.changed && !detail.blockedReason ? '<button class="action-button" type="button" data-review-detail-apply>Choose category for this conversation</button>' : '<p class="mutetext">This conversation cannot be classified from its current context. You can inspect the full conversation in Gmail.</p>') +
      (detail.truncated || (detail.messages || []).some((message) => message.truncated) ? '<p class="automation-detail">Only the available text is shown. Open Gmail for the full conversation and attachments.</p>' : '') +
      (detail.messages || []).map((message) => '<article class="review-message"><h3>' + esc(message.subject || '(No subject)') + '</h3><div class="review-message-meta">From ' + esc(message.from) + '<br>To ' + esc(message.to) + '<br>' + jobTime(message.internalDate) + (message.attachments ? ' · Has attachments; contents are not shown' : '') + '</div><div class="review-message-body">' + esc(message.body || '(No message text available)') + '</div></article>').join('');
  }
  async function openReviewConversation(id) {
    if (!dataAvailable || authExpired) return;
    const sequence = ++reviewDetailSequence;
    reviewDetailController?.abort(); reviewDetailController = new AbortController(); reviewDetailItem = null;
    openDetailDialog('Held conversation', 'Loading conversation…', '<p class="mutetext" role="status">Loading the available message text…</p>');
    $('detail-dialog').classList.add('review-detail-dialog');
    try {
      const res = await fetch('/api/review?itemId=' + encodeURIComponent(id), { cache: 'no-store', signal: AbortSignal.any([reviewDetailController.signal, AbortSignal.timeout(20000)]) });
      if (sequence !== reviewDetailSequence || !$('detail-dialog').open) return;
      if (res.status === 401) authExpired = true;
      if (!res.ok) throw new Error(res.status === 401 ? 'Sign in again to inspect this conversation.' : 'This conversation could not be loaded. Close this panel and refresh the queue.');
      const detail = await res.json();
      if (!detail.item || detail.item.id !== id || !Array.isArray(detail.messages)) throw new Error('The conversation response could not be read. Refresh the queue and try again.');
      if (sequence !== reviewDetailSequence || !$('detail-dialog').open) return;
      reviewDetailItem = detail.changed || detail.blockedReason ? { ...detail.item, reviewable: false } : detail.item;
      if (reviewWorkspace.selected.has(id) && (detail.changed || !reviewActionable(reviewDetailItem) || reviewWorkspace.selected.get(id).revision !== detail.item.revision)) {
        reviewWorkspace.selected.delete(id); reviewWorkspace.notice = 'A changed conversation was removed from your selection.';
      }
      if (reviewWorkspace.snapshot) reviewWorkspace.snapshot.items = reviewWorkspace.snapshot.items.map((item) => item.id === id ? reviewDetailItem : item);
      $('dialog-title').textContent = detail.item.subject || '(No subject)'; $('dialog-body').innerHTML = reviewConversationHtml(detail);
      renderReviewWorkspace(); refreshActionControls();
    } catch (error) {
      if (sequence !== reviewDetailSequence || !$('detail-dialog').open) return;
      $('dialog-body').innerHTML = '<p class="form-error" role="alert">' + esc(error.message) + '</p>';
      refreshActionControls();
    }
  }
  function openBulkReviewEditor(chosen = [...reviewWorkspace.selected.values()]) {
    if (!reviewCanWrite() || !chosen.length || chosen.some((item) => !reviewActionable(item))) return;
    const items = chosen.map((item) => ({ ...item })), total = items.length;
    const options = '<option value="" selected disabled>Choose a category</option>' + REVIEW_CATEGORIES.map((category) => '<option value="' + esc(category) + '">' + esc(category) + '</option>').join('');
    openActionEditor({ title: 'Classify ' + total + (total === 1 ? ' conversation' : ' conversations'), description: 'One category will be applied to every selected conversation after its current messages are checked. Changed or incomplete conversations stay held.', submit: 'Queue category changes', action: 'review.bulkResolve',
      fields: '<ul class="review-confirm-list">' + items.map((item) => '<li>' + esc(item.subject || '(No subject)') + ' · ' + esc(item.sender) + '</li>').join('') + '</ul>' + field('Category for every selected conversation', '<select name="category" required>' + options + '</select>') + '<p id="review-category-effect" class="review-effect">' + esc(reviewCategoryEffect('', total)) + '</p><label class="form-check"><input type="checkbox" name="rememberPreference"><span>Remember this preference</span></label><p class="automation-detail">Use the confirmed sender and category as guidance for future email classifications and reviews. This does not guarantee automatic filing; every conversation still goes through the review rules.</p>',
      input: (form) => {
        if (!reviewCanWrite()) throw new Error('Refresh the queue before applying a category.');
        const current = new Map((reviewWorkspace.snapshot?.items || []).map((item) => [item.id, item]));
        if (items.some((item) => !reviewActionable(current.get(item.id)) || current.get(item.id).revision !== item.revision)) throw new Error('A selected conversation changed. Close this form and inspect the latest queue before applying a category.');
        return bulkReviewInput(items, String(form.get('category') || ''), form.has('rememberPreference'));
      },
      onSuccess: (result) => {
        reviewWorkspace.selected.clear(); reviewWorkspace.latestCommand = result?.reviewCommand || null;
        const receipt = result?.reviewReceipt, queued = (receipt?.items || []).filter((item) => item.status === 'queued').length, rejected = (receipt?.items || []).filter((item) => item.status === 'rejected').length;
        reviewWorkspace.notice = receipt ? queued + ' queued' + (rejected ? ' · ' + rejected + ' rejected; inspect the current conversation before retrying.' : '. Follow per-conversation progress below.') : 'Category changes queued. Follow progress below.';
        void refreshReviewQueue(); return reviewWorkspace.notice;
      }
    });
    if (actionEditor) actionEditor.reviewItems = items;
  }
  function forgetReviewPreference(id) {
    if (!reviewCanWrite()) return;
    const preference = reviewWorkspace.snapshot?.preferences?.find((item) => item.id === id); if (!preference) return;
    openActionEditor({ title: 'Forget sender preference', description: 'Remove this guidance from future email classifications and reviews. Existing Gmail labels and tasks stay as they are.', submit: 'Forget preference', action: 'review.forgetPreference',
      fields: '<div class="review-context"><strong>' + esc(preference.sender) + '</strong><p>' + esc(preference.account) + '</p><p>' + esc(preference.category) + '</p></div>', input: () => ({ preferenceId: id }),
      onSuccess: () => { void refreshReviewQueue(); return 'Sender preference removed.'; }
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
    if (t === 'triage') void refreshReviewQueue();
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
    const edit = event.target.closest("[data-task-edit]"); if (edit) openTaskEditor(edit.dataset.taskEdit);
    const toggle = event.target.closest("[data-task-toggle]"); if (toggle) toggleTask(toggle.dataset.taskToggle);
    const focus = event.target.closest("[data-task-focus]"); if (focus) openFocusEditor(focus.dataset.taskFocus);
  });
  $("today-briefing").addEventListener("click", (event) => {
    if (event.target.closest("#briefing-full-button")) openBriefingDialog();
  });
  $("recent-time-button").addEventListener("click", openRecentTimeDialog);
  $("focus-controls").addEventListener("click", (event) => {
    const action = event.target.closest("[data-focus-action]")?.dataset.focusAction;
    if (action === "start") openFocusEditor();
    if (action === "stop") openStopEditor();
    if (action === "cancel") openStopEditor(true);
  });
  $("automation-panel").addEventListener("click", (event) => {
    const run = event.target.closest("[data-automation-run]"); if (run) openAutomationRun(run.dataset.automationRun);
    if (event.target.closest("[data-automation-settings]")) openScheduleEditor();
  });
  $("review-queue").addEventListener("click", (event) => {
    const item = event.target.closest("[data-review-item]"); if (item) openReviewEditor(item.dataset.reviewItem);
  });
  $('review-search-form').addEventListener('submit', (event) => { event.preventDefault(); searchReviewQueue(); });
  $('review-reset').addEventListener('click', () => searchReviewQueue(true));
  $('review-previous').addEventListener('click', () => changeReviewPage(-1));
  $('review-next').addEventListener('click', () => changeReviewPage(1));
  $('review-clear').addEventListener('click', () => { if (!actionBusy) { reviewWorkspace.selected.clear(); reviewWorkspace.notice = 'Selection cleared.'; renderReviewWorkspace(); } });
  $('review-bulk-button').addEventListener('click', () => openBulkReviewEditor());
  $('review-select-page').addEventListener('change', (event) => {
    if (!reviewCanWrite()) return;
    reviewWorkspace.selected.clear();
    if (event.target.checked) for (const item of (reviewWorkspace.snapshot?.items || []).filter(reviewActionable).slice(0, 50)) reviewWorkspace.selected.set(item.id, item);
    reviewWorkspace.notice = ''; refreshReviewControls();
  });
  $('review-results').addEventListener('change', (event) => { if (event.target.hasAttribute('data-review-select')) selectReviewItem(event.target.dataset.reviewSelect, event.target.checked); });
  $('review-results').addEventListener('click', (event) => { const item = event.target.closest('[data-review-inspect]'); if (item) void openReviewConversation(item.dataset.reviewInspect); });
  $('review-command-progress').addEventListener('click', (event) => { const item = event.target.closest('[data-review-inspect]'); if (item) void openReviewConversation(item.dataset.reviewInspect); });
  $('review-preference-list').addEventListener('click', (event) => { const item = event.target.closest('[data-review-forget]'); if (item) forgetReviewPreference(item.dataset.reviewForget); });
  $("new-task-button").addEventListener("click", () => openTaskEditor());
  $("new-project-button").addEventListener("click", openProjectEditor);
  $("log-time-button").addEventListener("click", () => openTimeEditor());
  $("dialog-body").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-entry-edit]"); if (edit) openTimeEditor(edit.dataset.entryEdit);
    if (event.target.closest("[data-log-time]")) openTimeEditor();
    if (event.target.closest('[data-review-detail-apply]') && reviewDetailItem) openBulkReviewEditor([reviewDetailItem]);
  });
  $("action-fields").addEventListener("input", (event) => {
    if (actionEditor?.action === 'review.bulkResolve' && event.target.name === 'category') $('review-category-effect').textContent = reviewCategoryEffect(event.target.value, actionEditor.reviewItems.length);
    const project = actionEditor?.project;
    if (project && canAct() && !actionEditor.uncertain && event.target.name === 'projectSearch') {
      project.query = event.target.value; project.open = true; project.activeIndex = -1; renderProjectPicker();
    }
    const picker = actionEditor?.focus;
    if (!picker || actionBusy || actionEditor.uncertain) return;
    if (event.target.name === 'focusSearch') {
      picker.query = event.target.value; picker.selected = null; picker.open = true; picker.activeIndex = -1;
      renderFocusPicker();
    } else if (event.target.name === 'focusTitle') refreshActionControls();
  });
  $("action-fields").addEventListener("focusin", (event) => {
    const project = actionEditor?.project;
    if (project && canAct() && !actionEditor.uncertain && event.target.name === 'projectSearch' && !project.open) {
      project.open = true; renderProjectPicker();
    }
    const picker = actionEditor?.focus;
    if (picker && !actionBusy && !actionEditor.uncertain && event.target.name === 'focusSearch' && !picker.open) {
      picker.open = true; renderFocusPicker();
    }
  });
  $("action-fields").addEventListener("click", (event) => {
    const project = actionEditor?.project;
    const projectOption = event.target.closest('[data-project-option]');
    if (projectOption) selectProjectOption(Number(projectOption.dataset.projectOption));
    if (project && canAct() && !actionEditor.uncertain) {
      if (event.target.closest('#project-clear')) selectProjectOption(project.rows.length - 1);
      if (event.target.closest('#project-change')) { project.open = true; renderProjectPicker(); $('action-field-projectSearch').focus(); }
    }
    const option = event.target.closest('[data-focus-option]');
    if (option) selectFocusOption(Number(option.dataset.focusOption));
  });
  $("action-fields").addEventListener("keydown", projectPickerKey);
  $("action-fields").addEventListener("keydown", (event) => {
    const picker = actionEditor?.focus;
    if (!picker || event.target.name !== 'focusSearch' || actionBusy || actionEditor.uncertain) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); picker.open = true;
      picker.activeIndex = event.key === 'ArrowDown' ? Math.min(picker.activeIndex + 1, picker.rows.length - 1) : picker.activeIndex < 0 ? picker.rows.length - 1 : Math.max(0, picker.activeIndex - 1);
      renderFocusPicker(); $('focus-option-' + picker.activeIndex)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (picker.open && picker.activeIndex >= 0) selectFocusOption(picker.activeIndex);
    } else if (event.key === 'Escape' && picker.open) {
      event.preventDefault(); event.stopPropagation(); picker.open = false; picker.activeIndex = -1; renderFocusPicker();
    }
  });
  $("action-form").addEventListener("submit", submitAction);
  $("action-close").addEventListener("click", closeActionEditor);
  $("action-cancel").addEventListener("click", closeActionEditor);
  $("action-dialog").addEventListener("cancel", (event) => { event.preventDefault(); closeActionEditor(); });
  $("refresh-connection").addEventListener("click", () => refresh());
  $("action-refresh-session").addEventListener("click", () => refresh());
  window.addEventListener("online", () => refresh());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { refresh(); refreshJobs(); } });
  $("dialog-close").addEventListener("click", () => $("detail-dialog").close());
  $("detail-dialog").addEventListener("click", (event) => {
    if (event.target === $("detail-dialog")) $("detail-dialog").close();
  });
  $('detail-dialog').addEventListener('close', () => { reviewDetailSequence++; reviewDetailController?.abort(); reviewDetailItem = null; });

  function tick() {
    if (!data || !data.activeTimer) return;
    const secs = Math.max(0, (Date.now() - new Date(data.activeTimer.start).getTime()) / 1000);
    $("timer-value").innerHTML = "<span class='live'>" + fmtClock(secs) + "</span>";
  }

  async function refresh() {
    const sequence = ++refreshSequence;
    try {
      const res = await fetch("/api/data", { cache: "no-store" });
      if (sequence === refreshSequence && res.status === 401) authExpired = true;
      if (!res.ok) throw new Error("Data unavailable");
      const payload = await res.json();
      if (!Array.isArray(payload.tasks) || !Array.isArray(payload.entries) || !Array.isArray(payload.projects) || !Array.isArray(payload.products)) throw new Error("Invalid data");
      if (sequence !== refreshSequence) return;
      data = payload;
      dataAvailable = true;
      authExpired = false;
      render(); tick(); renderConnection();
      void refreshAutomation();
      void refreshReviewQueue();
    } catch {
      if (sequence !== refreshSequence) return;
      dataAvailable = false;
      renderConnection();
    } finally { refreshActionControls(); }
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
