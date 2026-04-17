const { EventEmitter } = require('events');

const DEDUPE_WINDOW_MS = 2000;

function createHistoryStore({ maxEntries }) {
  const emitter = new EventEmitter();
  let buf = [];            // newest at index 0
  let max = maxEntries;
  const seenIds = new Set();
  const unread = new Set();

  function setMax(n) {
    max = Math.max(1, n | 0);
    if (buf.length > max) {
      const dropped = buf.splice(max);
      for (const e of dropped) { seenIds.delete(e.id); unread.delete(e.id); }
    }
  }

  function isDupeRecent(evt) {
    const cutoff = evt.ts - DEDUPE_WINDOW_MS;
    for (const e of buf) {
      if (e.ts < cutoff) break;
      if (e.type === evt.type && e.msg === evt.msg && (e.cwd || '') === (evt.cwd || '')) return true;
    }
    return false;
  }

  function add(evt) {
    if (!evt || !evt.id || !evt.type || !evt.msg || typeof evt.ts !== 'number') return null;
    if (seenIds.has(evt.id)) return null;
    if (isDupeRecent(evt)) return null;
    buf.unshift(evt);
    seenIds.add(evt.id);
    unread.add(evt.id);
    if (buf.length > max) {
      const dropped = buf.splice(max);
      for (const e of dropped) { seenIds.delete(e.id); unread.delete(e.id); }
    }
    emitter.emit('event', evt);
    return evt;
  }

  function markRead(id)     { if (unread.delete(id)) emitter.emit('read', id); }
  function markAllRead()    { const ids = [...unread]; unread.clear(); for (const id of ids) emitter.emit('read', id); }
  function clear()          { buf = []; seenIds.clear(); unread.clear(); emitter.emit('cleared'); }
  function list()           { return buf.slice(); }
  function getById(id)      { return buf.find(e => e.id === id) || null; }
  function unreadCount()    { return unread.size; }
  function isUnread(id)     { return unread.has(id); }
  function recentUnread(n)  { return buf.filter(e => unread.has(e.id)).slice(0, n); }

  return {
    add, markRead, markAllRead, clear, list, getById, unreadCount, isUnread, recentUnread, setMax,
    on:  (ev, cb) => emitter.on(ev, cb),
    off: (ev, cb) => emitter.off(ev, cb),
    stop: () => emitter.removeAllListeners()
  };
}

module.exports = { createHistoryStore, DEDUPE_WINDOW_MS };
