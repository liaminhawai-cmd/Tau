// The desktop Google flow's server half, driven with real HTTP requests on a free port.
// Electron itself never enters into it: main.js only reserves the port, opens the browser and
// waits on the promise this module returns.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const { startLoopbackAuth, PORTS } = require('../loopback-auth');

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: headers || {} }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

test('the fixed port list is exactly what the Supabase project whitelists', () => {
  // These three are registered by hand as Redirect URLs (see native/README.md), so they cannot
  // drift: a random port could never be whitelisted and sign-in would fail on every machine.
  assert.deepEqual(PORTS, [8765, 8766, 8767]);
});

test('the browser coming back with a code resolves the flow and closes the server', async () => {
  const flow = await startLoopbackAuth({ ports: [0] });
  assert.equal(flow.redirectUri, `http://127.0.0.1:${flow.port}/`);
  assert.match(flow.state, /^[0-9a-f]{32}$/);
  const res = await get(`${flow.redirectUri}?code=AUTH_CODE&state=${flow.state}`);
  assert.equal(res.status, 200);
  assert.match(res.body, /close this tab and go back to Tau/);
  assert.ok(!/https?:\/\/(?!127\.0\.0\.1)/.test(res.body), 'the page loads nothing from the network');
  assert.deepEqual(await flow.result, { code: 'AUTH_CODE' });
  await assert.rejects(get(flow.redirectUri), /ECONNREFUSED/, 'the port is given straight back');
});

test('a returning state that is not the one it minted is refused, and the flow keeps waiting', async () => {
  const flow = await startLoopbackAuth({ ports: [0] });
  const bad = await get(`${flow.redirectUri}?code=INJECTED&state=not-the-state`);
  assert.equal(bad.status, 403);
  const stray = await get(`${flow.redirectUri}favicon.ico`);
  assert.equal(stray.status, 404, 'a favicon probe is not the redirect and must not end the flow');
  const good = await get(`${flow.redirectUri}?code=REAL&state=${flow.state}`);
  assert.equal(good.status, 200);
  assert.deepEqual(await flow.result, { code: 'REAL' }, 'only the real return trip completes it');
});

test('nothing off this machine can even connect to the flow', async () => {
  const flow = await startLoopbackAuth({ ports: [0] });
  // Bound to 127.0.0.1 only: a machine on the same network cannot reach the port at all, which is
  // the first of the two locks (the second is the remote-address check on every request).
  const outward = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  for (const address of outward) {
    await assert.rejects(new Promise((resolve, reject) => {
      const socket = net.connect({ host: address, port: flow.port });
      socket.on('connect', () => { socket.destroy(); resolve(); });
      socket.on('error', reject);
    }), `reachable on ${address}`);
  }
  flow.cancel();
  assert.deepEqual(await flow.result, { cancelled: true });
});

test('Google’s own cancel is a cancel, a real provider error is an error', async () => {
  const cancelled = await startLoopbackAuth({ ports: [0] });
  await get(`${cancelled.redirectUri}?error=access_denied&error_description=The+user+said+no`);
  assert.deepEqual(await cancelled.result, { cancelled: true }, 'no scary error for a cancel');

  const failed = await startLoopbackAuth({ ports: [0] });
  const res = await get(`${failed.redirectUri}?error=server_error&error_description=Provider+is+down`);
  assert.equal(res.status, 200);
  assert.deepEqual(await failed.result, { error: 'Provider is down' });
});

test('the flow times out on its own and always gives the port back', async () => {
  const flow = await startLoopbackAuth({ ports: [0], timeoutMs: 20 });
  assert.deepEqual(await flow.result, { cancelled: true });
  await assert.rejects(get(flow.redirectUri), /ECONNREFUSED/);
  flow.cancel();   // cancelling after the fact is harmless
  assert.deepEqual(await flow.result, { cancelled: true });
});

test('a busy port falls through to the next one, and an entirely busy list fails cleanly', async () => {
  const blocker = http.createServer();
  await new Promise(r => blocker.listen(0, '127.0.0.1', r));
  const taken = blocker.address().port;
  const spare = http.createServer();
  await new Promise(r => spare.listen(0, '127.0.0.1', r));
  const alsoTaken = spare.address().port;

  const flow = await startLoopbackAuth({ ports: [taken, 0] });
  assert.notEqual(flow.port, taken, 'the busy port is skipped, not fought over');
  flow.cancel();
  await flow.result;

  await assert.rejects(startLoopbackAuth({ ports: [taken, alsoTaken] }), /No loopback port free/);
  blocker.close();
  spare.close();
});
