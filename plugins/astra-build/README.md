# astra-build

A Claude Code plugin for one way of working: **Claude Opus scopes, specs, checks, reviews and commits; GPT-6.2
Astra writes all code through Codex.** Every code change is a task with a written spec, run by Codex in its own git
worktree. Opus runs the checks itself, reviews the diff against the spec, sends findings back to the same Codex
thread, and commits only when everything passes, with a `Codex-Job:` trailer naming the thread that wrote the code.

It's opt-in per repo. Installed for your user, it does nothing until a repo has `.claude/build.json`.

## Install

```bash
claude plugin marketplace add <path or github owner/repo of claude-build>
claude plugin install astra-build@claude-build
```
Then, in a repo you want on this workflow, run `/astra-build:init` in Claude Code. Restart sessions after
installing or updating the plugin.

Needs: Node 18+, git, and the Codex CLI 0.169 or later, logged in with an account that offers `gpt-6.2-astra`
(`npm install -g @openai/codex@latest`, then `codex login`), and the `openai-codex` Claude Code plugin, whose
`codex-companion.mjs` runs the tasks. Where Codex isn't available (a cloud session, another machine), the
workflow stops and says so; Opus doesn't fall back to writing the code.

## What it adds

| Piece | What it does |
|---|---|
| `/astra-build:build` | The loop: scope → worktree → spec → Codex → checks → review → findings back → land. |
| `/astra-build:init` | Opts a repo in: writes `.claude/build.json` from what it finds, installs the commit hook, checks Codex. |
| Edit guard (PreToolUse) | Blocks Edit/Write/MultiEdit/NotebookEdit on files the repo's config calls code. |
| Session start | Exports `ASTRA_BUILD` (the plugin's folder) to the session's shell, re-installs the commit hook if a clone lacks it, and warns if Codex is missing or too old. |
| Commit hook | `commit-msg`: a commit that changes code needs a `Codex-Job: <threadId>` line. |
| Scripts | `worktree.sh`, `task.sh`, `checks.sh`, `land.sh`, `init.mjs` in `scripts/`; the spec template in `templates/`. |

## `.claude/build.json`

Committed with the repo. Every field is optional; the defaults are shown.

```json
{
  "model": "gpt-6.2-astra",
  "minCodexCli": "0.169.0",
  "code": ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py,rb,go,rs,java,kt,kts,swift,c,h,cc,cpp,hpp,cs,php,sh,bash,zsh,css,scss,sass,less,html,vue,svelte,sql}"],
  "notCode": ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.venv/**", "**/vendor/**", ".claude/**"],
  "checks": [],
  "worktree": { "base": "origin/main", "setup": [] },
  "land": "push"
}
```

| Field | Meaning |
|---|---|
| `model` | The Codex model every task uses. |
| `minCodexCli` | The oldest Codex CLI `task.sh` accepts. |
| `code` | Globs (repo-relative, POSIX `/`) for files only Astra may write. |
| `notCode` | Globs that win over `code`: generated files, vendored code, the plugin's own config. |
| `checks` | Shell commands Opus runs in the worktree after each Codex round, in order. All must exit 0. |
| `worktree.base` | The ref new task branches start from, and the branch work lands on (`origin/main` lands on `main`). |
| `worktree.setup` | Shell commands run once in a new worktree (install dependencies, `git lfs checkout`). |
| `land` | `"push"`: rebase on the base and push straight to its branch. `"pr"`: push `codex/<slug>` and print the link to open a pull request. |

**Globs.** Matched against the whole repo-relative path; there's no implicit `**/` in front, so `*.config.js`
means a file at the root only. `**` matches any number of path segments (including none), `*` anything within one
segment, `?` one character, and `{a,b}` either alternative (no nesting). A path is code when it matches a `code`
glob and no `notCode` glob.

**Overrides.** The guard allows Opus code edits when Claude was started with `ASTRA_BUILD_ALLOW_OPUS=1`. A commit
of code Codex didn't write says why: `Codex-Job: none (<reason>)`.

## Scripts

All live in `$ASTRA_BUILD/scripts` (the session-start hook exports `ASTRA_BUILD`). Each prints usage with `--help`.

| Script | Usage and behaviour |
|---|---|
| `worktree.sh <slug> [--base <ref>] [--no-setup]` | Makes `<repo>-codex/<slug>` on branch `codex/<slug>` from the base (fetching `origin` first when it exists), runs `worktree.setup` in it, and prints the path on the last line. An existing slug just prints the path. |
| `task.sh <spec.md> --cwd <worktree> [--resume] [--effort <level>]` | Runs one Codex task with the configured model through `codex-companion.mjs task --write --json --prompt-file`. `--resume` continues the last Codex thread in that worktree. Writes `<spec>.result.json`, appends to `<git-common-dir>/astra-build.log`, prints what changed in the worktree (from `git status`), Astra's report, and the `Codex-Job:` line. Exits with Codex's status. |
| `checks.sh --cwd <worktree>` | Runs each `checks` command in the worktree, one after another, logging each to a file. Prints PASS/FAIL with the exit code per check and exits 1 if any failed. |
| `land.sh --cwd <worktree> --message <file> [--cleanup]` | Commits everything in the worktree with the message (the commit hook enforces the trailer), fetches and rebases on the base; if the rebase brought in new commits, reruns `checks.sh` and stops on failure. Then lands per `land`. `--cleanup` removes the worktree and branch after a `push` landing. |
| `init.mjs [--force] [--dry-run] [--land push\|pr]` | Writes `.claude/build.json` for the repo it runs in (see below), installs the commit hook, and reports the Codex CLI's version and login. |

**What init detects.** `package.json` (npm, pnpm or yarn by lockfile): `worktree.setup` installs from the
lockfile (or `npm install --no-package-lock` without one, so a task never commits a stray lockfile), and `checks` gets the `typecheck`, `lint` and `test` scripts that exist. `pyproject.toml` or
`requirements.txt`: `uv sync` with `uv.lock`, else `pip install -r requirements.txt`; `checks` gets `pytest` when
tests exist. `Cargo.toml`: `cargo test`. `go.mod`: `go vet ./...` and `go test ./...`. `filter=lfs` in
`.gitattributes`: `git lfs checkout` first. `worktree.base` is `origin/<default branch>`, or the current branch
when there's no `origin`.

## The commit hook

Installed into the clone's effective hooks folder (`git rev-parse --git-path hooks`, which follows
`core.hooksPath`) as two files: `commit-msg`, a POSIX `sh` shim stamped `# astra-build commit-msg v<version>`, and
`astra-build-commit-msg.cjs`, a copy of `scripts/commit-msg.cjs` that the shim runs with `node`. (The `.cjs` file
is CommonJS so Node runs it the same way wherever it's copied.) An existing `commit-msg` that isn't ours is renamed
`commit-msg.pre-astra-build` and still runs first; if it fails, the commit stops there. When `core.hooksPath`
points inside the work tree (a committed hooks folder), the installer doesn't write there: it says so, and that repo
adds the check to its own hook. Merge commits pass. The copied check is self-contained (it reads
`.claude/build.json` itself and imports nothing from the plugin), so it keeps working when the plugin moves or
updates; the session-start hook refreshes both files when the plugin's version changes.

## Limits

- The guard covers Claude's file-editing tools. Code written through the shell is caught at commit time.
- `.claude/build.json` and the plugin's own files aren't code to the guard, so the rules can be maintained, and
  therefore edited around. It's a guardrail for an honest workflow, not a security boundary.
- It runs only where the Codex CLI is installed and logged in.
