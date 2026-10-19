'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePs, extractUserDataDir, isClaudeMain, buildInstances, matchInstance } = require('../src/platform/darwin/psparse');

// Lines captured from `ps -axww -o pid=,ppid=,rss=,command=` on a real Mac (GitHub runner, macOS 26, Claude 2.42304.2),
// shortened only where Claude's own long option lists were cut. The data folder contains a space.
const APP = '/Applications/Claude.app/Contents';
const DIR_A = '/Users/runner/work/_temp/probe/profile A';
const DIR_B = '/Users/runner/work/_temp/probe/profile B';
const PS = `
 1582     1 332336 ${APP}/MacOS/Claude --user-data-dir=${DIR_A}
 1601  1582  95104 ${APP}/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=gpu-process --user-data-dir=${DIR_A} --gpu-preferences=WAAAAAAAAAAgAQAEAAAAAAAAA
 1602  1582 101984 ${APP}/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=utility --utility-sub-type=network.mojom.NetworkService --lang=en-US --user-data-dir=${DIR_A}
 1620  1582 104160 ${APP}/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer) --type=renderer --user-data-dir=${DIR_A} --standard-schemes=cowork
 1640     1 300000 ${APP}/MacOS/Claude --user-data-dir=${DIR_B}
 1650  1640  90000 ${APP}/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer) --type=renderer --user-data-dir=${DIR_B} --standard-schemes=cowork
 1700     1 310000 ${APP}/MacOS/Claude
 1701  1700  50000 ${APP}/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=gpu-process
 1800     1   5000 /usr/bin/some-other-program --user-data-dir=${DIR_A}
`;

test('parsePs reads pid, parent, memory and the full command', () => {
  const rows = parsePs(PS);
  assert.equal(rows.length, 9);
  assert.deepEqual(rows[0], { pid: 1582, ppid: 1, rssKB: 332336, command: `${APP}/MacOS/Claude --user-data-dir=${DIR_A}` });
  assert.equal(parsePs('').length, 0);
  assert.equal(parsePs('not a ps line').length, 0);
});

test('the data folder is read whole, spaces included, and stops at the next option', () => {
  assert.equal(extractUserDataDir(`${APP}/MacOS/Claude --user-data-dir=${DIR_A}`), DIR_A);
  assert.equal(extractUserDataDir(`x --type=renderer --user-data-dir=${DIR_A} --standard-schemes=cowork`), DIR_A);
  assert.equal(extractUserDataDir(`${APP}/MacOS/Claude`), null);
  assert.equal(extractUserDataDir(null), null);
});

test('only the Claude executable itself counts as a main process', () => {
  assert.equal(isClaudeMain(`${APP}/MacOS/Claude --user-data-dir=${DIR_A}`), true);
  assert.equal(isClaudeMain(`${APP}/MacOS/Claude`), true);
  assert.equal(isClaudeMain(`${APP}/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer) --type=renderer`), false);
  assert.equal(isClaudeMain(`${APP}/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=gpu-process`), false);
  assert.equal(isClaudeMain('/usr/bin/some-other-program --user-data-dir=/x'), false);
  assert.equal(isClaudeMain('/Applications/Multi Launcher for Claude Desktop.app/Contents/MacOS/Multi Launcher for Claude Desktop'), false);
});

test('instances group by data folder, with their helpers and memory', () => {
  const instances = buildInstances(parsePs(PS));
  assert.equal(instances.length, 3, 'accounts A and B and the Default account');
  const a = instances.find((i) => i.dataDir === DIR_A);
  assert.equal(a.pid, 1582);
  assert.deepEqual(a.pids.sort((x, y) => x - y), [1582, 1601, 1602, 1620]);
  assert.equal(a.memBytes, (332336 + 95104 + 101984 + 104160) * 1024);
  const def = instances.find((i) => i.dataDir === null);
  assert.equal(def.pid, 1700);
  assert.deepEqual(def.pids.sort((x, y) => x - y), [1700, 1701]);
  assert.ok(!instances.some((i) => i.pids.includes(1800)), 'an unrelated program with the same option is ignored');
});

test('two copies started on one folder are one account, and quitting reaches both', () => {
  const rows = parsePs(`
 2000     1 300000 ${APP}/MacOS/Claude --user-data-dir=${DIR_A}
 2001  2000  90000 ${APP}/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=gpu-process --user-data-dir=${DIR_A}
 2100     1 310000 ${APP}/MacOS/Claude --user-data-dir=${DIR_A}
 2101  2100  80000 ${APP}/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=gpu-process --user-data-dir=${DIR_A}
`);
  const [only] = buildInstances(rows);
  assert.equal(buildInstances(rows).length, 1);
  assert.deepEqual(only.mains, [2000, 2100]);
  assert.deepEqual(only.pids.sort((x, y) => x - y), [2000, 2001, 2100, 2101]);
  assert.equal(only.pid, 2000, 'the oldest main represents the account');
});

test('matchInstance finds an account by its folder and Default by having none', () => {
  const instances = buildInstances(parsePs(PS));
  assert.equal(matchInstance(instances, { isDefault: false, dataDir: DIR_B }).pid, 1640);
  assert.equal(matchInstance(instances, { isDefault: false, dataDir: `${DIR_B}/` }).pid, 1640, 'a trailing slash does not matter');
  assert.equal(matchInstance(instances, { isDefault: true }).pid, 1700);
  assert.equal(matchInstance(instances, { isDefault: false, dataDir: '/Users/runner/other' }), null);
  assert.equal(matchInstance(instances, { isDefault: false, dataDir: DIR_A.toLowerCase() }), null, 'case-sensitive on purpose');
});
