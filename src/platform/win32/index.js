'use strict';

// The Windows backend: everything the launcher needs from the operating system, behind one interface (see
// src/platform/index.js). The pieces are the existing Windows modules, unchanged.
const fs = require('node:fs');
const path = require('node:path');

const claude = require('./claude');
const { LinkWatcher } = require('./linkwatch');
const { WindowHelper } = require('./winhelper');
const { createShortcut } = require('./shortcut');
const { findLeftovers, removeLeftovers } = require('./handlercheck');
const { pngsToIco } = require('../../ico');
const { makeAccountIconPng } = require('../../icon');

module.exports = {
  id: 'win32',
  label: 'Windows',

  // What this platform can do. The UI hides anything that is false.
  caps: {
    windowIdentity: true, // own taskbar button, coloured icon and title prefix per account
    trim: true, // give back idle memory
    tile: true, // arrange account windows in a grid
    linkRouting: true, // pass a browser sign-in link to the account that started it
    foreground: true, // can tell which account window is in front (idle detection)
    shortcuts: true,
    autostart: true,
  },

  ui: {
    shortcutTitle: 'Make a Start Menu shortcut for this account',
    autostartLabel: 'Start with Windows',
    autostartHint: 'Opens the launcher in the tray when you sign in to Windows.',
    chrome: 'overlay',
  },

  // The data folder name the earlier prototype used, kept so existing installs find their accounts.
  userDataName: 'Claude Multi Launcher',
  hotkeyLabel: (slot) => `Ctrl+Alt+${slot}`,
  hotkeyAccelerator: (slot) => `Control+Alt+${slot}`,

  claude,
  createWindowHelper: (dir) => new WindowHelper(dir),
  createLinkWatcher: (dir) => new LinkWatcher(dir),

  // Claude's own log, read only to notice that an account opened its sign-in page.
  defaultLogPath: () => path.join(process.env.LOCALAPPDATA || '', 'Claude', 'logs', 'main.log'),
  profileLogPath: (profile) => path.join(profile.dataDir, 'logs', 'main.log'),

  // A Start Menu shortcut that opens one account. Returns a sentence for the Activity list.
  async createAccountLauncher({ profile, userDataDir, appDataDir, execPath, isPackaged }) {
    if (!isPackaged) {
      throw new Error('Shortcuts need the installed app: run "npm run package" then "npm run install-app", then use the installed copy.');
    }
    const iconDir = path.join(userDataDir, 'icons');
    fs.mkdirSync(iconDir, { recursive: true });
    const iconPath = path.join(iconDir, `${profile.id}.ico`);
    const sizes = [16, 32, 48, 256];
    fs.writeFileSync(iconPath, pngsToIco(sizes, sizes.map((s) => makeAccountIconPng(s, profile.color))));

    const startMenuDir = path.join(appDataDir, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Multi Launcher for Claude Desktop');
    fs.mkdirSync(startMenuDir, { recursive: true });
    const safeName = profile.name.replace(/[\\/:*?"<>|]/g, '_');
    await createShortcut({
      linkPath: path.join(startMenuDir, `${safeName}.lnk`),
      targetPath: execPath,
      args: `--open="${profile.name}"`,
      workingDir: path.dirname(execPath),
      iconPath,
      description: `Open ${profile.name} in Multi Launcher for Claude Desktop`,
    });
    return `Created a Start Menu shortcut for ${profile.name}. Search "${safeName}" in the Start menu, or run it with --open="${profile.name}".`;
  },

  // Extra health checks and a fix for them.
  async healthChecks() {
    const leftovers = await findLeftovers();
    return [
      {
        label: 'Sign-in link handling is clean',
        ok: leftovers.length === 0,
        detail: leftovers.length === 0 ? 'no leftover registration' : 'a leftover registration could make Windows show an "Open with" prompt for Claude links',
        fixable: leftovers.length > 0,
      },
    ];
  },
  fixHealth: () => removeLeftovers(),
  fixedHealthMessage: 'Removed a leftover Windows registration for claude:// links.',
};
