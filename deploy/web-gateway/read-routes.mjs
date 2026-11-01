// Shared by Vercel, the Cloud Run gateway and the VM bridge. Only review reads
// accept query parameters; no user-supplied URL or write route can be proxied.
const fixed = new Set(['/api/data', '/api/triage', '/api/jobs', '/api/automation']);
const buckets = new Set(['all', 'awaitingAgent', 'needsDecision', 'needsContext', 'queued']);
const categories = new Set(['ACTION/NOW', 'ACTION/SOON', 'WAITING', 'CALENDAR', 'FINANCE/RECEIPT', 'LEGAL/COMPLIANCE', 'FYI/READ', 'NEWSLETTER', 'SPAM/SUSPECT']);
export function readRoute(raw) {
  if (typeof raw !== 'string' || raw.length > 3000 || /[\\#\u0000-\u0020]/.test(raw)) return undefined;
  if (fixed.has(raw)) return raw;
  const path = raw.split('?')[0];
  if (!['/api/reviews', '/api/review'].includes(path)) return undefined;
  let url;
  try { url = new URL(raw, 'http://localhost'); } catch { return undefined; }
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key) || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
    seen.add(key);
    if (path === '/api/review') {
      if (key !== 'itemId' || !value || value.length > 100) return undefined;
    } else {
      if (key === 'bucket' && buckets.has(value)) continue;
      if (key === 'search' && value.length <= 200) continue;
      if (key === 'account' && value.length > 0 && value.length <= 320) continue;
      if (key === 'category' && categories.has(value)) continue;
      if (key === 'limit' && /^(?:[1-9]|[1-4]\d|50)$/.test(value)) continue;
      if (key === 'cursor' && value.length > 0 && value.length <= 512) continue;
      return undefined;
    }
  }
  if (path === '/api/review' && !seen.has('itemId')) return undefined;
  const query = url.searchParams.toString();
  return path + (query ? '?' + query : '');
}
