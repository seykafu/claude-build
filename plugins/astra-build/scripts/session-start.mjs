import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ConfigError, findRepoRoot, loadConfig, pluginRoot } from './lib/config.mjs';
import { installCommitHook } from './lib/install-hook.mjs';

function exportRoot(file) {
  if (!file) return;
  const line = "export ASTRA_BUILD='" + pluginRoot().replace(/'/g, "'\\''") + "'";
  const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (!content.split('\n').includes(line)) {
    fs.appendFileSync(file, (content && !content.endsWith('\n') ? '\n' : '') + line + '\n');
  }
}

function older(version, minimum) {
  const left = version.split('.').map(Number);
  const right = minimum.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return diff < 0;
  }
  return false;
}

function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: node session-start.mjs < session.json');
    return;
  }
  exportRoot(process.env.CLAUDE_ENV_FILE);
  const root = findRepoRoot(JSON.parse(fs.readFileSync(0, 'utf8')).cwd || process.cwd());
  if (!root) return;
  const config = loadConfig(root);
  if (!config) return;
  const { status, message } = installCommitHook(root);
  if (['installed', 'chained', 'updated'].includes(status)) {
    console.log('astra-build: installed the Codex-Job commit hook in this clone.');
  } else if (status === 'conflict') console.log(message);
  const cli = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 3000 });
  const version = cli.status === 0 && cli.stdout.match(/\b(\d+(?:\.\d+)+)\b/)?.[1];
  if (!version || older(version, config.minCodexCli)) {
    console.log(`astra-build: Codex CLI ${version || 'not found'} can't run ${config.model} (needs ${config.minCodexCli}+); code tasks can't run until it's updated: npm install -g @openai/codex@latest`);
  }
}

try {
  main();
} catch (error) {
  if (error instanceof ConfigError) console.log('astra-build: .claude/build.json is invalid: ' + error.message);
}
