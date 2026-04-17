const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function createWebview({ context, history, mediaRoot }) {
  let panel = null;

  function buildHtml() {
    const html = fs.readFileSync(path.join(mediaRoot, 'dashboard.html'), 'utf8');
    const cssUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(mediaRoot, 'dashboard.css')));
    const jsUri  = panel.webview.asWebviewUri(vscode.Uri.file(path.join(mediaRoot, 'dashboard.js')));
    return html
      .replace('<!-- __BOOTSTRAP__ -->', `<script>window.__MODE='webview';</script>`)
      .replace('./dashboard.css', cssUri.toString())
      .replace('./dashboard.js',  jsUri.toString());
  }

  function sendHistory() {
    if (!panel) return;
    const payload = history.list().map(e => ({ ...e, _unread: history.isUnread(e.id) }));
    panel.webview.postMessage({ type: 'history', payload });
  }

  function forwardEvent(evt) {
    if (!panel) return;
    panel.webview.postMessage({ type: 'event', payload: evt });
  }

  function open() {
    if (panel) { panel.reveal(vscode.ViewColumn.Beside); return; }
    panel = vscode.window.createWebviewPanel(
      'claudeNotifier', 'Claude Notifier',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.file(mediaRoot)] }
    );
    panel.webview.html = buildHtml();
    panel.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'ready')   sendHistory();
      if (msg.type === 'focus')   { vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup'); history.markRead(msg.id); }
      if (msg.type === 'dismiss') history.markRead(msg.id);
    });
    panel.onDidDispose(() => { panel = null; });
  }

  history.on('event', forwardEvent);

  return {
    open,
    stop() {
      history.off && history.off('event', forwardEvent);
      if (panel) { try { panel.dispose(); } catch (_) {} panel = null; }
    }
  };
}

module.exports = { createWebview };
