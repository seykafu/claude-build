import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pluginRoot } from '../scripts/lib/config.mjs';

test('hook decisions and list-code mode', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function run(input, args = [], allow = '') {
    const result = spawnSync(process.execPath, [path.join(pluginRoot(), 'scripts/guard.mjs'), ...args], {
      input, encoding: 'utf8', env: { ...process.env, ASTRA_BUILD_ALLOW_OPUS: allow },
    });
    assert.ifError(result.error);
    return result;
  }
  const edit = (file, allow) => run(JSON.stringify({ tool_name: 'Edit', cwd: root, tool_input: { file_path: file } }), [], allow);
  assert.equal(edit('a.ts').status, 0);
  fs.mkdirSync(path.join(root, '.git'));
  assert.equal(edit('a.ts').status, 0);
  const list = () => run('a.ts\na.md\nvendor/a.ts\n', ['--list-code', '--root', root]).stdout;
  assert.equal(list(), '');
  fs.mkdirSync(path.join(root, '.claude'));
  const file = path.join(root, '.claude/build.json');
  fs.writeFileSync(file, '{"model":"custom"}');
  const result = edit('new/deep/a.ts');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Blocked: new\/deep\/a.ts is code, and in this repo custom writes all code/);
  assert.match(result.stderr, /ASTRA_BUILD_ALLOW_OPUS=1/);
  assert.equal(edit('a.md').status, 0);
  assert.equal(edit('a.ts', '1').status, 0);
  assert.equal(list(), 'a.ts\n');
  fs.writeFileSync(file, '{"code":["**"],"notCode":[]}');
  assert.equal(edit('.claude/hooks/a.js').status, 0);
  assert.equal(run(JSON.stringify({ cwd: root, tool_input: { notebook_path: 'n.ipynb' } })).status, 2);
  fs.writeFileSync(file, '{');
  assert.equal(edit('.claude/build.json').status, 0);
  assert.equal(edit('a.md').status, 0);
  const invalid = edit('a.ts');
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /invalid.*config, so it can be fixed/);
  assert.equal(run('{').status, 0);
});
