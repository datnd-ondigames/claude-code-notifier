const vscode = require('vscode');
const fs = require('fs');
const hw = require('./hook-writer');

const PRESETS = {
  Minimal:  ['permission_prompt', 'elicitation_dialog'],
  Standard: ['permission_prompt', 'elicitation_dialog', 'idle_prompt'],
  All:      ['permission_prompt', 'elicitation_dialog', 'idle_prompt', 'stop', 'subagent_stop']
};
const ALL_TYPES = PRESETS.All;

async function pickScope() {
  return vscode.window.showQuickPick(
    [
      { label: 'Global',    description: '~/.claude/settings.local.json (all projects)', value: 'global' },
      { label: 'Workspace', description: '.claude/settings.local.json in current folder', value: 'workspace' },
      { label: 'Both',      description: 'Install in both locations', value: 'both' }
    ],
    { placeHolder: 'Install Claude Notifier hooks where?' }
  );
}

async function pickPreset() {
  return vscode.window.showQuickPick(
    [
      { label: 'Minimal',  description: PRESETS.Minimal.join(', '),  value: 'Minimal'  },
      { label: 'Standard', description: PRESETS.Standard.join(', '), value: 'Standard' },
      { label: 'All',      description: PRESETS.All.join(', '),      value: 'All'      },
      { label: 'Custom',   description: 'Pick individual events',    value: 'Custom'   }
    ],
    { placeHolder: 'Which events to notify on?' }
  );
}

async function pickCustom(defaults) {
  const picks = await vscode.window.showQuickPick(
    ALL_TYPES.map(t => ({ label: t, picked: defaults.includes(t) })),
    { canPickMany: true, placeHolder: 'Select event types' }
  );
  return picks ? picks.map(p => p.label) : null;
}

async function pickSound() {
  return vscode.window.showQuickPick(
    [{ label: 'Yes', value: true }, { label: 'No', value: false }],
    { placeHolder: 'Play sound on notification?' }
  );
}

function workspaceRoot() {
  const f = vscode.workspace.workspaceFolders;
  return f && f[0] ? f[0].uri.fsPath : null;
}

async function runWizard(context, lastPreset) {
  const scope = await pickScope(); if (!scope) return null;
  if (scope.value !== 'global' && !workspaceRoot()) {
    vscode.window.showWarningMessage('Workspace scope needs an open folder.');
    return null;
  }

  const preset = await pickPreset(); if (!preset) return null;
  let events = PRESETS[preset.value];
  if (preset.value === 'Custom') {
    events = await pickCustom(PRESETS[lastPreset] || PRESETS.Standard);
    if (!events || events.length === 0) return null;
  }

  const sound = await pickSound(); if (!sound) return null;

  const preview = hw.previewJson(events);
  const paths = hw.targetPaths(scope.value, workspaceRoot());
  const pathsText = paths.join('\n');
  const legacyWarn = fs.existsSync('/tmp/claude-notify')
    ? '\n\n⚠ Legacy /tmp/claude-notify detected. Run "Claude Notifier: Remove Hooks" with legacy cleanup after install.'
    : '';

  const choice = await vscode.window.showInformationMessage(
    `Install hooks in:\n${pathsText}${legacyWarn}\n\nJSON:\n${preview.slice(0, 1500)}${preview.length > 1500 ? '\n…' : ''}`,
    { modal: true },
    'Install', 'Copy to clipboard'
  );
  if (choice === 'Copy to clipboard') {
    await vscode.env.clipboard.writeText(preview);
    vscode.window.showInformationMessage('Hook JSON copied to clipboard.');
    return null;
  }
  if (choice !== 'Install') return null;

  try {
    const r = hw.install({ scope: scope.value, workspaceRoot: workspaceRoot(), eventTypes: events });
    const cfg = vscode.workspace.getConfiguration('claudeNotifier');
    for (const t of events) {
      await cfg.update(`events.${t}.sound`, sound.value, vscode.ConfigurationTarget.Global);
    }
    await context.globalState.update('claudeNotifier.wizardCompleted', true);
    await context.globalState.update('claudeNotifier.lastPreset', preset.value);
    vscode.window.showInformationMessage(
      'Hooks installed: ' + r.results.map(x => x.path).join(', ') + '. Restart Claude Code for changes to apply.'
    );
    return { events, preset: preset.value };
  } catch (e) {
    const copy = await vscode.window.showErrorMessage(
      'Hook install failed: ' + e.message, 'Copy JSON to clipboard'
    );
    if (copy) await vscode.env.clipboard.writeText(preview);
    return null;
  }
}

async function runRemove() {
  const scope = await vscode.window.showQuickPick(
    [
      { label: 'Global',    value: 'global' },
      { label: 'Workspace', value: 'workspace' },
      { label: 'Both',      value: 'both' }
    ],
    { placeHolder: 'Remove hooks from where?' }
  );
  if (!scope) return;
  const alsoLegacy = await vscode.window.showQuickPick(
    [{ label: 'Also remove /tmp/claude-notify legacy hooks', value: true }, { label: 'Managed hooks only', value: false }],
    { placeHolder: 'Legacy cleanup?' }
  );
  if (!alsoLegacy) return;
  try {
    const r = hw.uninstall({ scope: scope.value, workspaceRoot: workspaceRoot(), alsoLegacy: alsoLegacy.value });
    const total = r.results.reduce((n, x) => n + (x.removed || 0), 0);
    vscode.window.showInformationMessage(`Removed ${total} hook entries.`);
  } catch (e) {
    vscode.window.showErrorMessage('Remove hooks failed: ' + e.message);
  }
}

function register(context, output) {
  const cmds = [
    vscode.commands.registerCommand('claudeNotifier.runWizard', async () => {
      const last = context.globalState.get('claudeNotifier.lastPreset');
      await runWizard(context, last);
    }),
    vscode.commands.registerCommand('claudeNotifier.installHooks', async () => {
      const last = context.globalState.get('claudeNotifier.lastPreset') || 'Standard';
      const events = PRESETS[last] || PRESETS.Standard;
      try {
        hw.install({ scope: 'global', workspaceRoot: workspaceRoot(), eventTypes: events });
        vscode.window.showInformationMessage('Hooks re-installed (preset: ' + last + ').');
      } catch (e) {
        output && output.appendLine('[wizard] install: ' + e.message);
        vscode.window.showErrorMessage('Install failed: ' + e.message);
      }
    }),
    vscode.commands.registerCommand('claudeNotifier.removeHooks', runRemove)
  ];
  for (const c of cmds) context.subscriptions.push(c);
}

async function maybeRunFirstRun(context) {
  if (context.globalState.get('claudeNotifier.wizardCompleted')) return;
  const choice = await vscode.window.showInformationMessage(
    'Welcome to Claude Notifier 2.0. Run setup now?',
    'Run Setup', 'Later'
  );
  if (choice === 'Run Setup') {
    await runWizard(context);
  }
}

module.exports = { register, maybeRunFirstRun, PRESETS };
