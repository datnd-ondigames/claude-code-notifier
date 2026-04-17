const vscode = require('vscode');

let disposables = [];
let output;

function activate(context) {
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
