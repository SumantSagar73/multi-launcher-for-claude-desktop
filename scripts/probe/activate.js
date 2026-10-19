// JXA (osascript -l JavaScript): bring the app with the given process id to the front. Usage: osascript -l JavaScript activate.js <pid>
ObjC.import('AppKit');

function run(argv) {
  const pid = parseInt(argv[0], 10);
  const target = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  const name = ObjC.unwrap(target.localizedName);
  // 1 = NSApplicationActivateAllWindows, 2 = NSApplicationActivateIgnoringOtherApps
  const ok = target.activateWithOptions(3);
  return 'activate returned ' + ok + ' for pid ' + pid + ' (' + name + ')';
}
