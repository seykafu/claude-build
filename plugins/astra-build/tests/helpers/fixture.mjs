// Shared fixture for script integration tests. All Git writes stay under temp.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export function fixture(t) {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'astra workflow-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'repo');
  fs.mkdirSync(root);
  const env = { ...process.env, HOME: temp, XDG_CONFIG_HOME: temp, GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.org',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.org' };
  function run(bin, args, cwd = root) {
    const result = spawnSync(bin, args, { cwd, env, encoding: 'utf8' });
    if (result.error) throw result.error;
    return result;
  }
  function git(...args) {
    const result = run('git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trimEnd();
  }
  function script(name, args = [], cwd = root) {
    const file = fileURLToPath(new URL('../../scripts/' + name, import.meta.url));
    return name.endsWith('.sh') ? run('/bin/bash', [file, ...args], cwd) : run(process.execPath, [file, ...args], cwd);
  }
  function write(name, value = '') {
    fs.writeFileSync(path.join(root, name), value);
  }
  function config(value) {
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    write('.claude/build.json', JSON.stringify(value));
  }
  function commit() {
    git('add', '-A');
    git('commit', '--allow-empty', '-qm', 'fixture');
  }
  function origin() {
    const bare = path.join(temp, 'origin.git');
    git('init', '--bare', bare);
    git('remote', 'add', 'origin', bare);
    git('push', 'origin', 'main');
    return bare;
  }
  git('init', '-q');
  git('symbolic-ref', 'HEAD', 'refs/heads/main');
  return { temp, root, env, run, script, git, config, write, commit, origin };
}

export function ok(result) {
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout;
}
