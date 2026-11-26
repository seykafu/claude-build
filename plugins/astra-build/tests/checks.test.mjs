import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture, ok } from './helpers/fixture.mjs';

test('checks run in order, preserve multi-line commands and show only failing tails', t => {
  const f = fixture(t);
  const run = () => f.script('checks.sh', ['--cwd', f.root]);
  assert.equal(run().status, 2);
  f.config({ checks: ['echo first', 'echo omitted; for i in {1..30}; do echo "$i"; done\nexit 8', 'touch last'] });
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /PASS  echo first[\s\S]*FAIL [\s\S]*exit 8[\s\S]*PASS  touch last/);
  assert.match(result.stdout, /---\n1\n2\n[\s\S]*30\n$/);
  assert.ok(fs.existsSync(f.root + '/last'));
  f.config({ checks: ['true'] });
  assert.match(ok(run()), /PASS  true/);
  assert.deepEqual(fs.readdirSync(f.root + '/.git/astra-build-checks/repo'), ['01-true.log']);
  f.config({});
  assert.match(ok(run()), /no checks.*nothing gates/);
});
