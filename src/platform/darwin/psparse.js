'use strict';

// Pure parsing of `ps -axww -o pid=,ppid=,rss=,command=` output on macOS, kept free of any process spawning so it can
// be tested anywhere against real captured output.

// macOS prints argv joined with plain spaces, with no quoting, so a data folder such as
// "/Users/me/Library/Application Support/..." appears with its spaces intact.
function parsePs(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*\S)\s*$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), rssKB: Number(m[3]), command: m[4] });
  }
  return rows;
}

// The value of --user-data-dir runs until the next " --" option or the end of the line, because it may contain spaces.
function extractUserDataDir(command) {
  const m = /--user-data-dir=(.*?)(?=\s--[A-Za-z]|\s*$)/.exec(command || '');
  return m ? m[1].trim() : null;
}

// A Claude *main* process: the executable inside Claude.app itself (not one of its helper apps) and no --type=.
const MAIN_RE = /\/Claude\.app\/Contents\/MacOS\/Claude(?:\s|$)/;
const isClaudeMain = (command) => MAIN_RE.test(command || '') && !/\s--type=/.test(command || '');

// Folder paths that name the same place compare equal: trailing slashes and doubled slashes do not matter. The
// comparison is case-sensitive on purpose (a case-sensitive volume can hold two folders that differ only in case).
const normDir = (p) => String(p || '').replace(/\/+/g, '/').replace(/\/+$/, '');

/**
 * Running Claude accounts, one per data folder (null = the Default account).
 * Claude on macOS does not stop a second copy from starting on the same folder, so several main processes can belong
 * to one account; they are merged into one entry so that quitting closes all of them.
 * Returns [{ pid, mains, dataDir|null, pids, memBytes }]
 */
function buildInstances(rows) {
  const children = new Map();
  for (const r of rows) {
    if (!children.has(r.ppid)) children.set(r.ppid, []);
    children.get(r.ppid).push(r);
  }
  const treeOf = (row, seen) => {
    if (seen.has(row.pid)) return [];
    seen.add(row.pid);
    return [row, ...(children.get(row.pid) || []).flatMap((c) => treeOf(c, seen))];
  };

  const byDir = new Map(); // normalised dir ('' for Default) -> instance
  for (const main of rows.filter((r) => isClaudeMain(r.command)).sort((a, b) => a.pid - b.pid)) {
    const dataDir = extractUserDataDir(main.command);
    const key = dataDir === null ? '' : normDir(dataDir);
    let inst = byDir.get(key);
    if (!inst) {
      inst = { pid: main.pid, mains: [], dataDir, pids: [], memBytes: 0 };
      byDir.set(key, inst);
    }
    inst.mains.push(main.pid);
    for (const r of treeOf(main, new Set(inst.pids))) {
      if (!inst.pids.includes(r.pid)) {
        inst.pids.push(r.pid);
        inst.memBytes += r.rssKB * 1024;
      }
    }
  }
  return [...byDir.values()];
}

// Which running instance belongs to this account?
function matchInstance(instances, profile) {
  if (profile.isDefault) return instances.find((i) => i.dataDir === null) || null;
  const want = normDir(profile.dataDir);
  return instances.find((i) => i.dataDir !== null && normDir(i.dataDir) === want) || null;
}

module.exports = { parsePs, extractUserDataDir, isClaudeMain, buildInstances, matchInstance, normDir };
