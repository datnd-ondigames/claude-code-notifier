const vscode = require('vscode');

let disposables = [];
let output;

async function activate(context) {
  output = vscode.window.createOutputChannel('Claude Notifier');
  output.appendLine('[activation] Claude Notifier 2.0 starting');

  const { createConfig } = require('./config');
  const config = createConfig();
  output.appendLine('[activation] config: ' + JSON.stringify(config.get()));
  config.on('change', next => output.appendLine('[config] changed, enabled=' + next.enabled));
  disposables.push(config);

  const { createHistoryStore } = require('./history-store');
  const { createLogTailer } = require('./log-tailer');

  const history = createHistoryStore({ maxEntries: config.get().history.maxEntries });
  const tailer = createLogTailer({ getLogPath: () => config.get().logPath, output });
  tailer.on('event', evt => {
    const added = history.add(evt);
    if (added) output.appendLine('[history] + ' + added.type + ' ' + added.id);
  });
  tailer.start();
  disposables.push({ stop: () => tailer.stop() }, history);

  config.on('change', (next, prev) => {
    if (next.history.maxEntries !== prev.history.maxEntries) history.setMax(next.history.maxEntries);
    if (next.logPath !== prev.logPath) { tailer.stop(); tailer.start(); }
  });

  const { createSound } = require('./sound');
  const sound = createSound({ mediaRoot: context.asAbsolutePath('media'), output });
  context.subscriptions.push(vscode.commands.registerCommand('claudeNotifier._testSound', () => sound.play('permission_prompt')));

  const { createNotifier } = require('./notifier');

  function getFocused() { return vscode.window.state.focused; }
  function getWorkspaceCwd() {
    const f = vscode.workspace.workspaceFolders;
    return f && f[0] ? f[0].uri.fsPath : null;
  }
  let serverPort = 0;

  const notifier = createNotifier({
    config, history, sound, output,
    getFocused, getWorkspaceCwd,
    getPort: () => serverPort
  });
  history.on('event', evt => notifier.handle(evt));
  disposables.push(notifier);

  const { createStatusBar } = require('./status-bar');
  const statusBar = createStatusBar({ config, history, notifier, getPort: () => serverPort, output });
  disposables.push(statusBar);

  const wizard = require('./wizard');
  wizard.register(context, output);
  wizard.maybeRunFirstRun(context).catch(e => output.appendLine('[wizard] ' + e.message));

  const { createServer } = require('./server');
  const server = createServer({ config, history, mediaRoot: context.asAbsolutePath('media'), output });
  server.on('focus', ({ id }) => {
    vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    history.markRead(id);
  });
  server.on('dismiss', ({ id }) => history.markRead(id));
  await server.start();
  serverPort = server.getPort();
  disposables.push(server);

  config.on('change', async (next, prev) => {
    if (next.server.enabled !== prev.server.enabled || next.server.port !== prev.server.port) {
      server.stop();
      await server.start();
      serverPort = server.getPort();
    }
  });

  context.subscriptions.push(vscode.commands.registerCommand('claudeNotifier.openDashboard', () => {
    if (!serverPort) { vscode.window.showWarningMessage('Dashboard server not running.'); return; }
    vscode.env.openExternal(vscode.Uri.parse('http://127.0.0.1:' + serverPort));
  }));

  const { createWebview } = require('./webview');
  const webview = createWebview({ context, history, mediaRoot: context.asAbsolutePath('media') });
  context.subscriptions.push(vscode.commands.registerCommand('claudeNotifier.openPanel', () => webview.open()));
  disposables.push(webview);

  const testCmd = vscode.commands.registerCommand('claude-notifier.notify', () => {
    vscode.window.showInformationMessage('Claude Notifier test notification');
  });
  context.subscriptions.push(testCmd);

  context.subscriptions.push({ dispose: () => shutdown() });
}

function shutdown() {
  for (const d of disposables) {
    try { d.stop ? d.stop() : d.dispose && d.dispose(); } catch (e) { output && output.appendLine('[shutdown] ' + e.message); }
  }
  disposables = [];
}

function deactivate() { shutdown(); }

module.exports = { activate, deactivate };
