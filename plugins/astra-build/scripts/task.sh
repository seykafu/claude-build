#!/usr/bin/env bash
set -euo pipefail
usage='Usage: task.sh <spec.md> --cwd <worktree> [--resume] [--effort <level>]'
die() { echo "astra-build: $*" >&2; exit 2; }
spec='' cwd='' effort='' resume=0
while (($#)); do
  case $1 in
    --cwd) [[ -n ${2:-} ]] || die "$usage"; cwd=$2; shift 2 ;;
    --effort) [[ -n ${2:-} ]] || die "$usage"; effort=$2; shift 2 ;;
    --resume) resume=1; shift ;;
    --help|-h) echo "$usage"; echo "Run one astra-build task through the Codex companion."; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) [[ -z $spec ]] || die "one spec file only"; spec=$1; shift ;;
  esac
done
[[ -f $spec && -d $cwd ]] || die "$usage"
spec=$(cd "$(dirname "$spec")" && pwd)/$(basename "$spec")
cwd=$(cd "$cwd" && pwd)
scripts=$(cd "$(dirname "$0")" && pwd)
root=$(git -C "$cwd" rev-parse --show-toplevel) || die "$cwd is not a git checkout"
if model=$(node "$scripts/config.mjs" --root "$root" --get model); then
  minimum=$(node "$scripts/config.mjs" --root "$root" --get minCodexCli) || exit 2
else
  [[ $? == 3 ]] || exit 2
  model=gpt-6.2-astra
  minimum=0.169.0
fi
cli=$(codex --version 2>/dev/null | awk '{print $NF}') || die "codex CLI not found (npm install -g @openai/codex)"
[[ -n $cli ]] || die "could not read codex CLI version"
if [[ $(printf '%s\n%s\n' "$minimum" "$cli" | sort -V | head -1) != "$minimum" ]]; then
  die "codex CLI $cli is older than $minimum, which $model needs (npm install -g @openai/codex@latest)"
fi
common=$(cd "$cwd" && cd "$(git rev-parse --git-common-dir)" && pwd -P)
if [[ $(git -C "$cwd" rev-parse --absolute-git-dir) == "$common" ]]; then
  echo "astra-build: warning: $cwd is the main checkout, not a task worktree" >&2
fi
companion=${CODEX_COMPANION:-}
if [[ -z $companion ]]; then
  companion=$(printf '%s\n' "$HOME"/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs | sort -V | tail -1)
fi
[[ -f $companion ]] || die "codex-companion.mjs not found (install the openai-codex plugin, or set CODEX_COMPANION)"
args=(task --write --json --model "$model" --cwd "$cwd" --prompt-file "$spec")
if ((resume)); then args+=(--resume); fi
if [[ -n $effort ]]; then args+=(--effort "$effort"); fi
out="${spec%.md}.result.json"
status=0
node "$companion" "${args[@]}" > "$out" || status=$?
node - "$out" "$status" "$cwd" "$spec" "$resume" "$model" "$common/astra-build.log" <<'NODE' || true
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const [out, status, cwd, spec, resume, model, log] = process.argv.slice(2);
const raw = fs.readFileSync(out, 'utf8');
let r;
try { r = JSON.parse(raw) ?? {}; } catch { r = {rawOutput: raw}; }
const files = Array.isArray(r.touchedFiles) ? r.touchedFiles : [];
const line = [new Date().toISOString(), model, resume === '1' ? 'resume' : 'new', `exit=${status}`, `thread=${r.threadId ?? '-'}`, cwd, spec].join('\t');
try { fs.appendFileSync(log, line + '\n'); } catch {}
console.log(`astra-build: Codex task ${status === '0' ? 'finished' : `failed (exit ${status})`} · ${model} · ${resume === '1' ? 'resumed thread' : 'new thread'}`);
console.log(`Worktree: ${cwd}`);
let changed;
try {
  const output = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd, encoding: 'utf8' });
  const lines = output.split('\n').filter(Boolean);
  changed = new Set(lines.map(line => line.slice(3)));
  console.log(`Changed in the worktree (${lines.length}):${lines.length ? '' : ' nothing'}`);
  for (const line of lines) console.log('  ' + line);
} catch (error) {
  console.log(`Changed in the worktree: unknown (git status failed: ${error.message})`);
}
if (files.length && (!changed || changed.size !== new Set(files).size || files.some(path => !changed.has(path)))) {
  console.log(`Codex reported (${files.length}):\n  ${files.join('\n  ')}`);
}
console.log(`Full result: ${out}`);
if (r.threadId) console.log(`Codex-Job: ${r.threadId}`);
console.log("\n--- Astra's report ---\n" + String(r.rawOutput ?? '').trim());
NODE
exit "$status"
