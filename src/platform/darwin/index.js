'use strict';

// The macOS backend. See src/platform/index.js for the interface and src/platform/win32/index.js for the Windows one.
//
// Differences that shape it, all observed on a real Mac:
//   - Claude signs in with an in-app sheet (ASWebAuthenticationSession), so there is no browser link to route.
//   - All Claude instances write to one shared ~/Library/Logs/Claude, so logs cannot say which account did what.
//   - Window styling, tiling and memory trimming are not possible without Accessibility permission or private APIs.
const claude = require('./claude');
const { MacWindowHelper } = require('./helper');
const { createAccountLauncher } = require('./launcher-app');

module.exports = {
  id: 'darwin',
  label: 'macOS',

  caps: {
    windowIdentity: false,
    trim: false,
    tile: false,
    linkRouting: false,
    foreground: true,
    shortcuts: true,
    autostart: true,
  },

  ui: {
    shortcutTitle: 'Make a launcher app for this account (in ~/Applications)',
    autostartLabel: 'Start at login',
    autostartHint: 'Opens the launcher in the menu bar when you log in.',
    chrome: 'inset',
  },

  userDataName: 'Multi Launcher for Claude Desktop',
  hotkeyLabel: (slot) => `⌃⌥${slot}`,
  hotkeyAccelerator: (slot) => `Control+Alt+${slot}`,

  claude,
  createWindowHelper: () => new MacWindowHelper(),
  createLinkWatcher: null,

  async createAccountLauncher({ profile, isPackaged }) {
    if (!isPackaged) throw new Error('Launcher apps need the installed app. Install it from the .dmg, then use the installed copy.');
    return (await createAccountLauncher({ profile })).message;
  },

  async healthChecks() {
    return [];
  },
  fixHealth: async () => {},
  fixedHealthMessage: '',
};
