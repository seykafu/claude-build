import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { installCommitHook } from '../scripts/lib/install-hook.mjs';
import { isCode, DEFAULTS } from '../scripts/lib/config.mjs';
import copied from '../scripts/commit-msg.cjs';

function repo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  process.env.HOME = root;
  process.env.XDG_CONFIG_HOME = root;
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  function git(...args) {
    return spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
      { cwd: root, encoding: 'utf8' });
  }
  assert.equal(git('init', '-q').status, 0);
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.claude/build.json'), '{}');
  return { root, git, hook: path.join(root, '.git/hooks/commit-msg') };
}

test('installation, refresh and enforcement on real commits', t => {
  const { root, git, hook } = repo(t);
  const install = options => installCommitHook(root, options).status;
  const copy = path.join(path.dirname(hook), 'astra-build-commit-msg.cjs');
  assert.equal(install(), 'installed');
  for (const file of [hook, copy]) assert.equal(fs.statSync(file).mode & 0o777, 0o755);
  assert.equal(install(), 'current');
  fs.appendFileSync(copy, '\n');
  assert.equal(install(), 'updated');
  assert.equal(install({ version: '2' }), 'updated');
  function stage(file, value) {
    fs.writeFileSync(path.join(root, file), value);
    assert.equal(git('add', file).status, 0);
  }
  stage('a.ts', '1');
  const blocked = git('commit', '-m', 'code\n\n# Codex-Job: abc');
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /changes code:\n  a.ts/);
  for (const trailer of ['abc', 'none (bootstrap)']) {
    stage('a.ts', trailer);
    const result = git('commit', '-m', 'code', '-m', 'Codex-Job: ' + trailer);
    assert.equal(result.status, 0, result.stderr);
  }
  stage('README.md', 'docs');
  assert.equal(git('commit', '-m', 'docs').status, 0);
  stage('a.ts', 'invalid config');
  stage('.claude/build.json', '{');
  const invalid = git('commit', '-m', 'config');
  assert.match(invalid.stderr, /config|invalid/);
  assert.equal(invalid.status, 0);
});

test('foreign hooks, conflicts and tracked hooks directories', t => {
  const { root, git, hook } = repo(t);
  const prev = hook + '.pre-astra-build';
  fs.writeFileSync(hook, '#!/bin/sh\necho foreign >&2\nexit 7\n', { mode: 0o755 });
  fs.writeFileSync(prev, 'existing');
  assert.equal(installCommitHook(root).status, 'conflict');
  assert.equal(fs.readFileSync(prev, 'utf8'), 'existing');
  fs.unlinkSync(prev);
  assert.equal(installCommitHook(root).status, 'chained');
  const result = git('commit', '--allow-empty', '-m', 'empty');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /foreign/);
  assert.equal(spawnSync(hook, ['message'], { cwd: root }).status, 7);
  assert.equal(git('config', 'core.hooksPath', '.hooks').status, 0);
  assert.equal(installCommitHook(root).status, 'tracked-hooks-dir');
  assert.ok(!fs.existsSync(path.join(root, '.hooks')));
});

test('copied hook agrees with plugin classification', () => {
  assert.deepEqual(copied.DEFAULTS, DEFAULTS);
  const files = ['a.ts', './a.ts', 'src/a.js', 'x/y/a.py', 'a.rb', 'a.go', 'a.rs', 'a.c++', 'a.swift',
    'a.kt', 'a.less', 'a.sql', 'Makefile', 'README.md', 'a.txt', 'node_modules/a.ts', 'x/dist/a.ts',
    'build/a.css', '.venv/a.py', 'vendor/a.go', '.claude/hooks/x.mjs', 'src\\a.cpp'];
  for (const file of files) assert.equal(copied.isCode(file, copied.DEFAULTS), isCode(file, DEFAULTS), file);
});

test('linked worktrees share the check, merge commits pass, long path lists are capped', t => {
  const { root, git, hook } = repo(t);
  assert.equal(git('commit', '--allow-empty', '-m', 'base').status, 0);
  const linked = path.join(root, 'linked');
  assert.equal(git('worktree', 'add', '--detach', linked).status, 0);
  assert.equal(installCommitHook(linked).status, 'installed');
  assert.equal(installCommitHook(root).status, 'current');
  for (let i = 0; i < 15; i++) fs.writeFileSync(path.join(root, i + '.ts'), '');
  assert.equal(git('add', '--', '*.ts').status, 0);
  const message = path.join(root, 'message');
  fs.writeFileSync(message, 'merge\n');
  const run = () => spawnSync(hook, [message], { cwd: root, encoding: 'utf8' });
  const blocked = run();
  assert.equal(blocked.status, 1);
  assert.equal(blocked.stderr.split('\n').filter(line => /^  \d+\.ts$/.test(line)).length, 12);
  assert.match(blocked.stderr, /… and 3 more/);
  fs.writeFileSync(path.join(root, '.git/MERGE_HEAD'), git('rev-parse', 'HEAD').stdout);
  assert.equal(run().status, 0);
});
