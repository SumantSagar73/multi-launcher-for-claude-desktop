#!/bin/bash
# Fact-finding on a real macOS machine (a GitHub runner). It records what the launcher's macOS backend relies on, so the
# backend is built from observed behaviour instead of guesses. It only touches a scratch folder under RUNNER_TEMP.

APP="/Applications/Claude.app"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${RUNNER_TEMP:-/tmp}/probe"
rm -rf "$WORK"; mkdir -p "$WORK"
DIR_A="$WORK/profile A"   # a space on purpose: real paths contain one ("Application Support")
DIR_B="$WORK/profile B"

h() { printf '\n\n===== %s =====\n' "$*"; }

main_pid_for() {
  ps -axww -o pid=,command= | grep -F -- "--user-data-dir=$1" | grep -F "Contents/MacOS/Claude" | grep -v -- '--type=' | grep -v grep | awk '{print $1}' | head -1
}
wait_for_main() {
  for i in $(seq 1 60); do
    p="$(main_pid_for "$1")"
    if [ -n "$p" ]; then echo "$p"; return 0; fi
    sleep 1
  done
  return 1
}
front() { osascript -l JavaScript "$HERE/front.js" 2>&1; }
claude_logs() { find "$HOME/Library/Logs" "$WORK" -name '*.log' -path '*laude*' 2>/dev/null | sort; }
count_marker() { # how many sign-in refusals does each known log contain?
  for f in $(claude_logs); do printf '%s  refusals=%s\n' "$f" "$(grep -c 'does not answer a sign-in' "$f" 2>/dev/null)"; done
}

h "system"
sw_vers; uname -m; echo "user: $(whoami)"
pgrep -x WindowServer >/dev/null && echo "WindowServer: running" || echo "WindowServer: NOT running"
echo "console user: $(stat -f%Su /dev/console)"

h "the app"
plutil -extract CFBundleIdentifier raw "$APP/Contents/Info.plist"
plutil -extract CFBundleShortVersionString raw "$APP/Contents/Info.plist"
plutil -extract LSMinimumSystemVersion raw "$APP/Contents/Info.plist"
file "$APP/Contents/MacOS/Claude"
codesign -dv --verbose=2 "$APP" 2>&1 | grep -E 'Identifier|Authority|TeamIdentifier|flags' | head -6

h "default handler for claude:// before anything runs (JXA, no permissions needed)"
osascript -l JavaScript -e "ObjC.import('CoreServices'); var r = \$.LSCopyDefaultHandlerForURLScheme('claude'); r.isNil && r.isNil() ? 'none' : ObjC.unwrap(ObjC.castRefToObject(r))" 2>&1

h "launch account A with open -n"
open -n -a "$APP" --args --user-data-dir="$DIR_A"
PID_A="$(wait_for_main "$DIR_A")"
echo "A main pid: ${PID_A:-NOT FOUND}"
sleep 6
echo "--- ps lines for Claude after A started (note how the path with a space appears)"
ps -axww -o pid=,ppid=,rss=,command= | grep "Claude.app/Contents" | grep -v grep | cut -c1-230

h "launch account B"
open -n -a "$APP" --args --user-data-dir="$DIR_B"
PID_B="$(wait_for_main "$DIR_B")"
echo "B main pid: ${PID_B:-NOT FOUND}"
sleep 6
echo "distinct main processes now: $(ps -axww -o pid=,command= | grep -F 'Contents/MacOS/Claude' | grep -v -- '--type=' | grep -v grep | wc -l | tr -d ' ')"

h "what LaunchServices knows about them"
lsappinfo list 2>/dev/null | grep -i -B1 -A8 'claude' | head -60

h "where the logs went"
echo "--- ~/Library/Logs"; ls -la "$HOME/Library/Logs" 2>&1 | head
echo "--- log files found"; claude_logs
for f in $(claude_logs); do echo "--- head of $f"; head -8 "$f"; done
echo "--- anything under the profile folders that looks like a log or state file?"
find "$DIR_A" "$DIR_B" -maxdepth 2 -type f \( -name '*.log' -o -name 'config.json' -o -name 'lockfile' -o -name 'SingletonLock' \) 2>/dev/null

h "which instance gets an https-less claude:// link? (fake sign-in link, both orders matter)"
echo "before:"; count_marker
open 'claude://login/google-auth?code=PROBE-ONE&anon_id=probe&hop_nonce=probe'
sleep 6
echo "after link 1 (which log gained a refusal?):"; count_marker
echo "--- tail of each log"
for f in $(claude_logs); do echo "--- $f"; tail -5 "$f"; done

lsfront() { # the same question answered without scripting: lsappinfo
  local asn; asn="$(lsappinfo front 2>&1)"; printf '%s -> ' "$asn"; lsappinfo info -only pid "$asn" 2>&1
}
mains_for() { ps -axww -o pid=,command= | grep -F -- "--user-data-dir=$1" | grep -F 'Contents/MacOS/Claude' | grep -v -- '--type=' | grep -v grep | wc -l | tr -d ' '; }
procs_for() { ps -axww -o pid=,command= | grep -F -- "--user-data-dir=$1" | grep -v grep | wc -l | tr -d ' '; }

h "frontmost app, then bring A to the front, then B (JXA NSRunningApplication, no permissions)"
echo "front now (JXA):        $(front)"
echo "front now (lsappinfo):  $(lsfront)"
echo "activate A:             $(osascript -l JavaScript "$HERE/activate.js" "$PID_A" 2>&1)"; sleep 2
echo "front after A (JXA):    $(front)   (expected pid $PID_A)"
echo "front after A (ls):     $(lsfront)"
echo "activate B:             $(osascript -l JavaScript "$HERE/activate.js" "$PID_B" 2>&1)"; sleep 2
echo "front after B (JXA):    $(front)   (expected pid $PID_B)"
echo "front after B (ls):     $(lsfront)"

h "second launch with the SAME user-data-dir while A runs (does the duplicate go away by itself?)"
echo "before: mains=$(mains_for "$DIR_A")"
open -n -a "$APP" --args --user-data-dir="$DIR_A"
for s in 3 8 15; do
  sleep $((s == 3 ? 3 : (s == 8 ? 5 : 7)))
  echo "after ${s}s: main processes for A = $(mains_for "$DIR_A")   all processes carrying A's folder = $(procs_for "$DIR_A")"
done
ps -axww -o pid=,ppid=,command= | grep -F -- "--user-data-dir=$DIR_A" | grep -F 'Contents/MacOS/Claude' | grep -v -- '--type=' | grep -v grep | cut -c1-140

h "quit: SIGTERM to A's main process, then watch the leftovers second by second"
if [ -n "$PID_A" ]; then
  echo "before: processes carrying A's folder = $(procs_for "$DIR_A")"
  kill -TERM "$PID_A"
  for i in 1 2 3 4 5 6 7 8 9 10 12 15; do
    sleep 1
    printf '+%ss  main alive=%s  mains for A=%s  all carrying A=%s\n' "$i" "$(kill -0 "$PID_A" 2>/dev/null && echo yes || echo no)" "$(mains_for "$DIR_A")" "$(procs_for "$DIR_A")"
  done
  echo "--- what is left, and who is its parent?"
  ps -axww -o pid=,ppid=,command= | grep -F -- "--user-data-dir=$DIR_A" | grep -v grep | cut -c1-150
fi
echo "B still running: $(kill -0 "$PID_B" 2>/dev/null && echo yes || echo no)"

h "quit: SIGKILL to B's main process, then are its helpers gone?"
if [ -n "$PID_B" ]; then
  kill -KILL "$PID_B"; sleep 3
  echo "processes still carrying B's folder: $(ps -axww -o pid=,command= | grep -F -- "--user-data-dir=$DIR_B" | grep -v grep | wc -l | tr -d ' ')"
  ps -axww -o pid=,ppid=,command= | grep -F -- "--user-data-dir=$DIR_B" | grep -v grep | cut -c1-160
fi

h "a lone account C: how fast does it start, and does SIGTERM leave anything behind?"
DIR_C="$WORK/profile C"
T0=$(date +%s)
open -n -a "$APP" --args --user-data-dir="$DIR_C"
PID_C="$(wait_for_main "$DIR_C")"
echo "C main pid ${PID_C:-NOT FOUND} appeared after $(( $(date +%s) - T0 ))s"
sleep 8
echo "before SIGTERM: all processes carrying C's folder = $(procs_for "$DIR_C"), mains = $(mains_for "$DIR_C")"
echo "memory (RSS KB) of C's main: $(ps -o rss= -p "$PID_C" | tr -d ' ')"
kill -TERM "$PID_C"
for i in 1 2 3 4 5 6 8 10; do
  sleep 1
  printf '+%ss  main alive=%s  all carrying C=%s\n' "$i" "$(kill -0 "$PID_C" 2>/dev/null && echo yes || echo no)" "$(procs_for "$DIR_C")"
done

h "frontmost detection with lsappinfo while a Claude is up (what the idle feature will poll)"
for k in 1 2 3; do echo "front: $(lsfront)"; sleep 1; done

h "cleanup"
ps -axww -o pid=,command= | grep -F "$WORK" | grep -v grep | awk '{print $1}' | xargs -r kill -KILL 2>/dev/null
echo done
