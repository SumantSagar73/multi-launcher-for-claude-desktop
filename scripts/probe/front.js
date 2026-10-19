// JXA (osascript -l JavaScript): which app is in front right now? Needs no permissions.
ObjC.import('AppKit');

// JXA exposes zero-argument Objective-C methods as bridged functions that must be called as methods (no .call).
function read(object, name) {
  const value = object[name];
  return typeof value === 'function' ? object[name]() : value;
}

function run() {
  try {
    const app = read($.NSWorkspace.sharedWorkspace, 'frontmostApplication');
    const pid = read(app, 'processIdentifier');
    const bundle = ObjC.unwrap(read(app, 'bundleIdentifier'));
    const name = ObjC.unwrap(read(app, 'localizedName'));
    return pid + ' ' + bundle + ' ' + name;
  } catch (e) {
    return 'ERROR ' + e;
  }
}
