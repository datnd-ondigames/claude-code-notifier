const vscode = require('vscode');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const EVENT_TYPES = ['permission_prompt', 'elicitation_dialog', 'idle_prompt', 'stop', 'subagent_stop'];

function readAll() {
  const c = vscode.workspace.getConfiguration('claudeNotifier');
  const logPath = c.get('logPath') || path.join(os.homedir(), '.claude', 'notifier.log');
  const events = {};
  for (const t of EVENT_TYPES) {
    events[t] = {
      enabled:  c.get(`events.${t}.enabled`),
      severity: c.get(`events.${t}.severity`),
      sound:    c.get(`events.${t}.sound`)
    };
  }
  return {
    enabled:             c.get('enabled'),
    logPath,
    suppressWhenFocused: c.get('suppressWhenFocused'),
    showAllWorkspaces:   c.get('showAllWorkspaces'),
    events,
    history:   { maxEntries: c.get('history.maxEntries') },
    statusBar: { enabled: c.get('statusBar.enabled'), clickAction: c.get('statusBar.clickAction') },
    actions:   {
      showFocusWindow:  c.get('actions.showFocusWindow'),
      showOpenTerminal: c.get('actions.showOpenTerminal'),
      showSnooze:       c.get('actions.showSnooze')
    },
    snoozeMinutes: c.get('snoozeMinutes'),
    server: { enabled: c.get('server.enabled'), port: c.get('server.port') },
    osNotifications: {
      enabled:        c.get('osNotifications.enabled'),
      replaceToast:   c.get('osNotifications.replaceToast'),
      requireDismiss: c.get('osNotifications.requireDismiss')
    }
  };
}

function createConfig() {
  const emitter = new EventEmitter();
  let current = readAll();

  const sub = vscode.workspace.onDidChangeConfiguration(e => {
    if (!e.affectsConfiguration('claudeNotifier')) return;
    const prev = current;
    current = readAll();
    emitter.emit('change', current, prev);
  });

  return {
    get: () => current,
    on:  (ev, cb) => emitter.on(ev, cb),
    off: (ev, cb) => emitter.off(ev, cb),
    eventTypes: EVENT_TYPES,
    stop: () => { sub.dispose(); emitter.removeAllListeners(); }
  };
}

module.exports = { createConfig, EVENT_TYPES };
