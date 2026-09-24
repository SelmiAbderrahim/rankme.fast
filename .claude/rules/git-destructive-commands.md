# Destructive Git Commands - Strict Rule

## MANDATORY REQUIREMENT - ZERO TOLERANCE

**NEVER run destructive git commands without explicit user confirmation in the current turn.**

Approval for a destructive command is scoped to that single invocation in that single turn — it is NEVER persisted, inferred from prior approval, or generalized to "similar" commands.

## Why This Rule Exists

Destructive git operations can silently destroy uncommitted work, rewrite shared history, or make past work unrecoverable. The user has been burned by this class of action and has opted in to explicit confirmation every time.

## Forbidden Without Explicit Per-Turn Confirmation

These commands MUST trigger a confirmation prompt every time. If the permission tool does not prompt, STOP and ask the user manually before executing.

### Working-Tree / Index Discard

| Command | Blast Radius |
|---------|--------------|
| `git stash`, `git stash push`, `git stash save` | Silently hides uncommitted changes; easy to forget |
| `git stash drop`, `git stash clear` | Permanently deletes stashed work |
| `git stash pop` | Can conflict-lose changes during apply |
| `git reset --hard` | Discards uncommitted and committed work |
| `git reset --merge`, `git reset --keep` | Can discard work in edge cases |
| `git clean -f`, `git clean -fd`, `git clean -fx`, `git clean -fdx` | Deletes untracked files / directories |
| `git checkout -- <path>`, `git checkout .` | Discards working-tree changes to path |
| `git restore <path>` (without `--staged`) | Same as above |
| `git restore .`, `git restore --source=...` | Same as above |

### History Rewrite

| Command | Blast Radius |
|---------|--------------|
| `git commit --amend` | Rewrites the last commit; breaks anything downstream |
| `git rebase`, `git rebase -i`, `git rebase --onto` | Rewrites history; can drop commits |
| `git filter-branch`, `git filter-repo` | Mass history rewrite |
| `git reflog delete`, `git reflog expire` | Removes the safety net for recovering lost commits |
| `git update-ref -d` | Deletes refs without the usual checks |

### Remote / Shared State

| Command | Blast Radius |
|---------|--------------|
| `git push --force`, `git push -f` | Overwrites remote history |
| `git push --force-with-lease` | Safer, but still overwrites — still requires confirmation |
| `git push --delete`, `git push :<branch>` | Deletes remote branch |

### Branch / Worktree Deletion

| Command | Blast Radius |
|---------|--------------|
| `git branch -D <branch>`, `git branch --delete --force` | Force-deletes branch, including unmerged commits |
| `git worktree remove --force` | Removes worktree + any uncommitted work inside it |
| `git gc --prune=now`, `git gc --aggressive` | Eagerly removes unreachable objects; last-resort recovery gone |

## Allowed Without Confirmation (Read-Only / Safe)

- `git status`
- `git diff`, `git diff --cached`, `git diff <ref>`
- `git log`, `git log --oneline`, `git log <ref>`
- `git show`, `git show <ref>`
- `git blame`
- `git ls-files`, `git ls-tree`
- `git branch` (list only, no flags that delete)
- `git remote -v`, `git remote show`
- `git fetch`, `git fetch --all`
- `git stash list`, `git stash show`
- `git config --get`, `git config --list`
- `git reflog` (read), `git reflog show`
- `git worktree list`

## Conditionally Allowed (User Must Have Asked For The Action)

These MAY run without an additional prompt, but ONLY when the user explicitly asked for the action in the current turn (e.g. "commit and push this"):

- `git add <path>`, `git add -A`, `git add .`
- `git commit -m "..."` (NOT `--amend`)
- `git push` (no `--force`, `-f`, `--delete`, `--force-with-lease`)
- `git checkout <branch>` (branch-switch form only; never the `-- <path>` form)
- `git switch <branch>`
- `git merge <ref>` (non-conflicting, fast-forward or explicit)
- `git tag <name>`
- `git cherry-pick <ref>`

If the user only asked a research question, none of these should run — read-only commands are sufficient.

## Confirmation Contract

When a forbidden command is needed:

1. **Do not invoke the tool yet.**
2. **State the exact command** you want to run (copy-paste-ready).
3. **Explain the blast radius** — what gets lost, what gets rewritten, what's recoverable and what isn't.
4. **Wait for explicit "yes run it"** from the user. A general "sounds good" on an unrelated topic does NOT count.
5. Run it once, then stop. Do NOT chain a second destructive command on the same approval.

## Bypass Is Forbidden

- NEVER use `--no-verify` to skip commit/push hooks unless the user asked for it.
- NEVER use `-c commit.gpgsign=false` / `--no-gpg-sign` to bypass signing.
- NEVER chain destructive commands behind `&&` or `;` to escape the prompt.
- NEVER use `bash -c "..."` or heredocs to wrap a destructive command in a way that defeats the allowlist pattern.

## Root-Cause First

When you hit an obstacle (failing hook, merge conflict, dirty working tree), do NOT reach for a destructive command as a shortcut.

| Symptom | Wrong Reflex | Right Approach |
|---------|--------------|----------------|
| Pre-commit hook fails | `git commit --no-verify` | Read the hook output, fix the lint/format issue |
| Merge conflict | `git reset --hard HEAD` | Resolve the conflict, or `git merge --abort` to safely revert |
| Unknown files in tree | `git clean -fd` | Inspect each file; they may be in-progress user work |
| "Your branch has diverged" | `git push --force` | Pull/rebase with confirmation, or ask before force-pushing |
| Want to test a past commit | `git reset --hard <sha>` | `git checkout <sha>` (detached HEAD) or a scratch branch |
