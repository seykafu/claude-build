#!/usr/bin/env bash
set -euo pipefail
usage='Usage: worktree.sh <slug> [--base <ref>] [--no-setup]'
die() { echo "astra-build: $*" >&2; exit 1; }
[[ ${1:-} != --help ]] || { echo "$usage"; exit 0; }
slug=${1:-}
[[ $slug =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "invalid slug; $usage"
shift
base='' setup=1
while (($#)); do
  case $1 in
    --base) [[ -n ${2:-} ]] || die "$usage"; base=$2; shift 2 ;;
    --no-setup) setup=0; shift ;;
    *) die "$usage" ;;
  esac
done
scripts=$(cd "$(dirname "$0")" && pwd)
root=$(git rev-parse --show-toplevel) || die "not a git worktree"
common=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)
main=$(dirname "$common")
dir="$main-codex/$slug"
if [[ -d $dir ]]; then echo "$dir"; exit 0; fi
branch="codex/$slug"
if git show-ref --verify --quiet "refs/heads/$branch"; then
  die "$branch already exists; delete it with git branch -D $branch if no longer needed"
fi
config=$(node "$scripts/config.mjs" --root "$root" --json) || {
  # Missing config uses the documented base and no setup. Invalid config is fatal.
  [[ $? == 3 ]] || exit 1
  config='{"worktree":{"base":"origin/main","setup":[]}}'
}
if [[ -z $base ]]; then
  base=$(node -pe 'JSON.parse(require("fs").readFileSync(0)).worktree.base' <<< "$config")
fi
if git remote get-url origin >/dev/null 2>&1; then
  git fetch origin --quiet >&2 || die "fetch failed"
elif [[ $base == origin/* ]]; then
  die "no origin remote; use --base <local branch>"
fi
git worktree add -b "$branch" -- "$dir" "$base" >&2 || die "could not create worktree"
if ((setup)); then
  cd "$dir"
  node -e 'for (const s of JSON.parse(require("node:fs").readFileSync(0)).worktree.setup) process.stdout.write(s + "\0")' <<< "$config" |
  while IFS= read -r -d '' command; do
    bash -c "$command" </dev/null >&2 || die "setup failed: $command; worktree left in place at $dir"
  done
fi
echo "$dir"
