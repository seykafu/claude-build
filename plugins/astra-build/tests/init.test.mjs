import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture, ok } from './helpers/fixture.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';

function initFixture(t) {
  const f = fixture(t);
  f.env.PATH = f.temp + ':' + f.env.PATH;
  fs.writeFileSync(f.temp + '/codex', '#!/bin/sh\nif test "$1" = --version; then echo codex 0.180.0; else echo logged-in; fi\n', { mode: 0o755 });
  return { ...f, init: (...args) => f.script('init.mjs', args),
    read: () => JSON.parse(fs.readFileSync(f.root + '/.claude/build.json')) };
}

const stacks = [
  ['npm', ['package.json', 'package-lock.json'], ['npm ci --prefer-offline --no-audit --no-fund'], ['npm run typecheck', 'npm run lint', 'npm test']],
  ['pnpm', ['package.json', 'pnpm-lock.yaml'], ['pnpm install --frozen-lockfile'], ['pnpm run typecheck', 'pnpm run lint', 'pnpm run test']],
  ['yarn', ['package.json', 'yarn.lock'], ['yarn install --frozen-lockfile'], ['yarn typecheck', 'yarn lint', 'yarn test']],
  ['uv', ['pyproject.toml', 'uv.lock', 'test_unit.py'], ['uv sync'], ['pytest']],
  ['requirements', ['requirements.txt', 'tests/'], ['pip install -r requirements.txt'], ['pytest']],
  ['mixed', ['.gitattributes', 'requirements.txt', 'tests/', 'Cargo.toml', 'go.mod'],
    ['git lfs checkout', 'pip install -r requirements.txt'], ['pytest', 'cargo test', 'go vet ./...', 'go test ./...']],
];
for (const [name, files, setup, checks] of stacks) test('init detects ' + name, t => {
  const f = initFixture(t);
  for (const file of files) {
    if (file === 'package.json') f.write(file, JSON.stringify({ scripts: { typecheck: 'tsc', lint: 'eslint', test: 'jest' } }));
    else if (file === '.gitattributes') f.write(file, '*.png filter=lfs diff=lfs');
    else if (file.endsWith('/')) fs.mkdirSync(f.root + '/' + file);
    else f.write(file);
  }
  assert.match(ok(f.init('--land', 'pr')), /logged-in/);
  assert.deepEqual(f.read(), { ...DEFAULTS, worktree: { base: 'main', setup }, checks, land: 'pr' });
});

test('preview, preserve config and hook, replace with remote default on force', t => {
  const f = initFixture(t);
  f.write('package.json', JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
  f.commit();
  f.origin();
  const preview = ok(f.init('--dry-run'));
  assert.match(preview, /origin\/main/);
  assert.match(preview, /would install/);
  assert.equal(fs.existsSync(f.root + '/.claude'), false);
  const hook = f.root + '/.git/hooks/commit-msg';
  assert.equal(fs.existsSync(hook), false);
  f.config({ model: 'custom' });
  assert.match(ok(f.init()), /already set up/);
  assert.deepEqual(f.read(), { model: 'custom' });
  assert.ok(fs.existsSync(hook));
  f.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/stable');
  ok(f.init('--force'));
  assert.deepEqual(f.read(), { ...DEFAULTS, worktree: { base: 'origin/stable', setup: ['npm install'] } });
});
