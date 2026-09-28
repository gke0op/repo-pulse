#!/bin/bash
# Rebuilds build A and every A/B branch on top of the main line, then copies the APKs to
# ~/Desktop/companion/ab/. Run from the repo root on the main line after committing there.
# Each ab/* branch is one commit (a flag + its versionName); rebase conflicts on the version lines
# resolve to "<main versionName minus -A>-B-<name>". Gates on gradle's exit code.
set -u
MAIN=${MAIN:-claude/deprecated-repo-cleanup-playground-fle50c}
OUT=~/Desktop/companion/ab
export JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}
LOG=$(mktemp)
[ "$(git branch --show-current)" = "$MAIN" ] || { echo "switch to $MAIN first"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "commit first"; exit 1; }
BASE=$(grep -o 'versionName = "[^"]*"' app/build.gradle.kts | sed 's/.*"\(.*\)-A"/\1/')
CODE=$(grep -o 'versionCode = [0-9]*' app/build.gradle.kts | grep -o '[0-9]*')
mkdir -p "$OUT"
build() {
  rm -rf app/build/outputs/apk
  if ./gradlew --console=plain :app:testDebugUnitTest :app:assembleDebug > "$LOG" 2>&1; then
    cp "app/build/outputs/apk/debug/companion-$1-debug.apk" "$OUT/" && echo "$1 ok"
  else echo "$1 FAILED (see $LOG)"; grep FAILED "$LOG" | head -3; return 1; fi
}
build "$BASE-A" || exit 1
for BR in $(git branch --list 'ab/*' --format='%(refname:short)'); do
  NAME=${BR#ab/}; NAME=${NAME//-/}   # ab/voice-first -> voicefirst
  git switch -q "$BR" && { git rebase -q "$MAIN" >/dev/null 2>&1 || true; }
  if grep -q '<<<<<<<' app/build.gradle.kts; then
    python3 - "$CODE" "$BASE-B-$NAME" <<'PY'
import re, sys
p = 'app/build.gradle.kts'; s = open(p).read()
s = re.sub(r'<<<<<<< [^\n]*\n.*?=======\n.*?>>>>>>> [^\n]*\n',
           '        versionCode = %s\n        versionName = "%s"\n' % (sys.argv[1], sys.argv[2]), s, flags=re.S)
open(p, 'w').write(s)
PY
    git add app/build.gradle.kts; GIT_EDITOR=true git rebase --continue >/dev/null 2>&1
  fi
  if grep -q '<<<<<<<' -r app/src 2>/dev/null; then echo "$BR: unexpected conflict, stopping"; exit 1; fi
  echo "$BR vs A: $(git diff --stat "$MAIN" | tail -1)"
  build "$(grep -o 'versionName = "[^"]*"' app/build.gradle.kts | sed 's/.*"\(.*\)"/\1/')"
done
git switch -q "$MAIN"
ls "$OUT"
