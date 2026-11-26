import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installCommitHook } from '../scripts/lib/install-hook.mjs';
import { fixture, ok } from './helpers/fixture.mjs';

function landing(t, { mode = 'push', checks = [], remote = true } = {}) {
  const f = fixture(t);
  f.config({ land: mode, checks, worktree: { base: remote ? 'origin/main' : 'main' } });
  f.commit();
  const bare = remote && f.origin();
  const dir = ok(f.script('worktree.sh', ['feature'])).trimEnd();
  installCommitHook(f.root);
  fs.writeFileSync(dir + '/app.js', 'export default 1;');
  const message = f.temp + '/message';
  fs.writeFileSync(message, 'Implement feature\n\nCodex-Job: task-123\n');
  const land = () => f.script('land.sh', ['--cwd', dir, '--message', message, '--cleanup']);
  return { ...f, bare, dir, message, land };
}

for (const remote of [true, false]) test('land advances clean main and cleans up, origin=' + remote, t => {
  const f = landing(t, { remote });
  const output = ok(f.land());
  const head = f.git('rev-parse', 'HEAD');
  assert.ok(output.trimEnd().endsWith(f.git('log', '-1', '--format=%h %s')));
  assert.match(f.git('log', '-1', '--format=%B'), /Codex-Job: task-123/);
  if (remote) assert.equal(f.git('--git-dir', f.bare, 'rev-parse', 'main'), head);
  assert.equal(fs.existsSync(f.dir), false);
  assert.equal(f.git('branch', '--list', 'codex/feature'), '');
});

test('new upstream commits gate both first land and retry', t => {
  const f = landing(t, { checks: ['echo check-ran; exit 7'] });
  f.write('upstream', '');
  f.commit();
  f.git('push', 'origin', 'main');
  const upstream = f.git('rev-parse', 'main');
  for (let i = 0; i < 2; i++) {
    const result = f.land();
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL  echo check-ran/);
    assert.equal(f.git('--git-dir', f.bare, 'rev-parse', 'main'), upstream);
  }
  assert.equal(f.git('-C', f.dir, 'rev-parse', 'HEAD^'), upstream);
});

test('missing trailer stops landing before push', t => {
  const f = landing(t);
  fs.writeFileSync(f.message, 'Missing trailer');
  const result = f.land();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Codex-Job/);
  assert.equal(f.git('--git-dir', f.bare, 'rev-parse', 'main'), f.git('rev-parse', 'HEAD'));
});

test('pr pushes task branch and keeps worktree', t => {
  const f = landing(t, { mode: 'pr' });
  assert.match(ok(f.land()), /ignoring --cleanup/);
  assert.equal(f.git('--git-dir', f.bare, 'rev-parse', 'codex/feature'), f.git('-C', f.dir, 'rev-parse', 'HEAD'));
  assert.notEqual(f.git('rev-parse', 'main'), f.git('rev-parse', 'codex/feature'));
});

test('rebase conflict restores the task commit and leaves origin alone', t => {
  const f = landing(t);
  f.write('app.js', 'upstream');
  f.git('add', 'app.js');
  f.git('commit', '-m', 'Upstream edit', '-m', 'Codex-Job: upstream');
  f.git('push', 'origin', 'main');
  const result = f.land();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /resolve the conflict/);
  assert.equal(f.git('-C', f.dir, 'symbolic-ref', '--short', 'HEAD'), 'codex/feature');
  assert.equal(f.git('-C', f.dir, 'status', '--porcelain'), '');
  assert.equal(f.git('--git-dir', f.bare, 'rev-parse', 'main'), f.git('rev-parse', 'main'));
});

test('successful push cleans up when local main has diverged', t => {
  const f = landing(t);
  f.write('local.txt', 'local work');
  f.commit();
  const localHead = f.git('rev-parse', 'main');

  const result = f.land();
  const output = ok(result);
  assert.ok(result.stderr.includes(`astra-build: pushed, but couldn't fast-forward the main checkout at ${f.root}; update it by hand`));
  assert.equal(f.git('rev-parse', 'main'), localHead);
  assert.equal(f.git('--git-dir', f.bare, 'show', 'main:app.js'), 'export default 1;');
  const summary = f.git('--git-dir', f.bare, 'log', '-1', '--format=%h %s', 'main');
  assert.equal(output.trimEnd().split('\n').pop(), summary);
  assert.equal(fs.existsSync(f.dir), false);
  assert.equal(f.git('branch', '--list', 'codex/feature'), '');
});
