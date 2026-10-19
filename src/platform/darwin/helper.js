'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const readline = require('node:readline');

// On macOS the only window-level job is telling which account is in front, so idle detection and auto-close work.
// `lsappinfo` answers that with no permissions (verified on a real Mac). The loop ends by itself when the launcher
// does, so a crash of the launcher cannot leave it running.
//
// Window styling, tiling and memory trimming do not exist on macOS (they need Accessibility permission or private
// APIs), so those methods accept the same calls as the Windows helper and do nothing.
const SCRIPT = `
last=""
while kill -0 "$CML_PARENT" 2>/dev/null; do
  asn=$(/usr/bin/lsappinfo front 2>/dev/null)
  pid=$(/usr/bin/lsappinfo info -only pid "$asn" 2>/dev/null | /usr/bin/sed -n 's/.*"pid"=\\([0-9][0-9]*\\).*/\\1/p')
  if [ -n "$pid" ] && [ "$pid" != "$last" ]; then echo "fg $pid"; last="$pid"; fi
  sleep 0.7
done
`;

class MacWindowHelper extends EventEmitter {
  constructor() {
    super();
    this.child = null;
  }

  get running() {
    return !!this.child;
  }

  start() {
    if (this.child) return;
    const child = spawn('/bin/sh', ['-c', SCRIPT], {
      env: { ...process.env, CML_PARENT: String(process.pid) },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      const m = /^fg (\d+)$/.exec(line);
      if (m) this.emit('foreground', Number(m[1]));
    });
    child.on('exit', () => {
      if (this.child === child) this.child = null;
    });
    child.on('error', () => {
      if (this.child === child) this.child = null;
    });
    this.child = child;
  }

  stop() {
    const child = this.child;
    this.child = null;
    if (child) child.kill();
  }

  setWindows() {}
  requestTrim() {}
  requestLayout() {}
}

module.exports = { MacWindowHelper, SCRIPT };
