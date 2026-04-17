(function () {
  const EVENT_TYPES = ['permission_prompt', 'elicitation_dialog', 'idle_prompt', 'stop', 'subagent_stop'];
  const SEVERITY = {
    permission_prompt: 'warning',
    elicitation_dialog: 'warning',
    idle_prompt: 'info',
    stop: 'info',
    subagent_stop: 'info'
  };
  const SEVERITY_LABEL = { info: 'info', warning: 'warning', error: 'error' };

  const ICON_TEMPLATES = {
    info:    document.getElementById('icon-info'),
    warning: document.getElementById('icon-warning'),
    error:   document.getElementById('icon-error')
  };

  function iconNode(sev) {
    const tpl = ICON_TEMPLATES[sev] || ICON_TEMPLATES.info;
    return tpl.content.cloneNode(true);
  }

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
  const $empty   = document.getElementById('empty');
  const $chips   = document.getElementById('chips');
  const $search  = document.getElementById('search');
  const $count   = document.getElementById('count');
  const $conn    = document.getElementById('conn');
  const $pling   = document.getElementById('pling');
  const $port    = document.getElementById('port');
  const $arrival = document.getElementById('arrival-sound');

  EVENT_TYPES.forEach(t => {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip';
    c.textContent = t;
    c.dataset.type = t;
    c.setAttribute('aria-pressed', 'true');
    c.onclick = () => {
      const on = c.getAttribute('aria-pressed') === 'true';
      c.setAttribute('aria-pressed', on ? 'false' : 'true');
      state.filter = new Set(
        Array.from($chips.querySelectorAll('.chip[aria-pressed="true"]')).map(e => e.dataset.type)
      );
      schedule();
    };
    $chips.appendChild(c);
  });

  $search.oninput = () => { state.search = $search.value.toLowerCase(); schedule(); };
  $arrival.onchange = () => { state.soundOn = $arrival.checked; };
  document.getElementById('mark-all').onclick = () => { state.unread.clear(); schedule(); };
  document.getElementById('clear').onclick = () => { state.events = []; state.unread.clear(); schedule(); };

  function fmt(ts) {
    const d = new Date(ts);
    return d.toTimeString().slice(0, 8);
  }

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
    const unread = state.unread.has(e.id);
    const row = document.createElement('div');
    row.className = 'row ' + sev + (unread ? ' unread' : '');
    row.dataset.id = e.id;
    row.setAttribute('role', 'listitem');
    row.tabIndex = -1;
    row.setAttribute(
      'aria-label',
      `${SEVERITY_LABEL[sev]} ${e.type} at ${fmt(e.ts)}${unread ? ', unread' : ''}: ${e.msg || ''}`
    );

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.appendChild(iconNode(sev));
    row.appendChild(icon);

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = fmt(e.ts);
    row.appendChild(time);

    const msg = document.createElement('span');
    msg.className = 'msg';
    msg.textContent = e.msg || '';
    row.appendChild(msg);

    const cwd = document.createElement('span');
    cwd.className = 'cwd';
    cwd.title = e.cwd || '';
    cwd.textContent = e.cwd || '';
    row.appendChild(cwd);

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.setAttribute('aria-hidden', 'true');
    row.appendChild(dot);

    row.onclick = () => activate(e.id, row);
    row.onkeydown = ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        activate(e.id, row);
      }
    };
    return row;
  }

  function activate(id, row) {
    transport.sendFocus(id);
    transport.sendDismiss(id);
    state.unread.delete(id);
    row.classList.remove('unread');
    const lbl = row.getAttribute('aria-label');
    if (lbl) row.setAttribute('aria-label', lbl.replace(', unread', ''));
  }

  let rafPending = false;
  function schedule() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; render(); });
  }

  function render() {
    const activeId = document.activeElement && document.activeElement.dataset
      ? document.activeElement.dataset.id
      : null;

    const visible = state.events.filter(matches);
    $count.textContent = visible.length === state.events.length
      ? `${visible.length} events`
      : `${visible.length} / ${state.events.length} events`;

    while ($list.firstChild) $list.removeChild($list.firstChild);
    $list.appendChild($empty);
    $empty.dataset.show = visible.length === 0 ? 'true' : 'false';

    const frag = document.createDocumentFragment();
    let focusTarget = null;
    for (const e of visible) {
      const row = buildRow(e);
      if (activeId && row.dataset.id === activeId) {
        row.tabIndex = 0;
        focusTarget = row;
      }
      frag.appendChild(row);
    }
    if (!focusTarget && visible.length > 0) {
      const first = frag.firstElementChild;
      if (first && first.classList.contains('row')) first.tabIndex = 0;
    }
    $list.appendChild(frag);

    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }

  $list.addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'Home' && ev.key !== 'End') return;
    const rows = Array.from($list.querySelectorAll('.row'));
    if (!rows.length) return;
    const idx = rows.indexOf(document.activeElement);
    let next = idx;
    if (ev.key === 'ArrowDown') next = idx < 0 ? 0 : Math.min(rows.length - 1, idx + 1);
    else if (ev.key === 'ArrowUp') next = idx < 0 ? 0 : Math.max(0, idx - 1);
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = rows.length - 1;
    if (next === idx) return;
    ev.preventDefault();
    rows.forEach(r => (r.tabIndex = -1));
    rows[next].tabIndex = 0;
    rows[next].focus();
  });

  const mode = window.__MODE;
  const port = window.__PORT;
  if (port) $port.textContent = ':' + port;
  const transport = mode === 'webview' ? VsCodeTransport(window.acquireVsCodeApi()) : SseTransport();

  transport.onConn(ok => {
    $conn.className = ok === 'ok' ? 'ok' : 'bad';
    $conn.textContent = ok === 'ok' ? 'connected' : 'disconnected';
  });
  transport.onHistory(arr => {
    state.events = arr.slice();
    state.unread = new Set(arr.filter(e => e._unread).map(e => e.id));
    schedule();
  });
  transport.onEvent(evt => {
    state.events.unshift(evt);
    if (state.events.length > 1000) state.events.pop();
    state.unread.add(evt.id);
    if (state.soundOn) { try { $pling.play(); } catch (_) {} }
    schedule();
  });
  transport.connect();
})();
