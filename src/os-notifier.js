const { spawn, execFile } = require('child_process');

const EXPIRY_MS = 60_000;
const MAX_PENDING = 200;

function severityToIcon(sev) {
  if (sev === 'error')   return 'dialog-error';
  if (sev === 'warning') return 'dialog-warning';
  return 'dialog-information';
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function createLinuxNotifier(output) {
  const pending = new Map();
  let monitor = null;
  let stopped = false;

  function pruneExpired() {
    const now = Date.now();
    for (const [id, entry] of pending) {
      if (now - entry.ts > EXPIRY_MS) pending.delete(id);
    }
    if (pending.size > MAX_PENDING) {
      const extra = pending.size - MAX_PENDING;
      let i = 0;
      for (const k of pending.keys()) { if (i++ >= extra) break; pending.delete(k); }
    }
  }

  function ensureMonitor() {
    if (monitor || stopped) return;
    try {
      monitor = spawn('gdbus', [
        'monitor', '--session',
        '--dest', 'org.freedesktop.Notifications'
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      output && output.appendLine('[os-notifier] monitor spawn failed: ' + e.message);
      return;
    }
    let buf = '';
    monitor.stdout.on('data', chunk => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        handleLine(line);
      }
    });
    monitor.stderr.on('data', d => output && output.appendLine('[os-notifier] monitor stderr: ' + d.toString().trim()));
    monitor.on('exit', code => {
      monitor = null;
      if (!stopped) output && output.appendLine('[os-notifier] monitor exited code=' + code);
    });
  }

  function handleLine(line) {
    const invoked = line.match(/ActionInvoked \(uint32 (\d+), '([^']*)'\)/);
    if (invoked) {
      const id = Number(invoked[1]);
      const entry = pending.get(id);
      if (entry && entry.onClick) {
        try { entry.onClick(invoked[2]); } catch (e) { output && output.appendLine('[os-notifier] onClick: ' + e.message); }
      }
      pending.delete(id);
      return;
    }
    const closed = line.match(/NotificationClosed \(uint32 (\d+),/);
    if (closed) pending.delete(Number(closed[1]));
  }

  function notify({ title, body, severity, onClick, timeoutMs, requireDismiss }) {
    if (stopped) return;
    ensureMonitor();
    pruneExpired();
    const critical = requireDismiss || severity === 'error';
    const urgency = critical ? 2 : (severity === 'warning' ? 1 : 0);
    const hints = `{"urgency": <byte ${urgency}>, "desktop-entry": <"code">}`;
    const expire = critical ? '0' : String(timeoutMs || 8000);
    const args = [
      'call', '--session',
      '--dest=org.freedesktop.Notifications',
      '--object-path=/org/freedesktop/Notifications',
      '--method=org.freedesktop.Notifications.Notify',
      'Claude Code',
      '0',
      severityToIcon(severity),
      truncate(title || 'Claude', 200),
      truncate(body || '', 400),
      onClick ? '["default", "Focus"]' : '[]',
      hints,
      expire
    ];
    execFile('gdbus', args, (err, stdout) => {
      if (err) { output && output.appendLine('[os-notifier] gdbus call: ' + err.message); return; }
      const m = stdout && stdout.match(/uint32 (\d+)/);
      if (!m) return;
      const id = Number(m[1]);
      if (onClick) pending.set(id, { onClick, ts: Date.now() });
    });
  }

  function stop() {
    stopped = true;
    pending.clear();
    if (monitor) { try { monitor.kill(); } catch (_) {} monitor = null; }
  }

  return { notify, stop };
}

function createMacNotifier(output) {
  let hasTerminalNotifier = null;
  function probe(cb) {
    if (hasTerminalNotifier !== null) return cb(hasTerminalNotifier);
    execFile('/usr/bin/which', ['terminal-notifier'], err => {
      hasTerminalNotifier = !err;
      cb(hasTerminalNotifier);
    });
  }
  function notify({ title, body, onClick }) {
    probe(has => {
      if (has) {
        const args = [
          '-title', truncate(title || 'Claude', 200),
          '-message', truncate(body || '', 400),
          '-sender', 'com.microsoft.VSCode',
          '-activate', 'com.microsoft.VSCode'
        ];
        execFile('terminal-notifier', args, err => {
          if (err) output && output.appendLine('[os-notifier] terminal-notifier: ' + err.message);
          else if (onClick) onClick('default');
        });
      } else {
        const script = `display notification ${JSON.stringify(truncate(body || '', 400))} with title ${JSON.stringify(truncate(title || 'Claude', 200))}`;
        execFile('osascript', ['-e', script], err => {
          if (err) output && output.appendLine('[os-notifier] osascript: ' + err.message);
        });
      }
    });
  }
  return { notify, stop() {} };
}

function createOsNotifier({ output }) {
  if (process.platform === 'linux')  return createLinuxNotifier(output);
  if (process.platform === 'darwin') return createMacNotifier(output);
  return {
    notify() { output && output.appendLine('[os-notifier] unsupported platform ' + process.platform); },
    stop() {}
  };
}

module.exports = { createOsNotifier };
