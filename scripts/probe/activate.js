// JXA (osascript -l JavaScript): bring the app with the given process id to the front. Usage: osascript -l JavaScript activate.js <pid>
ObjC.import('AppKit');

function read(object, name) {
  const value = object[name];
  return typeof value === 'function' ? value.call(object) : value;
}

function run(argv) {
  try {
    const pid = parseInt(argv[0], 10);
    const target = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
    if (!target || (target.isNil && target.isNil())) return 'no running app with pid ' + pid;
    // 2 = NSApplicationActivateIgnoringOtherApps; 1 = NSApplicationActivateAllWindows
    const ok = target.activateWithOptions(3);
    return 'activate returned ' + ok + ' for pid ' + pid + ' (' + ObjC.unwrap(read(target, 'localizedName')) + ')';
  } catch (e) {
    return 'ERROR ' + e;
  }
}
