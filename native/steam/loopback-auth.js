// Loopback OAuth for the packaged desktop build: Google will not return to an app that has no
// https origin, and it refuses to render its sign-in page inside the game window at all — so the
// system browser does the sign-in and comes back to a one-shot http server on 127.0.0.1.
// Lives outside main.js so the whole server half can be unit-tested in plain Node (no Electron).
const http = require('node:http');
const crypto = require('node:crypto');

// A FIXED short list, because every one of these has to be registered by hand as a Redirect URL
// in the Supabase project (see native/README.md). A random port could never be whitelisted.
const PORTS = [8765, 8766, 8767];
const TIMEOUT_MS = 3 * 60 * 1000;

function page(heading, detail) {
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>Tau</title>` +
    `<style>html,body{height:100%}body{margin:0;display:flex;align-items:center;justify-content:center;` +
    `background:#101410;color:#e8efe6;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}` +
    `main{max-width:26rem;padding:2rem;text-align:center}h1{margin:0 0 .6rem;font-size:1.35rem;font-weight:600}` +
    `p{margin:0;color:#9fb098}</style></head><body><main><h1>${heading}</h1><p>${detail}</p></main></body></html>`;
}

function listenOn(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    const failed = (err) => reject(err);
    server.once('error', failed);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', failed);
      resolve(server);
    });
  });
}

async function listenLoopback(ports) {
  let last = null;
  for (const port of ports) {
    try {
      const server = await listenOn(port);
      return { server, port: server.address().port };
    } catch (err) {
      last = err;
    }
  }
  throw new Error('No loopback port free for sign-in (' + ports.join(', ') + ').');
}

function isLoopback(req) {
  const addr = (req.socket && req.socket.remoteAddress) || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

// Resolves { code } once the browser comes back, or { cancelled: true } / { error } — never
// rejects, so the caller has one shape to branch on.
async function startLoopbackAuth(options = {}) {
  const ports = Array.isArray(options.ports) && options.ports.length ? options.ports : PORTS;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : TIMEOUT_MS;
  const { server, port } = await listenLoopback(ports);
  const state = crypto.randomBytes(16).toString('hex');
  const sockets = new Set();
  let settle = null;
  const result = new Promise((resolve) => { settle = resolve; });
  let done = false;

  const timer = setTimeout(() => finish({ cancelled: true }), timeoutMs);
  if (timer.unref) timer.unref();

  function finish(value) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    try { server.close(); } catch (e) {}
    for (const socket of sockets) { try { socket.destroy(); } catch (e) {} }
    sockets.clear();
    settle(value);
  }

  function reply(res, status, html, then) {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Connection': 'close',
    });
    res.end(html, () => { if (then) then(); });
  }

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  server.on('request', (req, res) => {
    if (!isLoopback(req)) { res.destroy(); return; }
    let url;
    try { url = new URL(req.url || '/', 'http://127.0.0.1'); } catch (e) { res.destroy(); return; }
    // Anything that isn't the redirect target (a favicon probe, a stray fetch) is answered and
    // ignored: the flow keeps waiting for the real one.
    if (url.pathname !== '/') { reply(res, 404, page('Not here', 'Nothing lives at this address.')); return; }
    const returned = url.searchParams.get('state');
    if (returned && returned !== state) {
      reply(res, 403, page('Wrong window', 'This sign-in did not come from Tau. Nothing was changed.'));
      return;
    }
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (code) {
      reply(res, 200, page('Signed in', 'You can close this tab and go back to Tau.'),
        () => finish({ code }));
      return;
    }
    if (error) {
      const detail = url.searchParams.get('error_description') || error;
      // "access_denied" is the player pressing Cancel on Google's own screen, not a failure.
      const cancelled = /access_denied/i.test(error);
      reply(res, 200, page(cancelled ? 'Sign-in cancelled' : 'Sign-in failed',
        cancelled ? 'You can close this tab and go back to Tau.' : String(detail).slice(0, 200)),
        () => finish(cancelled ? { cancelled: true } : { error: String(detail).slice(0, 200) }));
      return;
    }
    reply(res, 400, page('Nothing to do', 'This page is only used while signing in to Tau.'));
  });

  return {
    port,
    state,
    redirectUri: `http://127.0.0.1:${port}/`,
    result,
    cancel: () => finish({ cancelled: true }),
  };
}

module.exports = { startLoopbackAuth, PORTS, TIMEOUT_MS };
