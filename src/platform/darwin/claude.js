'use strict';

// Finding, starting, focusing and stopping Claude Desktop on macOS. Every behaviour here was observed on a real Mac
// (see scripts/probe/mac-probe.sh), not assumed:
//   - `open -n -a Claude.app --args --user-data-dir=...` starts a separate instance within about a second
//   - Claude does NOT stop a second copy starting on a data folder that is already in use, so never launch a running
//     account again; bring it forward instead
//   - NSRunningApplication.activate brings one specific instance forward, with no permissions
//   - SIGTERM makes a lone instance exit within a second with nothing left behind

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parsePs, extractUserDataDir, buildInstances, matchInstance, normDir } = require('./psparse');

const BUNDLE_ID = 'com.anthropic.claudefordesktop';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

async function readApp(appPath) {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  if (!fs.existsSync(plist)) return null;
  const plistValue = async (key) => (await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist]).catch(() => '')).trim();
  if ((await plistValue('CFBundleIdentifier')) !== BUNDLE_ID) return null; // some other app that happens to be called Claude
  return {
    appPath,
    exe: path.join(appPath, 'Contents', 'MacOS', 'Claude'),
    version: (await plistValue('CFBundleShortVersionString')) || 'unknown',
  };
}

let cache = { at: 0, value: null };

// The app can live in /Applications, ~/Applications, or wherever the user put it (Spotlight knows).
async function findClaude() {
  if (cache.value && Date.now() - cache.at < 60_000) return cache.value;
  const candidates = [process.env.CML_CLAUDE_APP, '/Applications/Claude.app', path.join(os.homedir(), 'Applications', 'Claude.app')].filter(Boolean);
  try {
    const found = (await run('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == '${BUNDLE_ID}'`])).split('\n').filter(Boolean);
    candidates.push(...found);
  } catch {
    // Spotlight may be off; the usual places are enough most of the time
  }
  for (const candidate of candidates) {
    const app = await readApp(candidate);
    if (app) {
      cache = { at: Date.now(), value: app };
      return app;
    }
  }
  throw new Error('Claude Desktop is not installed. Install it from claude.com/download, then reopen the launcher.');
}

async function scanRows() {
  const out = await run('/bin/ps', ['-axww', '-o', 'pid=,ppid=,rss=,command=']);
  return parsePs(out);
}

async function scanInstances() {
  return buildInstances(await scanRows());
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // exists but belongs to someone else
  }
};

// Bring one running account's window forward. NSRunningApplication needs no permission, unlike driving the menus.
async function focusProfile(_profile, instance) {
  const pid = Number(instance && instance.pid);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('That account is not running.');
  const script = `ObjC.import('AppKit'); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}).activateWithOptions(3);`;
  await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script]);
}

// Start an account. If it is already running, bring it forward instead: two copies on one data folder are not
// prevented by Claude and would fight over the same files.
async function launchProfile(profile) {
  const { appPath } = await findClaude();
  const running = matchInstance(await scanInstances(), profile);
  if (running) return focusProfile(profile, running);
  const args = ['-n', '-a', appPath];
  if (!profile.isDefault) args.push('--args', `--user-data-dir=${profile.dataDir}`);
  await run('/usr/bin/open', args);
}

// Ask the main process(es) to quit, then force whatever is still running on that folder.
async function quitInstance(target) {
  const inst = typeof target === 'object' && target !== null ? target : { pid: target, mains: [target], pids: [target], dataDir: null };
  const mains = inst.mains && inst.mains.length ? inst.mains : [inst.pid];
  for (const pid of mains) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  for (let i = 0; i < 16 && mains.some(alive); i++) await sleep(250);

  const rows = await scanRows();
  const dir = inst.dataDir === null || inst.dataDir === undefined ? null : normDir(inst.dataDir);
  const leftovers = rows.filter((r) => (inst.pids || []).includes(r.pid) || (dir !== null && normDir(extractUserDataDir(r.command) || '') === dir));
  for (const r of leftovers) {
    try {
      process.kill(r.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

module.exports = {
  findClaude,
  scanInstances,
  matchInstance,
  launchProfile,
  focusProfile,
  quitInstance,
  parseUserDataDir: extractUserDataDir,
  norm: normDir,
};
