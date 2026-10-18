import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const allowed = new Set(['/api/data', '/api/triage', '/api/jobs']);
const digest = value => createHash('sha256').update(value).digest();
const maximumResponseBytes = 5 * 1024 * 1024;

export function createGateway({ token, upstream, fetchImpl = fetch }) {
  token = typeof token === 'string' ? token.trim() : token;
  if (typeof token !== 'string' || token.length < 32) throw new Error('A gateway credential of at least 32 characters is required');
  const origin = new URL(upstream);
  const octets = origin.hostname.split('.').map(Number);
  if (origin.protocol !== 'http:' || origin.port !== '4749' || octets.length !== 4 || !octets.every(Number.isInteger) || octets[0] !== 10 || octets[1] !== 53 || octets[2] !== 0 || octets[3] < 1 || octets[3] > 254 || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Upstream must be the LifeOS VM private address on port 4749');
  const expected = digest(token);
  const server = createServer(async (req, res) => {
    const respond = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" });
      res.end(typeof value === 'string' ? value : JSON.stringify(value));
    };
    const authorization = req.headers.authorization ?? '';
    if (req.headers.origin || !authorization.startsWith('Bearer ') || !timingSafeEqual(expected, digest(authorization.slice(7)))) { respond(401, { error: 'Unauthorized' }); return; }
    if (req.method !== 'GET' || !allowed.has(req.url ?? '') || req.headers['transfer-encoding'] || Number(req.headers['content-length'] ?? 0) !== 0) { respond(404, { error: 'Not found' }); return; }
    try {
      const response = await fetchImpl(new URL(req.url, origin), {
        method: 'GET', headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
      if (response.status !== 200 || !response.headers.get('content-type')?.startsWith('application/json')) { await response.body?.cancel(); respond(502, { error: 'LifeOS is unavailable' }); return; }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Missing upstream response');
      const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximumResponseBytes) { await reader.cancel(); throw new Error('Response limit'); }
        chunks.push(Buffer.from(value));
      }
      const body = Buffer.concat(chunks).toString('utf8');
      JSON.parse(body); // Never relay upstream HTML or invalid JSON to a browser client.
      respond(200, body);
    } catch {
      respond(502, { error: 'LifeOS is unavailable' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 5_000;
  server.maxHeadersCount = 32;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createGateway({ token: process.env.LIFE_OS_GATEWAY_TOKEN, upstream: process.env.LIFE_OS_VM_ORIGIN });
  server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0', () => console.log('LifeOS readonly gateway ready'));
}
