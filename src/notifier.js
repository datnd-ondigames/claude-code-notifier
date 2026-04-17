const vscode = require('vscode');
const { execFile } = require('child_process');

function showToast(severity, msg, buttons) {
  const fn = severity === 'error'   ? vscode.window.showErrorMessage
           : severity === 'warning' ? vscode.window.showWarningMessage
           :                          vscode.window.showInformationMessage;
  return fn('Claude: ' + msg, ...buttons.map(b => b.label));
}

function focusWindowOS(output) {
  if (process.platform === 'darwin') {
    execFile('osascript', ['-e', 'tell application "Visual Studio Code" to activate'], err => {
      if (err) output && output.appendLine('[notifier] osascript: ' + err.message);
    });
  } else if (process.platform === 'linux') {
    execFile('wmctrl', ['-a', 'Visual Studio Code'], err => {
      if (err) output && output.appendLine('[notifier] wmctrl: ' + err.message);
    });
  }
}

function createNotifier({ config, history, sound, getFocused, getWorkspaceCwd, getPort, output }) {
  let snoozedUntil = 0;
  const snoozeListeners = new Set();
  const onSnoozeChange = cb => { snoozeListeners.add(cb); return () => snoozeListeners.delete(cb); };
  const fireSnooze = () => { for (const cb of snoozeListeners) cb(snoozedUntil); };

  function isSnoozed() { return Date.now() < snoozedUntil; }

  function matchesWorkspace(evt) {
    if (config.get().showAllWorkspaces) return true;
    const wcwd = getWorkspaceCwd();
    if (!wcwd || !evt.cwd) return true;
    return evt.cwd === wcwd;
  }

  function buildButtons() {
    const cfg = config.get();
    const btns = [];
    if (cfg.actions.showFocusWindow)  btns.push({ label: 'Focus Window',     action: 'focus' });
    if (cfg.actions.showOpenTerminal) btns.push({ label: 'Open Terminal',    action: 'terminal' });
    if (cfg.server.enabled)           btns.push({ label: 'Open Dashboard',   action: 'dashboard' });
    if (cfg.actions.showSnooze)       btns.push({ label: `Snooze ${cfg.snoozeMinutes}m`, action: 'snooze' });
    return btns.slice(0, 3);
  }

  async function runAction(action) {
    if (action === 'focus') {
      focusWindowOS(output);
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    } else if (action === 'terminal') {
      await vscode.commands.executeCommand('workbench.action.terminal.focus');
    } else if (action === 'dashboard') {
      const port = getPort();
      if (port) await vscode.env.openExternal(vscode.Uri.parse('http://127.0.0.1:' + port));
    } else if (action === 'snooze') {
      snoozedUntil = Date.now() + config.get().snoozeMinutes * 60_000;
      fireSnooze();
    }
  }

  function handle(evt) {
    const cfg = config.get();
    if (!cfg.enabled) return;
    const e = cfg.events[evt.type];
    if (!e || !e.enabled) return;
    if (!matchesWorkspace(evt)) return;
    if (isSnoozed()) return;
    if (cfg.suppressWhenFocused && getFocused()) return;

    const buttons = buildButtons();
    showToast(e.severity, evt.msg, buttons).then(chosen => {
      if (!chosen) return;
      const hit = buttons.find(b => b.label === chosen);
      if (hit) runAction(hit.action).catch(err => output && output.appendLine('[notifier] ' + err.message));
      history.markRead(evt.id);
    });

    if (e.sound) sound.play(evt.type);
  }

  return {
    handle,
    isSnoozed,
    snoozedUntil: () => snoozedUntil,
    unsnooze: () => { snoozedUntil = 0; fireSnooze(); },
    onSnoozeChange,
    stop() { snoozeListeners.clear(); }
  };
}

module.exports = { createNotifier };
