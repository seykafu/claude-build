import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pluginRoot } from '../scripts/lib/config.mjs';

test('opt-in, environment export, installation and CLI version checks', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const envFile = path.join(root, 'env');
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: root, GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1', CLAUDE_ENV_FILE: envFile, PATH: root + path.delimiter + process.env.PATH };
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root, env }).status, 0);
  const fake = path.join(root, 'codex');
  fs.writeFileSync(fake, '#!/bin/sh\ntouch spawned\nsleep 2\n', { mode: 0o755 });
  function run() {
    const result = spawnSync(process.execPath, [path.join(pluginRoot(), 'scripts/session-start.mjs')], {
      input: JSON.stringify({ cwd: root }), cwd: root, env, encoding: 'utf8',
    });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    return result.stdout;
  }
  const hooks = path.join(root, '.git/hooks');
  const initial = fs.readdirSync(hooks);
  assert.equal(run(), '');
  assert.deepEqual(fs.readdirSync(hooks), initial);
  assert.ok(!fs.existsSync(path.join(root, 'spawned')));
  fs.mkdirSync(path.join(root, '.claude'));
  const config = path.join(root, '.claude/build.json');
  fs.writeFileSync(config, 'null');
  assert.match(run(), /build.json is invalid/);
  fs.writeFileSync(config, '{}');
  fs.writeFileSync(fake, '#!/bin/sh\necho codex-cli 0.1000.0\n');
  assert.equal(run(), 'astra-build: installed the Codex-Job commit hook in this clone.\n');
  assert.ok(fs.existsSync(path.join(hooks, 'commit-msg')));
  assert.equal(run(), '');
  assert.equal(fs.readFileSync(envFile, 'utf8'), "export ASTRA_BUILD='" + pluginRoot().replace(/'/g, "'\\''") + "'\n");
  fs.writeFileSync(fake, '#!/bin/sh\necho codex-cli 0.99.99\n');
  assert.match(run(), /CLI 0.99.99 can't run .*needs 0.169.0\+/);
  fs.writeFileSync(fake, '#!/bin/sh\nexit 1\n');
  assert.match(run(), /CLI not found/);
});
