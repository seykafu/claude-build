import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globToRegExp, DEFAULTS, ConfigError, findRepoRoot, isCode, loadConfig } from '../scripts/lib/config.mjs';

test('repo-relative globs and exclusions', () => {
  for (const [glob, yes, no] of [
    ['*.config.js', ['a.config.js'], ['src/a.config.js', 'aXconfig.js']],
    ['**/*.ts', ['a.ts', 'x/y/a.ts'], ['a.tsx', 'a.ts\n']],
    ['src/**', ['src', 'src/a', 'src/a/b'], ['src-other/a']],
    ['a/**/b', ['a/b', 'a/x/y/b'], ['a/xb', 'a/b/c']],
    ['x/{a,b}/?.c++', ['x/a/z.c++', 'x/b/q.c++'], ['x/c/q.c++', 'x/b/qq.c++', 'x/b//.c++', 'x/b/q.cc']],
    ['{lib/*.js,main.?}', ['lib/a.js', 'main.c'], ['lib/x/a.js', 'main.cc']],
    ['ab**cd', ['abXYZcd'], ['ab/x/cd']],
  ]) {
    const regex = globToRegExp(glob);
    for (const file of yes) assert.ok(regex.test(file), glob + ' should match ' + file);
    for (const file of no) assert.ok(!regex.test(file), glob + ' should exclude ' + file);
  }
  for (const file of ['src/a.ts', './src\\a.ts']) assert.ok(isCode(file, DEFAULTS));
  for (const file of ['README.md', 'node_modules/x/y.js', '.claude/hooks/x.mjs']) assert.ok(!isCode(file, DEFAULTS));
});

test('config loading, defaults, validation and root discovery', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.git'), 'gitdir: worktree');
  assert.equal(findRepoRoot(path.join(root, 'new/deep/file')), root);
  assert.equal(loadConfig(root), null);
  fs.mkdirSync(path.join(root, '.claude'));
  const file = path.join(root, '.claude/build.json');
  fs.writeFileSync(file, JSON.stringify({ code: [], worktree: { setup: ['x'], extra: true }, extra: true }));
  assert.deepEqual(loadConfig(root), { ...DEFAULTS, code: [], worktree: { base: 'origin/main', setup: ['x'] } });
  for (const value of [null, [], ...['code', 'notCode', 'checks'].flatMap(key => [{ [key]: 'x' }, { [key]: [4] }]),
    { worktree: null }, { worktree: { setup: [null] } }, { model: ' ' }, { minCodexCli: 3 },
    { worktree: { base: '' } }, { land: 'merge' }]) {
    fs.writeFileSync(file, JSON.stringify(value));
    assert.throws(() => loadConfig(root), ConfigError);
  }
  fs.writeFileSync(file, '{');
  assert.throws(() => loadConfig(root), ConfigError);
});
