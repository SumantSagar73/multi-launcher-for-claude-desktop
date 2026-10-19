'use strict';

// Picks the backend for the operating system the launcher is running on. A backend answers every question that depends
// on the OS: find, scan, start and stop Claude Desktop, bring a window forward, create shortcuts, and so on. Anything
// it cannot do is reported in `caps`, and the UI hides that feature instead of showing a button that fails.
const backends = {
  win32: () => require('./win32'),
  darwin: () => require('./darwin'),
};

const load = backends[process.platform];

module.exports = load
  ? load()
  : {
      id: process.platform,
      label: process.platform,
      unsupported: true,
    };
