import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pluginRoot, pluginVersion } from './config.mjs';

function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

// Resolve symlinks even when Git's chosen hooks directory doesn't exist yet.
function physical(dir) {
  if (fs.existsSync(dir)) return fs.realpathSync(dir);
  return path.join(physical(path.dirname(dir)), path.basename(dir));
}

export function installCommitHook(repoRoot, {
  version = pluginVersion(), source = path.join(pluginRoot(), 'scripts/commit-msg.cjs'),
} = {}) {
  const gitPath = (...args) => physical(path.resolve(repoRoot, execFileSync('git', ['rev-parse', ...args], {
    cwd: repoRoot, encoding: 'utf8',
  }).replace(/\n$/, '')));
  const hooksDir = gitPath('--git-path', 'hooks');
  const result = (status, message) => ({ status, hooksDir, message });
  if (inside(physical(repoRoot), hooksDir) && !inside(gitPath('--git-common-dir'), hooksDir)) {
    return result('tracked-hooks-dir', 'The configured hooks directory is inside the work tree and was left alone.');
  }
  fs.mkdirSync(hooksDir, { recursive: true });
  const shim = path.join(hooksDir, 'commit-msg');
  const previous = shim + '.pre-astra-build';
  const copy = path.join(hooksDir, 'astra-build-commit-msg.cjs');
  const marker = '# astra-build commit-msg v' + version;
  const script = '#!/bin/sh\n' + marker + '\nexec node "$(dirname "$0")/astra-build-commit-msg.cjs" "$@"\n';
  const bytes = fs.readFileSync(source);
  const exists = file => !!fs.lstatSync(file, { throwIfNoEntry: false });
  const present = exists(shim);
  const old = fs.existsSync(shim) ? fs.readFileSync(shim, 'utf8') : '';
  const owned = /^# astra-build commit-msg v.*$/m.test(old);
  if (owned && old.split('\n').includes(marker) && fs.existsSync(copy) && bytes.equals(fs.readFileSync(copy))) {
    return result('current', 'The Codex-Job commit hook is current.');
  }
  if (present && !owned && exists(previous)) {
    return result('conflict', 'astra-build: both commit-msg and commit-msg.pre-astra-build already exist.');
  }

  const temp = fs.mkdtempSync(path.join(hooksDir, '.astra-build-'));
  let backedUp = false;
  try {
    for (const [file, content] of [['shim', script], ['copy', bytes]]) {
      const target = path.join(temp, file);
      fs.writeFileSync(target, content);
      fs.chmodSync(target, 0o755);
    }
    // Preserve the foreign inode before replacing its name. Concurrent installers
    // must never overwrite the backup, or leave Git without a commit-msg hook.
    if (present && !owned) {
      try {
        fs.linkSync(shim, previous);
        backedUp = true;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        return result('conflict', 'astra-build: both commit-msg and commit-msg.pre-astra-build already exist.');
      }
    }
    fs.renameSync(path.join(temp, 'copy'), copy);
    fs.renameSync(path.join(temp, 'shim'), shim);
  } catch (error) {
    if (backedUp) fs.unlinkSync(previous);
    throw error;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  if (owned) return result('updated', 'Updated the Codex-Job commit hook.');
  if (present) return result('chained', 'Installed the Codex-Job check after the existing commit hook.');
  return result('installed', 'Installed the Codex-Job commit hook.');
}
