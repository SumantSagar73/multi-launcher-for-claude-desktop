// JXA (osascript -l JavaScript): which app is in front right now? Needs no permissions.
// JXA returns zero-argument Objective-C properties directly: do not call them.
ObjC.import('AppKit');

function run() {
  const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  return app.processIdentifier + ' ' + ObjC.unwrap(app.bundleIdentifier) + ' ' + ObjC.unwrap(app.localizedName);
}
