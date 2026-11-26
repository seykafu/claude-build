import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture, ok } from './helpers/fixture.mjs';

for (const remote of [false, true]) test('create and reuse worktree, origin=' + remote, t => {
  const f = fixture(t);
  f.config({ worktree: { base: remote ? 'origin/main' : 'main', setup: ['echo setup; touch marker'] } });
  f.commit();
  if (remote) f.origin();
  const dir = f.root + '-codex/build';
  const result = f.script('worktree.sh', ['build'], f.root + '/.claude');
  assert.equal(ok(result), dir + '\n');
  assert.match(result.stderr, /setup/);
  assert.ok(fs.existsSync(dir + '/marker'));
  assert.equal(ok(f.script('worktree.sh', ['build'], dir)), dir + '\n');
  assert.notEqual(f.script('worktree.sh', ['../bad']).status, 0);
});

test('setup failure retains the worktree and names the command', t => {
  const f = fixture(t);
  f.config({ worktree: { setup: ['exit 9'] } });
  f.commit();
  assert.match(f.script('worktree.sh', ['broken']).stderr, /--base <local branch>/);
  const result = f.script('worktree.sh', ['broken', '--base', 'main']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exit 9.*left in place/);
  assert.ok(fs.existsSync(f.root + '-codex/broken/.git'));
});
