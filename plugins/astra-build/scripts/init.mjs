#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ConfigError, DEFAULTS, mergeConfig, loadConfig } from './lib/config.mjs';
import { installCommitHook } from './lib/install-hook.mjs';

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trimEnd() : null;
}

function detect(land) {
  const config = mergeConfig({ land });
  const { checks, worktree } = config;
  const { setup } = worktree;
  const exists = fs.existsSync;
  if (exists('.gitattributes') && /^\s*[^#\s].*\sfilter=lfs(?:\s|$)/m.test(fs.readFileSync('.gitattributes', 'utf8'))) {
    setup.push('git lfs checkout');
  }
  if (exists('package.json')) {
    const { scripts = {} } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    let runner;
    if (exists('pnpm-lock.yaml')) {
      setup.push('pnpm install --frozen-lockfile');
      runner = 'pnpm run';
    } else if (exists('yarn.lock')) {
      setup.push('yarn install --frozen-lockfile');
      runner = 'yarn';
    } else {
      setup.push(exists('package-lock.json')
        ? 'npm ci --prefer-offline --no-audit --no-fund'
        : 'npm install --no-package-lock --no-audit --no-fund');
      runner = 'npm run';
    }
    for (const key of ['typecheck', 'lint', 'test']) {
      if (!scripts?.[key] || (key === 'test' && scripts[key].includes('no test specified'))) continue;
      checks.push(key === 'test' && runner === 'npm run' ? 'npm test' : runner + ' ' + key);
    }
  }
  if (exists('pyproject.toml') || exists('requirements.txt')) {
    if (exists('uv.lock')) setup.push('uv sync');
    else if (exists('requirements.txt')) setup.push('pip install -r requirements.txt');
    const files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard') ?? '';
    if (fs.statSync('tests', { throwIfNoEntry: false })?.isDirectory() ||
        files.split('\0').some(file => /^test_.*\.py$/.test(path.basename(file)) && exists(file))) checks.push('pytest');
  }
  if (exists('Cargo.toml')) checks.push('cargo test');
  if (exists('go.mod')) checks.push('go vet ./...', 'go test ./...');
  const origin = git('remote', 'get-url', 'origin') !== null;
  const defaultRef = origin && git('symbolic-ref', '-q', 'refs/remotes/origin/HEAD');
  if (defaultRef) worktree.base = defaultRef.replace(/^refs\/remotes\//, '');
  else {
    const branch = git('symbolic-ref', '-q', '--short', 'HEAD');
    if (!branch) throw new Error('check out a branch so init can determine the base');
    worktree.base = origin ? 'origin/' + branch : branch;
  }
  return config;
}

function reportCodex(minimum) {
  const run = args => spawnSync('codex', args, { encoding: 'utf8', timeout: 5000 });
  const cli = run(['--version']);
  const version = cli.stdout?.match(/\b\d+(?:\.\d+)+\b/)?.[0];
  if (!version || cli.status !== 0) console.warn("astra-build: couldn't confirm the Codex CLI version; need " + minimum);
  else {
    console.log('astra-build: Codex CLI ' + version);
    if (version.localeCompare(minimum, 'en', { numeric: true }) < 0) {
      console.warn('astra-build: Codex CLI is older than ' + minimum);
    }
  }
  if (cli.error?.code === 'ENOENT') return;
  const login = run(['login', 'status']);
  const first = (login.stdout?.trim() || login.stderr?.trim() || '').split(/\r?\n/)[0];
  console.log('astra-build: ' + (login.status === 0 && first ? first : "couldn't confirm the Codex login"));
}

function main() {
  const usage = 'Usage: node init.mjs [--force] [--dry-run] [--land push|pr]';
  const args = process.argv.slice(2);
  const values = { land: 'push' };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') return console.log(usage);
    if (flag === '--force' || flag === '--dry-run') values[flag.slice(2)] = true;
    else if (flag === '--land' && args[i + 1]) values.land = args[++i];
    else throw new Error(usage);
  }
  if (!['push', 'pr'].includes(values.land)) throw new Error('--land must be push or pr');
  const root = git('rev-parse', '--show-toplevel');
  if (!root) throw new Error('run init inside a git worktree');
  process.chdir(root);
  const file = '.claude/build.json';
  const keep = fs.existsSync(file) && !values.force;
  let json;
  let minimum = DEFAULTS.minCodexCli;
  if (keep) {
    console.log('astra-build: already set up with ' + file);
    json = fs.readFileSync(file, 'utf8').trimEnd();
    try {
      minimum = loadConfig(root).minCodexCli;
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      console.warn('astra-build: review the existing config: ' + error.message);
    }
  } else {
    const config = detect(values.land);
    minimum = config.minCodexCli;
    json = JSON.stringify(config, null, 2);
  }
  console.log(json);
  if (values['dry-run']) {
    if (!keep) console.log('astra-build: would write ' + file);
    console.log('astra-build: would install the commit hook and check the Codex CLI and login');
  } else {
    if (!keep) {
      fs.mkdirSync('.claude', { recursive: true });
      fs.writeFileSync(file, json + '\n');
    }
    const { status, message } = installCommitHook(root);
    console.log(message);
    if (status === 'tracked-hooks-dir') console.log('Add the Codex-Job check to your tracked commit-msg hook.');
    if (status === 'conflict') console.log('Reconcile the two existing hook files and rerun init.');
    reportCodex(minimum);
  }
  console.log("Review .claude/build.json, add the workflow to the repo's agent instructions, and commit both.");
}
try {
  main();
} catch (error) {
  console.error('astra-build: ' + error.message);
  process.exitCode = 2;
}
