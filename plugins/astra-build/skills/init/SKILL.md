---
name: init
description: Put the current repo on the astra-build workflow (Opus specs and reviews, GPT-6.2 Astra writes all code). Writes .claude/build.json from what the repo uses, installs the Codex-Job commit hook, checks the Codex CLI, and adds the workflow to the repo's agent instructions. Use when the user asks to set up astra-build, or the Opus-plans-Astra-codes workflow, in a repo.
---

# Init: put this repo on astra-build

1. Find the plugin: `"$ASTRA_BUILD"`, or `ls -d ~/.claude/plugins/cache/*/astra-build/* | sort -V | tail -1`.
2. Preview: `node "$ASTRA_BUILD/scripts/init.mjs" --dry-run` in the repo root. Read the config it proposes.
   Check `code` covers the repo's source and nothing else (generated files, vendored code and content belong in
   `notCode`), and that `checks` are the commands that really gate a change here. Look at the repo's package
   scripts, CI config and README to confirm. Ask the user whether changes should push straight to the base branch
   or go through pull requests (`--land push` or `--land pr`) unless the repo's instructions already say.
3. Write it: `node "$ASTRA_BUILD/scripts/init.mjs" [--land pr]`. Then edit `.claude/build.json` by hand for anything
   the detection missed (it's config, so the guard allows it).
4. Add the workflow to the repo's agent instructions (CLAUDE.md, or AGENTS.md when CLAUDE.md imports it): one short
   section saying GPT-6.2 Astra writes all code through `/astra-build:build`, Opus specs, checks, reviews and
   lands, and commits carry `Codex-Job:`. If AGENTS.md exists, add a line for Codex: it works in its own worktree
   from a written spec, doesn't commit, and stays inside the files the spec names.
5. If init reported that the repo commits its own hooks folder (`core.hooksPath` inside the work tree), add the
   Codex-Job check to that folder's `commit-msg` instead; `scripts/commit-msg.cjs` shows the logic.
6. Report what was written, what Codex looks like (version, login), and anything left for the user. Commit the
   config and instructions only if the repo's instructions say to commit without asking; otherwise ask.
