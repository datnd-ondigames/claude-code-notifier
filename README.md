# Claude Code Notifier 2.0

VS Code extension that turns Claude Code hook events into toasts, a history panel, a status bar badge, and a live dashboard (in-editor webview or external browser tab).

## Install

```bash
code --install-extension erdemgiray.claude-code-notifier
```

First launch shows a welcome toast. Click **Run Setup** and pick:

- **Scope:** Global (all projects) / Workspace (current folder) / Both
- **Preset:** Minimal / Standard / All / Custom
- **Sound:** on or off

The wizard installs a small helper script at `~/.claude/notifier-emit.js` and merges hook entries into `settings.local.json`. Every managed entry ends with `# claude-code-notifier` so re-install and uninstall are idempotent. Restart Claude Code for the hooks to take effect.

## Commands

- `Claude Notifier: Run Setup Wizard`
- `Claude Notifier: Install Hooks` — re-install the last-used preset
- `Claude Notifier: Remove Hooks` — walk settings files, remove managed entries; optional cleanup of legacy `/tmp/claude-notify` hooks
- `Claude Notifier: Open Panel` — in-editor webview
- `Claude Notifier: Open Dashboard in Browser` — external SSE dashboard
- `Claude Notifier: Clear History`
- `Claude Notifier: Show Log File`

## Dashboard

Local HTTP server binds `127.0.0.1` only, auto-picks a port starting at `37100`. One server per VS Code window. Status bar shows `Claude :<port>` plus unread count.

## Settings

See `package.json` `contributes.configuration` for the full list. Highlights:

- `claudeNotifier.suppressWhenFocused` — skip toast/sound while window is focused; history still records.
- `claudeNotifier.showAllWorkspaces` — by default toasts only fire for events whose `cwd` matches this window's folder.
- `claudeNotifier.events.<type>.{enabled,severity,sound}` — per-event controls for permission_prompt, elicitation_dialog, idle_prompt, stop, subagent_stop.

## Legacy 1.x

1.x watched `/tmp/claude-notify` and only supported plain-text messages. On 2.0 activation a one-time toast asks to migrate. Use `Claude Notifier: Remove Hooks` with legacy cleanup selected, then rerun the wizard.

## License

MIT
