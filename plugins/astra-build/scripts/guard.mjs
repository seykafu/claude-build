import fs from 'node:fs';
import path from 'node:path';
import { ConfigError, DEFAULTS, findRepoRoot, isCode, loadConfig } from './lib/config.mjs';

function main(args) {
  if (args.includes('--help')) {
    console.log('Usage: node guard.mjs [--list-code --root <dir>] < input');
    return;
  }
  if (args[0] === '--list-code') {
    const config = loadConfig(args[2]);
    if (config) {
      for (const file of fs.readFileSync(0, 'utf8').split(/\r?\n/)) {
        if (file && isCode(file, config)) console.log(file);
      }
    }
    return;
  }
  if (process.env.ASTRA_BUILD_ALLOW_OPUS === '1') return;
  const { cwd, tool_input } = JSON.parse(fs.readFileSync(0, 'utf8'));
  const file = tool_input?.file_path || tool_input?.notebook_path;
  if (!file) return;
  const absolute = path.resolve(cwd || process.cwd(), file);
  const root = findRepoRoot(path.dirname(absolute));
  if (!root) return;
  const rel = path.relative(root, absolute).split(path.sep).join('/');
  if (rel.startsWith('.claude/')) return;
  let config;
  try {
    config = loadConfig(root);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    if (isCode(rel, DEFAULTS)) {
      console.error('astra-build: .claude/build.json is invalid: ' + error.message +
        '. Code edits are blocked. .claude/build.json is config, so it can be fixed.');
      process.exitCode = 2;
    }
    return;
  }
  if (config && isCode(rel, config)) {
    console.error(`Blocked: ${rel} is code, and in this repo ${config.model} writes all code (see .claude/build.json).
Hand it to Codex with /astra-build:build: "$ASTRA_BUILD/scripts/worktree.sh" <slug>, a spec from
"$ASTRA_BUILD/templates/SPEC_TEMPLATE.md", then "$ASTRA_BUILD/scripts/task.sh" <spec> --cwd <worktree>.
Check, review, and send findings back with --resume. Docs, specs and config stay editable.
The user can allow Opus code edits for a session by starting Claude with ASTRA_BUILD_ALLOW_OPUS=1.`);
    process.exitCode = 2;
  }
}

try {
  main(process.argv.slice(2));
} catch {
  // Claude's edit tools must remain usable on unexpected hook errors.
}
