const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const ROTATE_THRESHOLD_BYTES = 5 * 1024 * 1024;
const BACKFILL_LINES = 1000;
const BACKFILL_BYTES = 512 * 1024;

function tailBytes(filePath, numBytes) {
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - numBytes);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return { content: buf.toString('utf8'), size: stat.size };
  } finally { fs.closeSync(fd); }
}

function lastNLines(text, n) {
  const lines = text.split('\n');
  const nonEmpty = lines.filter(l => l.length);
  return nonEmpty.slice(-n);
}

function parseLine(line, onError) {
  try { return JSON.parse(line); }
  catch (e) { onError && onError(line, e); return null; }
}

function rotateIfLarge(filePath, output) {
  try {
    const st = fs.statSync(filePath);
    if (st.size <= ROTATE_THRESHOLD_BYTES) return;
    const { content } = tailBytes(filePath, BACKFILL_BYTES);
    const keep = lastNLines(content, BACKFILL_LINES).join('\n') + '\n';
    fs.writeFileSync(filePath, keep);
    output && output.appendLine(`[tailer] rotated ${filePath} (kept ${BACKFILL_LINES} lines)`);
  } catch (e) {
    output && output.appendLine('[tailer] rotate failed: ' + e.message);
  }
}

function createLogTailer({ getLogPath, output }) {
  const emitter = new EventEmitter();
  let watcher = null;
  let offset = 0;
  let pending = '';
  let pollTimer = null;
  let logPath = null;

  function ensureFile() {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '');
  }

  function backfill() {
    const { content, size } = tailBytes(logPath, BACKFILL_BYTES);
    const lines = lastNLines(content, BACKFILL_LINES);
    for (const line of lines) {
      const evt = parseLine(line, (bad, err) => output && output.appendLine(`[tailer] backfill parse: ${err.message}`));
      if (evt) emitter.emit('event', evt);
    }
    offset = size;
    emitter.emit('ok');
  }

  function readNew() {
    let stat;
    try { stat = fs.statSync(logPath); }
    catch (e) { output && output.appendLine('[tailer] stat: ' + e.message); emitter.emit('error', e); return; }
    if (stat.size < offset) offset = 0;          // truncation detected
    if (stat.size === offset) return;
    const fd = fs.openSync(logPath, 'r');
    try {
      const len = stat.size - offset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      offset = stat.size;
      pending += buf.toString('utf8');
    } finally { fs.closeSync(fd); }

    const parts = pending.split('\n');
    pending = parts.pop();                        // last is partial
    for (const line of parts) {
      if (!line) continue;
      const evt = parseLine(line, (bad, err) => output && output.appendLine(`[tailer] parse: ${err.message} :: ${line.slice(0,120)}`));
      if (evt) emitter.emit('event', evt);
    }
    emitter.emit('ok');
  }

  function start() {
    logPath = getLogPath();
    try { ensureFile(); } catch (e) { output && output.appendLine('[tailer] ensureFile: ' + e.message); emitter.emit('error', e); return; }
    rotateIfLarge(logPath, output);
    backfill();
    try {
      watcher = fs.watch(logPath, { persistent: false }, () => readNew());
    } catch (e) {
      output && output.appendLine('[tailer] watch failed: ' + e.message);
      emitter.emit('error', e);
    }
    pollTimer = setInterval(readNew, 1000);      // fallback
  }

  function stop() {
    if (watcher) { try { watcher.close(); } catch (_) {} watcher = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    offset = 0;
    pending = '';
  }

  return {
    start, stop,
    on:  (e, cb) => emitter.on(e, cb),
    off: (e, cb) => emitter.off(e, cb)
  };
}

module.exports = { createLogTailer, ROTATE_THRESHOLD_BYTES };
