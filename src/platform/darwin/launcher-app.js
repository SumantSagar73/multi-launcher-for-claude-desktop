'use strict';

// A small app per account, so it can be opened from Spotlight, Launchpad or the Dock. It does one thing: ask the
// launcher to open that account through the launcher's own multilauncher:// link, which works whether or not the
// launcher is already running (command-line arguments are ignored by macOS for an app that is already running).
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeAccountIconPng } = require('../../icon');

const SCHEME = 'multilauncher';
const FOLDER = 'Multi Launcher Accounts';
const BUNDLE_PREFIX = 'io.github.sumantsagar73.multilauncher.account';

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fileSafe = (s) => String(s).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'Account';

function openUrlFor(profile) {
  return `${SCHEME}://open?id=${encodeURIComponent(profile.id)}`;
}

function infoPlist(profile, name) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${xml(name)}</string>
  <key>CFBundleDisplayName</key><string>${xml(name)}</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_PREFIX}.${xml(profile.id)}</string>
  <key>CFBundleExecutable</key><string>open-account</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`;
}

function iconutil(iconsetDir, out) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/iconutil', ['-c', 'icns', '-o', out, iconsetDir], (err) => (err ? reject(err) : resolve()));
  });
}

// An .icns file from the account's colour. The names and sizes are the ones iconutil expects.
async function writeIcon(profile, resourcesDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cml-iconset-'));
  const set = path.join(tmp, 'AppIcon.iconset');
  fs.mkdirSync(set);
  try {
    const sizes = [
      ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32], ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256], ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
    ];
    for (const [file, size] of sizes) fs.writeFileSync(path.join(set, file), makeAccountIconPng(size, profile.color));
    await iconutil(set, path.join(resourcesDir, 'AppIcon.icns'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Creates (or replaces) ~/Applications/Multi Launcher Accounts/<name>.app for one account.
 * `baseDir` exists only so tests can write somewhere other than the real home folder.
 * Returns { appPath, message }.
 */
async function createAccountLauncher({ profile, baseDir = path.join(os.homedir(), 'Applications') }) {
  const folder = path.join(baseDir, FOLDER);
  const appPath = path.join(folder, `${fileSafe(profile.name)}.app`);
  const contents = path.join(appPath, 'Contents');
  fs.rmSync(appPath, { recursive: true, force: true });
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });

  fs.writeFileSync(path.join(contents, 'Info.plist'), infoPlist(profile, profile.name));
  const exe = path.join(contents, 'MacOS', 'open-account');
  fs.writeFileSync(exe, `#!/bin/sh\nexec /usr/bin/open ${JSON.stringify(openUrlFor(profile))}\n`);
  fs.chmodSync(exe, 0o755);

  let iconNote = '';
  try {
    await writeIcon(profile, path.join(contents, 'Resources'));
  } catch {
    iconNote = ' (it has the default icon: the coloured icon could not be made)';
  }
  return {
    appPath,
    message: `Created "${path.basename(appPath)}" in ~/Applications/${FOLDER}${iconNote}. Open it from Spotlight, or drag it to your Dock.`,
  };
}

module.exports = { createAccountLauncher, openUrlFor, infoPlist, SCHEME };
