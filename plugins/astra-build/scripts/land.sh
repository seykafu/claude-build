#!/usr/bin/env bash
set -euo pipefail
usage='Usage: land.sh --cwd <worktree> --message <file> [--cleanup]'
die() { echo "astra-build: $*" >&2; exit 1; }
cwd='' message='' cleanup=0
while (($#)); do
  case $1 in
    --cwd) [[ -n ${2:-} ]] || die "$usage"; cwd=$2; shift 2 ;;
    --message) [[ -n ${2:-} ]] || die "$usage"; message=$2; shift 2 ;;
    --cleanup) cleanup=1; shift ;;
    --help) echo "$usage"; exit 0 ;;
    *) die "$usage" ;;
  esac
done
[[ -d $cwd && -f $message ]] || die "$usage"
message=$(cd "$(dirname "$message")" && pwd)/$(basename "$message")
scripts=$(cd "$(dirname "$0")" && pwd)
cd "$cwd"
root=$(git rev-parse --show-toplevel) || die "not a worktree"
cd "$root"
common=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)
main=$(dirname "$common")
branch=$(git symbolic-ref -q --short HEAD) || die "detached task branch"
[[ $branch == codex/* && $(pwd -P) != "$main" ]] || die "expected a linked worktree on a codex/ branch"
land=$(node "$scripts/config.mjs" --root "$root" --get land) || die "valid .claude/build.json required"
base=$(node "$scripts/config.mjs" --root "$root" --get worktree.base) || exit 1
target=${base#origin/}
git check-ref-format --branch "$target" >/dev/null || die "invalid target branch"
origin=0
if url=$(git remote get-url origin 2>/dev/null); then origin=1; fi
if [[ $land == pr && $origin == 0 ]]; then die "a pull request requires an origin remote"; fi
git add -A || die "staging changes failed"
if ! git diff --cached --quiet; then
  git commit -F "$message" || die "commit failed"
fi
if ((origin)); then
  git fetch origin || die "fetch failed"
  upstream="refs/remotes/origin/$target"
else
  upstream="refs/heads/$target"
fi
count=$(git rev-list --count "$upstream..HEAD") || die "cannot resolve target $target"
((count)) || die "nothing to land"
if ((origin)); then
  # Retain the gate across retries after a failed check or interrupted rebase.
  pending=$(git rev-parse --git-path astra-build-checks-pending)
  if ! git merge-base --is-ancestor "$upstream" HEAD; then touch "$pending"; fi
  if ! git rebase "$upstream"; then
    git rebase --abort || true
    die "rebase on $upstream failed; resolve the conflict before landing"
  fi
  if [[ -e $pending ]]; then
    "$scripts/checks.sh" --cwd "$root" || die "checks failed after rebase; nothing pushed"
    rm "$pending"
  fi
fi
summary=$(git log -1 --format='%h %s')
if [[ $land == pr ]]; then
  git push -u origin "HEAD:refs/heads/$branch" || die "push failed"
  case "$url" in
    https://github.com/*) repo=${url#https://github.com/} ;;
    git@github.com:*) repo=${url#git@github.com:} ;;
    *) repo='' ;;
  esac
  if [[ -n $repo ]]; then
    repo=${repo%/}
    echo "https://github.com/${repo%.git}/compare/$target...$branch?expand=1"
  else
    echo "astra-build: open a pull request on the host for $branch into $target"
  fi
  if ((cleanup)); then echo "astra-build: ignoring --cleanup until the PR merges"; fi
else
  merge_ref=$branch
  if ((origin)); then
    git push origin "HEAD:refs/heads/$target" || die "push failed"
    merge_ref=$upstream
  fi
  if [[ $(git -C "$main" symbolic-ref -q HEAD) == "refs/heads/$target" ]] &&
     changes=$(git -C "$main" status --porcelain) && [[ -z $changes ]]; then
    if ! git -C "$main" merge --ff-only "$merge_ref"; then
      ((origin)) || die "could not fast-forward main checkout"
      echo "astra-build: pushed, but couldn't fast-forward the main checkout at $main; update it by hand" >&2
    fi
  else
    echo "astra-build: main checkout wasn't updated; it must be clean and on $target" >&2
    ((origin)) || exit 1
  fi
  if ((cleanup)); then
    cd "$main"
    git worktree remove "$root" || die "could not remove worktree"
    git branch -D "$branch" || die "could not delete landed branch"
  fi
fi
echo "$summary"
