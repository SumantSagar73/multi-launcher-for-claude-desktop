#!/bin/bash
# End-to-end check of the built macOS app on a real Mac, against the real Claude Desktop, using scratch folders only.
# Usage: mac-e2e.sh <path to Multi Launcher for Claude Desktop.app>
set -uo pipefail

APP="$1"
FAILS=0
ok()   { echo "PASS  $*"; }
bad()  { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

SCRATCH="$(mktemp -d)"
UD="$SCRATCH/launcher-data"
ACC="$SCRATCH/claude-account"
ID="e2e-account-1"
mkdir -p "$UD" "$ACC"
cat > "$UD/profiles.json" <<EOF
[{"id":"$ID","name":"CI Account","email":"","color":"#6fa8dc","dataDir":"$ACC","createdAt":"2026-01-01T00:00:00.000Z"}]
EOF

mains() { ps -axww -o command= | grep -F -- "--user-data-dir=$ACC" | grep -F "/Claude.app/Contents/MacOS/Claude" | grep -vc -- "--type=" || true; }
wait_for() { # <seconds> <command...>
  local n="$1"; shift
  for _ in $(seq 1 "$n"); do if "$@"; then return 0; fi; sleep 1; done
  return 1
}
one_main() { [ "$(mains)" -ge 1 ]; }
no_main() { [ "$(mains)" -eq 0 ]; }

echo "== bundle =="
PLIST="$APP/Contents/Info.plist"
check "Info.plist is valid" "plutil -lint '$PLIST' >/dev/null"
check "declares the multilauncher:// scheme" "plutil -extract CFBundleURLTypes.0.CFBundleURLSchemes.0 raw '$PLIST' | grep -qx multilauncher"
check "binary has arm64 and x86_64" "lipo -archs '$APP/Contents/MacOS/'*Launcher* 2>/dev/null | grep -q arm64 && lipo -archs '$APP/Contents/MacOS/'*Launcher* | grep -q x86_64"
check "has a signature that verifies (ad hoc)" "codesign --verify --deep --strict '$APP'"

echo "== start the launcher on scratch data =="
open -n --env CML_USER_DATA="$UD" "$APP"
check "launcher process is running" "wait_for 30 pgrep -f 'Multi Launcher for Claude Desktop.app/Contents/MacOS' >/dev/null"
sleep 5

echo "== open the account through the multilauncher:// link =="
open "multilauncher://open?id=$ID"
check "Claude starts on the account's own folder" "wait_for 60 one_main"
check "exactly one Claude main process for that folder" "[ \"\$(mains)\" -eq 1 ]"

echo "== the same link again must focus, not start a duplicate =="
open "multilauncher://open?id=$ID"
sleep 8
check "still exactly one Claude main process" "[ \"\$(mains)\" -eq 1 ]"

echo "== a launcher app generated for the account =="
LAUNCH_DIR="$SCRATCH/launchers"
mkdir -p "$LAUNCH_DIR"
node -e "
const { createAccountLauncher } = require('./src/platform/darwin/launcher-app');
createAccountLauncher({ profile: { id: '$ID', name: 'CI Account', color: '#6fa8dc' }, baseDir: '$LAUNCH_DIR' })
  .then((r) => console.log('made', r.appPath || r.message)).catch((e) => { console.error(e); process.exit(1); });
" || bad "createAccountLauncher ran"
GEN="$(find "$LAUNCH_DIR" -maxdepth 2 -name '*.app' | head -1)"
check "launcher app exists" "[ -n '$GEN' ]"
if [ -n "$GEN" ]; then
  check "launcher Info.plist is valid" "plutil -lint '$GEN/Contents/Info.plist' >/dev/null"
  check "launcher script is executable" "[ -x '$GEN/Contents/MacOS/open-account' ]"
  check "launcher icon is a real icns" "file '$GEN/Contents/Resources/AppIcon.icns' | grep -qi 'icon'"
  open "$GEN"
  sleep 8
  check "opening the launcher app focuses, no duplicate" "[ \"\$(mains)\" -eq 1 ]"
fi

echo "== quit the account =="
pkill -TERM -f -- "--user-data-dir=$ACC" || true
check "Claude for that folder has quit" "wait_for 20 no_main"
check "no leftover helper processes" "! ps -axww -o command= | grep -F -- '--user-data-dir=$ACC' | grep -v grep | grep -q ."

pkill -f 'Multi Launcher for Claude Desktop.app/Contents/MacOS' || true
rm -rf "$SCRATCH"

echo
if [ "$FAILS" -ne 0 ]; then echo "$FAILS check(s) failed"; exit 1; fi
echo "all checks passed"
