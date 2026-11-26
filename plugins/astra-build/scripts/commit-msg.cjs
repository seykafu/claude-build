const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

// Keep classification in sync with lib/config.mjs. This file runs outside the plugin.
const DEFAULTS = {
  model: 'gpt-6.2-astra',
  minCodexCli: '0.169.0',
  code: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py,rb,go,rs,java,kt,kts,swift,c,h,cc,cpp,hpp,cs,php,sh,bash,zsh,css,scss,sass,less,html,vue,svelte,sql}'],
  notCode: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.venv/**', '**/vendor/**', '.claude/**'],
  checks: [],
  worktree: { base: 'origin/main', setup: [] },
  land: 'push',
};

class ConfigError extends Error {}

function mergeConfig(input) {
  function object(value, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ConfigError(field + ' must be an object');
    }
    return value;
  }
  function string(value, field) {
    if (typeof value !== 'string' || !value.trim()) throw new ConfigError(field + ' must be a non-empty string');
    return value;
  }
  function strings(value, field) {
    if (!Array.isArray(value) || !value.every(s => typeof s === 'string')) {
      throw new ConfigError(field + ' must be an array of strings');
    }
    return [...value];
  }
  object(input, 'config');
  const { model, minCodexCli, code, notCode, checks, worktree, land } = { ...DEFAULTS, ...input };
  const { base, setup } = { ...DEFAULTS.worktree, ...object(worktree, 'worktree') };
  if (!['push', 'pr'].includes(land)) throw new ConfigError('land must be "push" or "pr"');
  return {
    model: string(model, 'model'), minCodexCli: string(minCodexCli, 'minCodexCli'),
    code: strings(code, 'code'), notCode: strings(notCode, 'notCode'), checks: strings(checks, 'checks'),
    worktree: { base: string(base, 'worktree.base'), setup: strings(setup, 'worktree.setup') }, land,
  };
}

function loadConfig(repoRoot) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(repoRoot, '.claude/build.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new ConfigError('expected valid JSON');
  }
  return mergeConfig(input);
}

function globToRegExp(glob) {
  function compile(pattern) {
    const brace = /\{([^{}]*,[^{}]*)\}/.exec(pattern);
    if (brace) {
      const before = pattern.slice(0, brace.index);
      const after = pattern.slice(brace.index + brace[0].length);
      return '(?:' + brace[1].split(',').map(alt => compile(before + alt + after)).join('|') + ')';
    }
    const parts = pattern.split('/').filter((p, i, all) => p !== '**' || all[i - 1] !== '**');
    return parts.map((part, i) => {
      if (part === '**') {
        if (i < parts.length - 1) return '(?:[^/]+/)*';
        return i ? '(?:/[^/]+)*' : '(?:[^/]+(?:/[^/]+)*)?';
      }
      const prefix = i && parts[i - 1] !== '**' ? '/' : '';
      const suffix = parts[i + 1] === '**' && i + 2 < parts.length ? '/' : '';
      return prefix + Array.from(part, c => {
        if (c === '*') return '[^/]*';
        if (c === '?') return '[^/]';
        return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('') + suffix;
    }).join('');
  }
  return new RegExp('^(?:' + compile(glob) + ')(?![\\s\\S])', 'u');
}

const compiled = new Map();
function isCode(relPath, config) {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  function matches(glob) {
    if (!compiled.has(glob)) compiled.set(glob, globToRegExp(glob));
    return compiled.get(glob).test(normalized);
  }
  return config.code.some(matches) && !config.notCode.some(matches);
}

module.exports = { DEFAULTS, mergeConfig, loadConfig, ConfigError, globToRegExp, isCode };

function main(args) {
  if (args[0] === '--help') {
    console.log('Usage: node commit-msg.cjs <message-file>');
    return 0;
  }
  const previous = path.join(__dirname, 'commit-msg.pre-astra-build');
  if (fs.existsSync(previous)) {
    const child = spawnSync(previous, args, { stdio: 'inherit' });
    if (child.status !== 0) return child.status ?? 1;
  }
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).status === 0) return 0;
  const root = git('rev-parse', '--show-toplevel').replace(/\n$/, '');
  let config;
  try {
    config = loadConfig(root);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error('astra-build: .claude/build.json is invalid: ' + error.message);
    return 0;
  }
  if (!config) return 0;
  const paths = git('diff', '--cached', '--name-only', '-z').split('\0').filter(p => p && isCode(p, config));
  if (!paths.length || fs.readFileSync(args[0], 'utf8').split('\n').some(line => /^Codex-Job:[ \t]*\S/.test(line))) return 0;
  console.error('astra-build: this commit changes code:');
  for (const p of paths.slice(0, 12)) console.error('  ' + p);
  if (paths.length > 12) console.error('  … and ' + (paths.length - 12) + ' more');
  console.error('Add a trailer naming the Codex thread that wrote it:   Codex-Job: <threadId>');
  console.error("or, for code Codex didn't write, say why:              Codex-Job: none (<reason>)");
  return 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch {
    console.error('astra-build: could not check the staged commit.');
  }
}
