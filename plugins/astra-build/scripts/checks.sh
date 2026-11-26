#!/usr/bin/env bash
set -euo pipefail
usage='Usage: checks.sh --cwd <worktree>'
die() { echo "astra-build: $*" >&2; exit 2; }
[[ ${1:-} != --help ]] || { echo "$usage"; exit 0; }
[[ $# == 2 && $1 == --cwd ]] || die "$usage"
scripts=$(cd "$(dirname "$0")" && pwd)
cd "$2" || die "invalid worktree"
root=$(git rev-parse --show-toplevel) || die "not a worktree"
cd "$root"
config=$(node "$scripts/config.mjs" --root "$PWD" --json) || die 'checks require a valid .claude/build.json'
common=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)
logs="$common/astra-build-checks/${PWD##*/}"
rm -rf -- "$logs"
mkdir -p "$logs"
# Decode the complete command list before running any checks so a read error
# cannot be mistaken for an empty (passing) suite.
list=$(mktemp "$logs/.commands.XXXXXX")
trap 'rm -f -- "$list"' EXIT
node -e 'for (const s of JSON.parse(require("node:fs").readFileSync(0)).checks) process.stdout.write(s + "\0")' <<< "$config" >"$list" || die "could not read check commands"
count=0 failures=0
while IFS= read -r -d '' command; do
  count=$((count + 1))
  name=$(LC_ALL=C tr -cs 'a-zA-Z0-9._-' '-' <<< "$command" | cut -c 1-80)
  log=$(printf '%s/%02d-%s.log' "$logs" "$count" "${name%-}")
  start=$SECONDS
  if bash -c "$command" </dev/null >"$log" 2>&1; then
    printf 'PASS  %s  (%ss)\n' "$command" "$((SECONDS-start))"
  else
    status=$?
    printf 'FAIL  %s  (exit %s, %ss)  log: %s\n' "$command" "$status" "$((SECONDS-start))" "$log"
    commands[$failures]=$command
    paths[$failures]=$log
    failures=$((failures + 1))
  fi
done < "$list"
for ((i=0; i<failures; i++)); do
  printf -- '--- %s ---\n' "${commands[$i]}"
  tail -n 30 "${paths[$i]}"
done
if ((count == 0)); then echo 'astra-build: no checks in .claude/build.json; nothing gates this change'; fi
((failures == 0))
