# Codex task spec (template)

Copy this to the session scratchpad as `<slug>.spec.md`, fill in every section, and delete these instructions and
the examples. Run it with `"$ASTRA_BUILD/scripts/task.sh" <spec> --cwd <worktree>`. GPT-6.2 Astra reads the spec and
the repo's agent instructions and nothing else, so say everything it needs here.

---

# <Task title: what will be true when it's done>

You're working in a git worktree on branch `codex/<slug>`. Follow the repo's agent instructions (AGENTS.md if it
exists). Don't commit or push.

## Goal
One or two sentences: the user-visible or developer-visible result, and why it's wanted.

## Background
What exists today and where, with file paths and line numbers. Quote the current behaviour, and any bug's repro
steps. Name the docs or design sections whose rules apply.

## Change
What to build, as concrete steps. Name functions, types and data shapes when they matter.

## Files
- May change: `path/one.ts`, `path/two.ts`, and their tests
- May add: `path/new.ts`
- Must not touch: anything else. If the change seems to need another file, stop and say so in the report.

## Acceptance criteria
Observable and checkable, one per line:
- [ ] e.g. Saving with an empty title shows "Add a title" and doesn't send the request
- [ ] e.g. A new test covers the empty title and a title of only spaces
- [ ] The repo's checks pass: <the commands from .claude/build.json>

## Out of scope
What not to do, even if it looks related.

## Constraints
- No new dependencies unless named here.
- No invented numbers or rules: if one is missing, leave a clearly marked comment and say so in the report.

## Report back
End with: what you changed (file by file), what you ran and its result, anything you couldn't run (the sandbox
can't bind ports and may block some tools, so say so rather than guess), and any open question.
