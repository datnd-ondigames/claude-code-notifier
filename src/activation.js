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
