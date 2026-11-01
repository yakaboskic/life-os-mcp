/** Render the small Markdown grammar produced by the briefing service, never arbitrary HTML. */
const escape = (value: string): string => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const inline = (value: string): string => escape(value).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

export function renderBriefEmailHtml(markdown: string): string {
  const blocks: string[] = [];
  let paragraph: string[] = [], list: "ol" | "ul" | undefined;
  const closeParagraph = () => {
    if (paragraph.length) blocks.push(`<p style="margin:0 0 18px;">${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => { if (list) blocks.push(`</${list}>`); list = undefined; };
  for (const line of markdown.replace(/\r\n/g, "\n").trim().split("\n")) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/), item = line.match(/^(?:\d+\.\s+|[-*]\s+)(.+)$/);
    if (!line.trim()) { closeParagraph(); closeList(); continue; }
    if (heading) {
      closeParagraph(); closeList();
      const primary = heading[1]!.length < 3, tag = primary ? "h1" : "h2";
      blocks.push(`<${tag} style="margin:${primary ? "0 0 20px" : "28px 0 12px"};color:#133544;font-size:${primary ? "26px" : "19px"};line-height:1.3;font-weight:700;">${inline(heading[2]!)}</${tag}>`);
    } else if (item) {
      closeParagraph();
      const kind = /^\d+\./.test(line) ? "ol" : "ul";
      if (list !== kind) { closeList(); list = kind; blocks.push(`<${kind} style="margin:0 0 20px;padding-left:24px;">`); }
      blocks.push(`<li style="margin:0 0 14px;padding-left:4px;">${inline(item[1]!)}</li>`);
    } else { closeList(); paragraph.push(line.trim()); }
  }
  closeParagraph(); closeList();
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LifeOS daily brief</title></head>' +
    '<body style="margin:0;padding:0;background:#edf2f4;color:#263d47;font-family:Arial,Helvetica,sans-serif;">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf2f4;"><tr><td align="center" style="padding:16px 8px;">' +
    '<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border-top:4px solid #49bdca;"><tr><td style="padding:24px;font-size:16px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word;">' +
    '<p style="margin:0 0 20px;color:#326575;font-size:14px;font-weight:700;">LifeOS daily brief</p>' + blocks.join("\n") +
    '</td></tr></table></td></tr></table></body></html>';
}
