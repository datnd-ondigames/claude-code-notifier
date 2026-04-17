(function () {
  const EVENT_TYPES = ['permission_prompt', 'elicitation_dialog', 'idle_prompt', 'stop', 'subagent_stop'];
  const SEVERITY = { permission_prompt: 'warning', elicitation_dialog: 'warning', idle_prompt: 'info', stop: 'info', subagent_stop: 'info' };

  function SseTransport() {
    const handlers = { event: [], history: [], conn: null };
    return {
      connect() {
        const es = new EventSource('/events');
        es.onopen  = () => handlers.conn && handlers.conn('ok');
        es.onerror = () => handlers.conn && handlers.conn('bad');
        es.onmessage = m => {
          try { const d = JSON.parse(m.data); handlers.event.forEach(cb => cb(d)); } catch (_) {}
        };
        fetch('/history').then(r => r.json()).then(arr => handlers.history.forEach(cb => cb(arr)));
      },
      onEvent(cb)   { handlers.event.push(cb); },
      onHistory(cb) { handlers.history.push(cb); },
      onConn(cb)    { handlers.conn = cb; },
      sendFocus(id)   { fetch('/focus',   { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }); },
      sendDismiss(id) { fetch('/dismiss', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }); }
    };
  }

  function VsCodeTransport(api) {
    const handlers = { event: [], history: [], conn: null };
    window.addEventListener('message', m => {
      const d = m.data;
      if (d.type === 'event')   handlers.event.forEach(cb => cb(d.payload));
      if (d.type === 'history') handlers.history.forEach(cb => cb(d.payload));
    });
    setTimeout(() => handlers.conn && handlers.conn('ok'), 0);
    api.postMessage({ type: 'ready' });
    return {
      connect() {},
      onEvent(cb)   { handlers.event.push(cb); },
      onHistory(cb) { handlers.history.push(cb); },
      onConn(cb)    { handlers.conn = cb; },
      sendFocus(id)   { api.postMessage({ type: 'focus', id }); },
      sendDismiss(id) { api.postMessage({ type: 'dismiss', id }); }
    };
  }

  const state = { events: [], filter: new Set(EVENT_TYPES), search: '', soundOn: false, unread: new Set() };

  const $list    = document.getElementById('list');
  const $chips   = document.getElementById('chips');
  const $search  = document.getElementById('search');
  const $count   = document.getElementById('count');
  const $conn    = document.getElementById('conn');
  const $pling   = document.getElementById('pling');
  const $port    = document.getElementById('port');
  const $arrival = document.getElementById('arrival-sound');

  EVENT_TYPES.forEach(t => {
    const c = document.createElement('span');
    c.className = 'chip on';
    c.textContent = t;
    c.dataset.type = t;
    c.onclick = () => {
      c.classList.toggle('on');
      state.filter = new Set(Array.from($chips.querySelectorAll('.chip.on')).map(e => e.dataset.type));
      render();
    };
    $chips.appendChild(c);
  });

  $search.oninput = () => { state.search = $search.value.toLowerCase(); render(); };
  $arrival.onchange = () => { state.soundOn = $arrival.checked; };
  document.getElementById('mark-all').onclick = () => { state.unread.clear(); render(); };
  document.getElementById('clear').onclick = () => { state.events = []; state.unread.clear(); render(); };

  function fmt(ts) { const d = new Date(ts); return d.toTimeString().slice(0, 8); }

  function matches(e) {
    if (!state.filter.has(e.type)) return false;
    if (state.search) {
      const s = state.search;
      if (!(e.msg || '').toLowerCase().includes(s) && !(e.cwd || '').toLowerCase().includes(s)) return false;
    }
    return true;
  }

  function buildRow(e) {
    const sev = SEVERITY[e.type] || 'info';
    const row = document.createElement('div');
    row.className = 'row ' + sev + (state.unread.has(e.id) ? ' unread' : '');
    row.dataset.id = e.id;

    const icon = document.createElement('span'); icon.className = 'icon'; row.appendChild(icon);
    const time = document.createElement('span'); time.className = 'time'; time.textContent = fmt(e.ts); row.appendChild(time);
    const msg  = document.createElement('span'); msg.className  = 'msg';  msg.textContent  = e.msg || ''; row.appendChild(msg);
    const cwd  = document.createElement('span'); cwd.className  = 'cwd';  cwd.textContent  = e.cwd || ''; row.appendChild(cwd);
    const dot  = document.createElement('span'); dot.className  = 'dot';  row.appendChild(dot);

    row.onclick = () => {
      transport.sendFocus(e.id);
      transport.sendDismiss(e.id);
      state.unread.delete(e.id);
      row.classList.remove('unread');
    };
    return row;
  }

  function render() {
    const visible = state.events.filter(matches);
    $count.textContent = visible.length + ' / ' + state.events.length + ' events';
    while ($list.firstChild) $list.removeChild($list.firstChild);
    const frag = document.createDocumentFragment();
    for (const e of visible) frag.appendChild(buildRow(e));
    $list.appendChild(frag);
  }

  const mode = window.__MODE;
  const port = window.__PORT;
  if (port) $port.textContent = ':' + port;
  const transport = mode === 'webview' ? VsCodeTransport(window.acquireVsCodeApi()) : SseTransport();

  transport.onConn(ok => { $conn.className = ok === 'ok' ? 'ok' : 'bad'; $conn.textContent = ok === 'ok' ? 'connected' : 'disconnected'; });
  transport.onHistory(arr => {
    state.events = arr.slice();
    state.unread = new Set(arr.filter(e => e._unread).map(e => e.id));
    render();
  });
  transport.onEvent(evt => {
    state.events.unshift(evt);
    if (state.events.length > 1000) state.events.pop();
    state.unread.add(evt.id);
    if (state.soundOn) { try { $pling.play(); } catch (_) {} }
    render();
  });
  transport.connect();
})();
