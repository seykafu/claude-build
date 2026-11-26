import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, ok } from './helpers/fixture.mjs';

test('config CLI exposes merged values and distinguishes missing from invalid', t => {
  const f = fixture(t);
  const cli = (...args) => f.script('config.mjs', ['--root', f.root, ...args]);
  const missing = cli('--json');
  assert.equal(missing.status, 3);
  assert.equal(missing.stdout, '');
  f.config({ checks: ['one', 'two'] });
  assert.equal(ok(cli('--get', 'model')), 'gpt-6.2-astra\n');
  assert.equal(ok(cli('--get', 'checks')), 'one\ntwo\n');
  assert.equal(ok(cli('--get', 'worktree.setup')), '');
  assert.equal(JSON.parse(ok(cli('--json'))).worktree.base, 'origin/main');
  f.config({ checks: false });
  const invalid = cli('--get', 'model');
  assert.equal(invalid.status, 4);
  assert.match(invalid.stderr, /astra-build: .*checks/);
});
