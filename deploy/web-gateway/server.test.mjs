import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from './server.mjs';
const token = 'x'.repeat(48);
const upstream = 'http://10.53.0.2:4749';
async function fixture(t, fetchImpl, secret = token) {
  const server = createGateway({ token: secret, upstream, fetchImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return 'http://127.0.0.1:' + server.address().port;
}
test('rejects missing credentials, browser origins, writes and nonallowlisted paths before any upstream call', async t => {
  const base = await fixture(t, () => { throw new Error('Must not reach upstream'); });
  assert.equal((await fetch(base + '/api/data')).status, 401);
  assert.equal((await fetch(base + '/api/data', { headers: { authorization: 'Bearer ' + token, origin: 'https://example.com' } })).status, 401);
  for (const path of ['/mcp', '/api/data?anything=1', '/v1/jobs', '/%61pi/data']) {
    const result = await fetch(base + path, { headers: { authorization: 'Bearer ' + token } });
    assert.equal(result.status, 404);
  }
  assert.equal((await fetch(base + '/api/data', { method: 'POST', headers: { authorization: 'Bearer ' + token } })).status, 404);
});
test('forwards only an authenticated readonly request and never caches its JSON', async t => {
  const calls = [];
  const base = await fixture(t, async (url, options) => { calls.push({ url, options }); return new Response('{"value":3}', { headers: { 'content-type': 'application/json' } }); });
  for (const path of ['/api/data', '/api/triage', '/api/jobs']) {
    const response = await fetch(base + path, { headers: { authorization: 'Bearer ' + token } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { value: 3 });
  }
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url.href, upstream + '/api/data');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'error');
});
test('conceals upstream errors and rejects oversized responses', async t => {
  const base = await fixture(t, async () => new Response('x'.repeat(6 * 1024 * 1024), { headers: { 'content-type': 'application/json' } }));
  const response = await fetch(base + '/api/data', { headers: { authorization: 'Bearer ' + token } });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'LifeOS is unavailable' });
});
test('refuses arbitrary URLs and short secrets', () => {
  assert.throws(() => createGateway({ token: 'short', upstream }));
  for (const bad of ['https://example.com:4749', 'http://169.254.169.254:4749', 'http://10.53.0.2:4749/path', 'http://10.53.0.2:4749?x=1']) assert.throws(() => createGateway({ token, upstream: bad }));
});

test('normalizes the trailing newline in an injected Secret Manager credential', async t => {
  const base = await fixture(t, async (_url, options) => {
    assert.equal(options.headers.authorization, 'Bearer ' + token);
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  }, token + '\n');
  assert.equal((await fetch(base + '/api/data', { headers: { authorization: 'Bearer ' + token } })).status, 200);
});
