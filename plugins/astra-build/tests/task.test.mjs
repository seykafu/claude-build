import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture, ok } from './helpers/fixture.mjs';

test('task forwards options, reports git state and propagates companion status', t => {
  const f = fixture(t);
  f.config({ model: 'configured-model', minCodexCli: '1.2.0' });
  f.write('tracked.txt', 'original');
  f.commit();
  const dir = f.temp + '/task';
  f.git('worktree', 'add', '-b', 'codex/task', dir);
  const spec = f.temp + '/task.md';
  fs.writeFileSync(spec, 'spec');
  f.env.PATH = f.temp + ':' + f.env.PATH;
  fs.writeFileSync(f.temp + '/codex', '#!/bin/sh\necho codex 1.10.0\n', { mode: 0o755 });
  f.env.CODEX_COMPANION = f.temp + '/companion.mjs';
  const argvFile = f.temp + '/argv';
  fs.writeFileSync(f.env.CODEX_COMPANION, `
    import fs from 'node:fs';
    fs.writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));
    console.log(JSON.stringify({threadId:'thread-id', rawOutput:'task report'}));
    process.exitCode = Number(process.env.TEST_EXIT || 0);
  `);
  const run = () => f.script('task.sh', [spec, '--cwd', dir, '--effort', 'high', '--resume']);
  const summary = ok(run());
  assert.match(summary, /Changed in the worktree \(0\): nothing/);
  assert.match(summary, /Codex-Job: thread-id/);
  assert.match(summary, /task report/);
  assert.deepEqual(JSON.parse(fs.readFileSync(argvFile)), ['task', '--write', '--json', '--model',
    'configured-model', '--cwd', dir, '--prompt-file', spec, '--resume', '--effort', 'high']);
  fs.writeFileSync(dir + '/tracked.txt', 'changed');
  fs.writeFileSync(dir + '/untracked', '');
  f.env.TEST_EXIT = '7';
  const failed = run();
  assert.equal(failed.status, 7);
  assert.match(failed.stdout, / M tracked.txt/);
  assert.match(failed.stdout, /\?\? untracked/);
  assert.match(fs.readFileSync(f.root + '/.git/astra-build.log', 'utf8'), /exit=7/);
  assert.equal(JSON.parse(fs.readFileSync(f.temp + '/task.result.json')).threadId, 'thread-id');
  fs.writeFileSync(f.temp + '/codex', '#!/bin/sh\necho codex 1.1.9\n');
  assert.match(run().stderr, /older than 1.2.0/);
});

test('task discovers the newest companion and uses defaults only for absent config', t => {
  const f = fixture(t);
  delete f.env.CODEX_COMPANION;
  f.env.PATH = f.temp + ':' + f.env.PATH;
  fs.writeFileSync(f.temp + '/codex', '#!/bin/sh\necho codex 0.169.0\n', { mode: 0o755 });
  for (const version of ['1.9', '1.10']) {
    const dir = f.temp + '/.claude/plugins/cache/openai-codex/codex/' + version + '/scripts';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dir + '/codex-companion.mjs', 'console.log(JSON.stringify({ threadId: "' + version + '" }));');
  }
  const spec = f.temp + '/spec.md';
  fs.writeFileSync(spec, '');
  const run = () => f.script('task.sh', [spec, '--cwd', f.root]);
  const result = run();
  assert.match(ok(result), /gpt-6.2-astra/);
  assert.match(result.stdout, /Codex-Job: 1\.10/);
  assert.match(result.stderr, /main checkout/);
  f.config({ model: [] });
  const invalid = run();
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /astra-build: model/);
});
