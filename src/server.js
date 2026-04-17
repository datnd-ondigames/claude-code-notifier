const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const PORT_START = 37100;
const PORT_END   = 37150;

function createServer({ config, history, mediaRoot, output }) {
  const emitter = new EventEmitter();
  let server = null;
  let port = 0;
  const clients = new Set();

  function readAsset(name) {
    const full = path.join(mediaRoot, name);
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full);
  }

  const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.wav': 'audio/wav' };

  function handle(req, res) {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && url === '/') {
      const html = readAsset('dashboard.html');
      if (!html) { res.writeHead(500); return res.end('missing dashboard.html'); }
      const bootstrap = `<script>window.__MODE='browser';window.__PORT=${port};</script>`;
      const out = html.toString('utf8')
        .replace('<!-- __BOOTSTRAP__ -->', bootstrap)
        .replace('./dashboard.css', '/static/dashboard.css')
        .replace('./dashboard.js',  '/static/dashboard.js');
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(out);
    }
    if (req.method === 'GET' && url.startsWith('/static/')) {
      const name = url.slice('/static/'.length).replace(/\.\./g, '');
      const data = readAsset(name);
      if (!data) { res.writeHead(404); return res.end(); }
      const ext = path.extname(name);
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
      return res.end(data);
    }
    if (req.method === 'GET' && url === '/history') {
      const list = history.list().map(e => ({ ...e, _unread: history.isUnread(e.id) }));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(list));
    }
    if (req.method === 'GET' && url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'POST' && (url === '/focus' || url === '/dismiss')) {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        let id = null;
        try { id = JSON.parse(body).id; } catch (_) {}
        if (typeof id !== 'string') { res.writeHead(400); return res.end(); }
        emitter.emit(url === '/focus' ? 'focus' : 'dismiss', { id });
        res.writeHead(200); res.end('{}');
      });
      return;
    }
    res.writeHead(404); res.end();
  }

  function broadcast(event) {
    const data = 'data: ' + JSON.stringify(event) + '\n\n';
    for (const c of [...clients]) {
      try { c.write(data); } catch (_) { clients.delete(c); }
    }
  }

  function tryListen(p) {
    return new Promise((resolve, reject) => {
      const s = http.createServer(handle);
      s.once('error', e => reject(e));
      s.listen(p, '127.0.0.1', () => resolve(s));
    });
  }

  async function start() {
    if (!config.get().server.enabled) { output && output.appendLine('[server] disabled'); return; }
    const requested = config.get().server.port;
    const range = requested ? [requested] : [];
    if (!requested) for (let p = PORT_START; p <= PORT_END; p++) range.push(p);
    for (const p of range) {
      try { server = await tryListen(p); port = p; break; } catch (_) { /* try next */ }
    }
    if (!server) {
      output && output.appendLine('[server] could not bind any port in range');
      return;
    }
    output && output.appendLine('[server] listening on 127.0.0.1:' + port);
    history.on('event', broadcast);
  }

  function stop() {
    history.off && history.off('event', broadcast);
    for (const c of clients) { try { c.end(); } catch (_) {} }
    clients.clear();
    if (server) { try { server.close(); } catch (_) {} server = null; }
    port = 0;
    emitter.removeAllListeners();
  }

  return {
    start, stop,
    getPort: () => port,
    on: (ev, cb) => emitter.on(ev, cb)
  };
}

module.exports = { createServer, PORT_START, PORT_END };
