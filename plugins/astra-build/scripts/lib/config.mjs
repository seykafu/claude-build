import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULTS = {
  model: 'gpt-6.2-astra',
  minCodexCli: '0.169.0',
  code: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py,rb,go,rs,java,kt,kts,swift,c,h,cc,cpp,hpp,cs,php,sh,bash,zsh,css,scss,sass,less,html,vue,svelte,sql}'],
  notCode: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.venv/**', '**/vendor/**', '.claude/**'],
  checks: [],
  worktree: { base: 'origin/main', setup: [] },
  land: 'push',
};

export class ConfigError extends Error {}

export function mergeConfig(input) {
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

export function loadConfig(repoRoot) {
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

export function globToRegExp(glob) {
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
export function isCode(relPath, config) {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  function matches(glob) {
    if (!compiled.has(glob)) compiled.set(glob, globToRegExp(glob));
    return compiled.get(glob).test(normalized);
  }
  return config.code.some(matches) && !config.notCode.some(matches);
}

export function findRepoRoot(startPath) {
  let dir = path.resolve(startPath);
  for (;;) {
    const entry = fs.statSync(path.join(dir, '.git'), { throwIfNoEntry: false });
    if (entry?.isDirectory() || entry?.isFile()) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function pluginRoot() {
  return fileURLToPath(new URL('../../', import.meta.url)).replace(/[/\\]$/, '');
}

export function pluginVersion() {
  return JSON.parse(fs.readFileSync(path.join(pluginRoot(), '.claude-plugin/plugin.json'), 'utf8')).version;
}
