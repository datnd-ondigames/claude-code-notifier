const fs = require('fs');
const path = require('path');
const os = require('os');

const SENTINEL = '# claude-code-notifier';
const EMIT_HELPER_VERSION = 1;

const EMIT_HELPER_SOURCE = `#!/usr/bin/env node
// _version: ${EMIT_HELPER_VERSION}
const fs = require('fs');
const path = require('path');
const os = require('os');

const [,, type, ...msgParts] = process.argv;
const msg = msgParts.join(' ');
const logPath = process.env.CLAUDE_NOTIFIER_LOG
  || path.join(os.homedir(), '.claude', 'notifier.log');

const newId = () => {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 12);
  return (t + r).padEnd(22, '0').slice(0, 22).toUpperCase();
};

const entry = {
  id: newId(),
  ts: Date.now(),
  type,
  msg,
  cwd: process.env.PWD || process.cwd(),
  session: process.env.CLAUDE_SESSION_ID || null,
  pid: process.pid
};

try {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\\n');
} catch (e) {
  process.stderr.write('notifier-emit: ' + e.message + '\\n');
  process.exit(1);
}
`;

const HELPER_PATH = path.join(os.homedir(), '.claude', 'notifier-emit.js');

const DEFAULT_MESSAGES = {
  permission_prompt:  'Claude needs your permission',
  elicitation_dialog: 'Claude has a question for you',
  idle_prompt:        'Claude is waiting for your input',
  stop:               'Claude finished',
  subagent_stop:      'Subagent finished'
};

const HOOK_EVENT_MAP = {
  permission_prompt:  { section: 'Notification', matcher: 'permission_prompt' },
  elicitation_dialog: { section: 'Notification', matcher: 'elicitation_dialog' },
  idle_prompt:        { section: 'Notification', matcher: 'idle_prompt' },
  stop:               { section: 'Stop',         matcher: '' },
  subagent_stop:      { section: 'SubagentStop', matcher: '' }
};

function commandFor(eventType) {
  const msg = DEFAULT_MESSAGES[eventType] || eventType;
  const safeMsg = msg.replace(/'/g, "'\\''");
  const safePath = HELPER_PATH.replace(/'/g, "'\\''");
  return `node '${safePath}' ${eventType} '${safeMsg}' ${SENTINEL}`;
}

function ensureHelper() {
  const dir = path.dirname(HELPER_PATH);
  fs.mkdirSync(dir, { recursive: true });
  let needWrite = true;
  if (fs.existsSync(HELPER_PATH)) {
    const existing = fs.readFileSync(HELPER_PATH, 'utf8');
    const m = existing.match(/_version:\s*(\d+)/);
    const v = m ? parseInt(m[1], 10) : 0;
    needWrite = v < EMIT_HELPER_VERSION;
  }
  if (needWrite) {
    fs.writeFileSync(HELPER_PATH, EMIT_HELPER_SOURCE, { mode: 0o755 });
  }
  try { fs.chmodSync(HELPER_PATH, 0o755); } catch (_) {}
  return { path: HELPER_PATH, wrote: needWrite };
}

function readSettings(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function writeSettings(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function buildHookEntry(eventType) {
  const { matcher } = HOOK_EVENT_MAP[eventType];
  const entry = { hooks: [{ type: 'command', command: commandFor(eventType) }] };
  if (matcher) entry.matcher = matcher;
  return entry;
}

function isManaged(hookEntry) {
  return hookEntry && Array.isArray(hookEntry.hooks)
    && hookEntry.hooks.some(h => typeof h.command === 'string' && h.command.includes(SENTINEL));
}

function mergeHooks(settings, eventTypes) {
  settings.hooks = settings.hooks || {};
  for (const t of eventTypes) {
    const spec = HOOK_EVENT_MAP[t];
    if (!spec) continue;
    const section = spec.section;
    settings.hooks[section] = settings.hooks[section] || [];
    const list = settings.hooks[section];
    const existingIdx = list.findIndex(e => {
      if (!isManaged(e)) return false;
      if (spec.matcher) return e.matcher === spec.matcher;
      return true;
    });
    const fresh = buildHookEntry(t);
    if (existingIdx >= 0) list[existingIdx] = fresh;
    else list.push(fresh);
  }
  return settings;
}

function removeManaged(settings) {
  if (!settings.hooks) return { settings, removed: 0 };
  let removed = 0;
  for (const section of Object.keys(settings.hooks)) {
    const before = settings.hooks[section].length;
    settings.hooks[section] = settings.hooks[section].filter(e => !isManaged(e));
    removed += before - settings.hooks[section].length;
    if (settings.hooks[section].length === 0) delete settings.hooks[section];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return { settings, removed };
}

function removeLegacy(settings) {
  if (!settings.hooks) return { settings, removed: 0 };
  let removed = 0;
  for (const section of Object.keys(settings.hooks)) {
    const before = settings.hooks[section].length;
    settings.hooks[section] = settings.hooks[section].filter(e =>
      !(Array.isArray(e.hooks) && e.hooks.some(h => typeof h.command === 'string' && h.command.includes('/tmp/claude-notify')))
    );
    removed += before - settings.hooks[section].length;
    if (settings.hooks[section].length === 0) delete settings.hooks[section];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return { settings, removed };
}

function targetPaths(scope, workspaceRoot) {
  const global = path.join(os.homedir(), '.claude', 'settings.local.json');
  const workspace = workspaceRoot ? path.join(workspaceRoot, '.claude', 'settings.local.json') : null;
  if (scope === 'global')    return [global];
  if (scope === 'workspace') return workspace ? [workspace] : [];
  if (scope === 'both')      return [global, workspace].filter(Boolean);
  return [global];
}

function install({ scope, workspaceRoot, eventTypes }) {
  const helper = ensureHelper();
  const paths = targetPaths(scope, workspaceRoot);
  const results = [];
  for (const p of paths) {
    const s = readSettings(p);
    const merged = mergeHooks(s, eventTypes);
    writeSettings(p, merged);
    results.push({ path: p, ok: true });
  }
  return { helper, results };
}

function uninstall({ scope, workspaceRoot, alsoLegacy }) {
  const paths = targetPaths(scope, workspaceRoot);
  const results = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) { results.push({ path: p, removed: 0, skipped: true }); continue; }
    const s = readSettings(p);
    const r1 = removeManaged(s);
    const r2 = alsoLegacy ? removeLegacy(r1.settings) : { settings: r1.settings, removed: 0 };
    writeSettings(p, r2.settings);
    results.push({ path: p, removed: r1.removed + r2.removed });
  }
  return { results };
}

function previewJson(eventTypes) {
  const s = {};
  mergeHooks(s, eventTypes);
  return JSON.stringify(s, null, 2);
}

module.exports = {
  install, uninstall, ensureHelper, previewJson,
  targetPaths, commandFor, removeLegacy,
  SENTINEL, EMIT_HELPER_VERSION, HELPER_PATH
};
