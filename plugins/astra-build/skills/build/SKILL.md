---
name: build
description: Make any code change in a repo that has .claude/build.json. Opus scopes and specs it, GPT-6.2 Astra writes the code through Codex in its own worktree, Opus runs the checks and reviews the diff, sends findings back to the same Codex thread, then lands it with a Codex-Job trailer. Use for every code change in such a repo, however small; Opus never edits code itself.
---

# Build: Opus specs and reviews, GPT-6.2 Astra writes the code

In a repo with `.claude/build.json`, code is written by GPT-6.2 Astra through Codex. You scope the work, write
the spec, run the checks, review what comes back, send findings back, and land it. The edit guard blocks your
Edit/Write on code files, and the commit hook refuses a code commit without a `Codex-Job:` trailer. Docs, specs,
config and non-code content stay yours to edit. Only the user lifts the guard (`ASTRA_BUILD_ALLOW_OPUS=1`).

The scripts are in `$ASTRA_BUILD/scripts`. If `ASTRA_BUILD` is empty in your shell, find the plugin with
`ls -d ~/.claude/plugins/cache/*/astra-build/* | sort -V | tail -1` and use that path instead.

## 0. Preconditions
- The repo has `.claude/build.json`. If not, offer `/astra-build:init` instead of starting.
- `codex --version` is at least the config's `minCodexCli`. If Codex is missing, too old or logged out, stop and
  tell the user; don't write the code yourself.

## 1. Scope
- One task is one coherent change a reviewer can hold in their head: a few hundred lines at most. Split bigger
  work into tasks that land one after another, or run in parallel when their files don't overlap.
- Read the code first, so the spec names the real files, functions and line numbers.
- Pick a kebab-case slug, e.g. `marker-live-position`.

## 2. Worktree
```bash
"$ASTRA_BUILD/scripts/worktree.sh" <slug>
```
It prints the worktree's path (`<repo>-codex/<slug>`, branch `codex/<slug>`) after running the config's setup.

## 3. Spec
Copy `$ASTRA_BUILD/templates/SPEC_TEMPLATE.md` to the session scratchpad as `<slug>.spec.md` and fill in every
section. Astra reads the spec and the repo's agent instructions (AGENTS.md) and nothing else, so put everything it
needs in the spec: paths, line numbers, the current behaviour, the rules that apply, checkable acceptance criteria.

## 4. Run it in the background
```bash
"$ASTRA_BUILD/scripts/task.sh" <scratchpad>/<slug>.spec.md --cwd <worktree>
```
Run it as a background shell command and wait for the exit notification; don't poll. Read the summary: what
changed in the worktree, Astra's report, and the `Codex-Job:` line.

## 5. Check
```bash
"$ASTRA_BUILD/scripts/checks.sh" --cwd <worktree>
```
It runs the config's checks and exits non-zero if any fail. Branch on its exit code. Astra's own claims about
tests don't count: its sandbox can't bind ports and can block some tools. Add checks the config doesn't list
when the change needs them (a build, a screenshot of anything visible).

## 6. Review
Read `git -C <worktree> diff <base>` against the spec:
- files outside the spec's list, or changes nobody asked for
- behaviour that differs from the acceptance criteria; edge cases the spec named but the code skips
- new dependencies; numbers or rules that contradict the project's own docs
- extra work on hot paths; fail-closed defaults that hurt the user; secrets in code
- tests that assert the implementation rather than the behaviour
For a larger diff, `/code-review` on the worktree is a good second read.

## 7. Send findings back to the same thread
Write the findings to `<slug>.fix-1.md` (file:line, what's wrong, what right looks like), then:
```bash
"$ASTRA_BUILD/scripts/task.sh" <scratchpad>/<slug>.fix-1.md --cwd <worktree> --resume
```
Repeat steps 5–7. Never patch the code yourself, even a one-liner. After three rounds without a clean result,
stop: shrink the spec and start again in a fresh worktree.

## 8. Land
Write the commit message to a file: the repo's usual style, then the trailers.
```
Codex-Job: <threadId>
Co-Authored-By: <the attribution line this session uses>
```
```bash
"$ASTRA_BUILD/scripts/land.sh" --cwd <worktree> --message <file> --cleanup
```
It commits, rebases on the base, reruns the checks if the rebase brought in new commits, and pushes to the base
branch (`land: "push"`) or pushes `codex/<slug>` and prints the pull request link (`land: "pr"`). Pushing follows
the repo's own instructions: if they don't say to push without asking, ask first.
