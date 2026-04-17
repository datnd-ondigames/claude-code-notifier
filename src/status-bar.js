const vscode = require('vscode');

function createStatusBar({ config, history, notifier, getPort, output }) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  const CLICK_CMD = 'claudeNotifier._statusBarClick';
  item.command = CLICK_CMD;

  const clickDisposable = vscode.commands.registerCommand(CLICK_CMD, async () => {
    const action = config.get().statusBar.clickAction;
    if (action === 'dashboard') return vscode.commands.executeCommand('claudeNotifier.openDashboard');
    if (action === 'panel')     return vscode.commands.executeCommand('claudeNotifier.openPanel');
    const pick = await vscode.window.showQuickPick(
      ['Open Dashboard', 'Open Panel', 'Run Wizard', 'Clear History', 'Open Settings'],
      { placeHolder: 'Claude Notifier' }
    );
    if (pick === 'Open Dashboard') vscode.commands.executeCommand('claudeNotifier.openDashboard');
    else if (pick === 'Open Panel') vscode.commands.executeCommand('claudeNotifier.openPanel');
    else if (pick === 'Run Wizard') vscode.commands.executeCommand('claudeNotifier.runWizard');
    else if (pick === 'Clear History') vscode.commands.executeCommand('claudeNotifier.clearHistory');
    else if (pick === 'Open Settings') vscode.commands.executeCommand('workbench.action.openSettings', 'claudeNotifier');
  });

  let errorState = false;
  function setError(on) { errorState = !!on; render(); }

  function render() {
    const cfg = config.get();
    if (!cfg.statusBar.enabled) { item.hide(); return; }
    const port = getPort() || '—';
    const unread = history.unreadCount();
    const snoozedUntil = notifier.snoozedUntil();
    const snoozeLeft = snoozedUntil - Date.now();

    if (errorState) {
      item.text = '$(bell-slash) Claude ⚠';
      item.tooltip = 'Claude Notifier error. See output channel.';
    } else if (snoozeLeft > 0) {
      const mins = Math.ceil(snoozeLeft / 60000);
      item.text = `$(bell-slash) Snoozed ${mins}m`;
      item.tooltip = `Snoozed until ${new Date(snoozedUntil).toLocaleTimeString()}`;
    } else if (unread > 0) {
      item.text = `$(bell-dot) Claude (${unread}) :${port}`;
      const hints = history.recentUnread(3).map(e => `• ${e.msg}`).join('\n');
      item.tooltip = `${unread} unread\n${hints}\nClick to open.`;
    } else {
      item.text = `$(bell) Claude :${port}`;
      item.tooltip = 'No unread Claude events.';
    }
    item.show();
  }

  const tick = setInterval(render, 30_000);
  history.on('event', render);
  history.on('read', render);
  history.on('cleared', render);
  const unsubSnooze = notifier.onSnoozeChange(render);
  config.on('change', render);
  render();

  function stop() {
    clearInterval(tick);
    history.off('event', render);
    history.off('read', render);
    history.off('cleared', render);
    unsubSnooze();
    config.off('change', render);
    clickDisposable.dispose();
    item.dispose();
  }

  return { render, setError, stop };
}

module.exports = { createStatusBar };
