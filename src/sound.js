const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const FILE_BY_TYPE = {
  permission_prompt:  'permission.wav',
  elicitation_dialog: 'question.wav',
  idle_prompt:        'idle.wav',
  stop:               'default.wav',
  subagent_stop:      'default.wav'
};

function which(cmd) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    try { const p = path.join(d, cmd); if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
}

function resolvePlayer() {
  if (process.platform === 'darwin') return which('afplay') ? { cmd: 'afplay', args: [] } : null;
  for (const c of ['paplay', 'aplay', 'play']) {
    if (which(c)) return { cmd: c, args: [] };
  }
  return null;
}

function createSound({ mediaRoot, output }) {
  const player = resolvePlayer();
  let missingLogged = false;

  function play(type) {
    if (!player) {
      if (!missingLogged) { output && output.appendLine('[sound] no audio player found on PATH'); missingLogged = true; }
      return;
    }
    const file = FILE_BY_TYPE[type] || FILE_BY_TYPE.stop;
    const full = path.join(mediaRoot, 'sounds', file);
    if (!fs.existsSync(full)) { output && output.appendLine('[sound] missing file ' + full); return; }
    execFile(player.cmd, [...player.args, full], err => {
      if (err) output && output.appendLine('[sound] ' + player.cmd + ' failed: ' + err.message);
    });
  }

  return { play, stop() {} };
}

module.exports = { createSound };
