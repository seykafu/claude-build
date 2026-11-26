# claude-build: agent instructions

A Claude Code plugin marketplace with one plugin, `plugins/astra-build`. Its README is the spec for every script
and hook: read it before changing anything.

## Conventions
- **No dependencies.** Node built-ins only (`node:fs`, `node:path`, `node:child_process`, `node:os`, `node:test`,
  `node:assert`). No package.json dependencies, no npm install.
- Node 18+ and ES modules (`.mjs`). Shell scripts are `#!/usr/bin/env bash` and must run on **bash 3.2** (macOS's
  /bin/bash): no `mapfile`/`readarray`, no associative arrays, no `${var,,}`.
- **git 2.23** must work: no `git rev-parse --path-format`, no `git switch`/`restore`. Resolve relative paths from
  `git rev-parse --git-path` / `--git-common-dir` against the directory git ran in.
- Scripts print usage with `--help`, write errors to stderr with a `astra-build:` prefix, and never print secrets.
- Hooks must be fast (well under a second) and must never crash Claude: catch everything, and fail open (exit 0)
  on unexpected errors, except where the README says a hook blocks.
- Tests live in `plugins/astra-build/tests/*.test.mjs` and run with `node --test plugins/astra-build/tests/*.test.mjs` (Node 22 rejects a bare folder).
  Tests that need git make throwaway repos under `os.tmpdir()` and delete them.

## Working agreement for coding agents
- Make the change, run `node --test plugins/astra-build/tests/*.test.mjs` and `bash -n` on every shell script, and report
  what you changed and what you verified.
- **Do not commit or push.** The orchestrator reviews and commits.
- Stay inside the files the task names. If the change seems to need another file, stop and say so in the report.

## This repo uses its own workflow
`.claude/build.json` puts this repo on astra-build: GPT-6.2 Astra writes the code (scripts, hooks, tests) from a
spec in its own worktree; Opus writes the README, skills, manifests and specs, runs the checks, reviews, and lands
with a `Codex-Job:` trailer.
