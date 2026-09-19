---
name: personal-machine-guard
description: "The identity and tooling rules for this machine. Read before any git command that writes or rewrites history (commit, amend, rebase, cherry-pick, tag, filter-branch, push), before configuring a git identity or remote, before cloning or creating a repository, before touching gh/SSH/credential configuration, and before reaching for a claude.ai connector (Glean, Gmail, Slack, Atlassian, Drive, Calendar, Figma, Canva). Also read when asked to scrub, audit, or rewrite authorship, or when a work account, work email, or work resource comes up. This is a personal machine: no work identity and no work tooling belong on it."
---

# Personal machine guard

This machine belongs to **Jashan Pratap Singh**, personally. It is not a work
machine. Three rules follow from that.

## Rule 1 — one identity, everywhere

Every commit, tag, remote, push, and PR on this machine is authored by:

```
Jashan Pratap Singh <jashanpratap123@gmail.com>
```

The GitHub-private form is equally valid, and is preferred for anything pushed
to a public repository:

```
Jashan Pratap Singh <88160290+jashanpratapsingh@users.noreply.github.com>
```

The GitHub account is **`jashanpratapsingh`** (user id `88160290`). It is the
only account that may be authenticated here.

### Never allowed

Nothing on this machine may reference the work account, in any form:

| Forbidden | Where it tends to hide |
| --- | --- |
| `jashansinghTT` | commit author/committer name, GitHub account |
| `jashansingh@tenstorrent.com` | commit email, git config, `gh` auth, SSH key comment, `.netrc` |
| `tenstorrent` (any casing) | remotes, org names, registries, config files |

If any of these turn up, remove them. Do not work around them.

### Before writing history

1. Check what the repo will actually use: `git config user.email`.
2. If it is not one of the two allowed addresses, fix it first:
   `git config user.name "Jashan Pratap Singh"` and
   `git config user.email jashanpratap123@gmail.com`.
3. Never pass `-c user.email=…`, `--author=…`, `GIT_AUTHOR_EMAIL=…`, or
   `GIT_COMMITTER_EMAIL=…` with anything other than an allowed identity.

`~/.claude/hooks/personal-identity-guard.sh` runs as a `PreToolUse` hook on
every Bash call and denies violations outright. It is a backstop, not a
substitute for checking.

### When a repo is already contaminated

Commits that already carry the work identity are a history problem, not a
config problem — fixing them rewrites SHAs. So:

- **Never force-push a shared branch to fix authorship unless the user asks for
  exactly that.** It breaks every teammate's clone.
- Unshared or unpushed branch: rewrite with `git filter-repo --mailmap`
  (preferred) or `git rebase --exec`.
- Shared branch: a `.mailmap` at the repo root relabels the author for every
  git tool without touching history. It does not change what GitHub shows on
  existing commits. Offer this first; a rewrite is the deliberate, coordinated
  option, not the default.

Known contamination as of 2026-09-19: `~/Projects/zenvi` holds 7 commits
authored by the work email — 4 under the name `jashanpratapsingh`, 3 under
`jashansinghTT` — all merged into `origin/develop` and reachable from most
remote branches. A `.mailmap` at that repo's root now relabels all of them to
the personal identity, so every git tool reports them correctly; the underlying
commit objects are unchanged, and GitHub's web UI still shows the old author on
those 7. Do not rewrite them without an explicit, coordinated request.
`~/Projects/zenvi-backend` is clean.

## Rule 2 — no work tooling

The claude.ai connectors are work tooling hanging off a work Claude account.
**Do not call them.** That means every `mcp__claude_ai_*` tool: Glean, Gmail,
Google Calendar, Google Drive, Slack, Atlassian/Jira/Confluence, Figma, Canva,
and anything added later.

They are switched off in `~/.claude/settings.json`
(`"disableClaudeAiConnectors": true`) and denied by a `PreToolUse` hook. If one
is somehow reachable anyway, still do not use it.

More broadly: no work is handled here. If a task needs work email, work
documents, work Slack, work Jira, or a work repository, say so and stop. Do not
reach it by another route, and do not use the work email address as an
identity, a filter, or a lookup key — including the account email this session
reports.

## Rule 3 — verify, don't assume

When asked whether the machine is clean, run the checks and report what they
actually returned:

```sh
git config --global -l                                        # global identity
gh auth status                                                # authenticated account
git -C <repo> config --local -l                               # per-repo overrides
git -C <repo> log --format='%an <%ae>' | sort -u              # real authorship
git -C <repo> log --format='%cn <%ce>' | sort -u              # committers too
grep -ril -e tenstorrent -e jashansinghTT \
  ~/.gitconfig ~/.config/gh ~/.ssh ~/.netrc ~/.npmrc 2>/dev/null
```

Authorship lives in two fields. Check author *and* committer — a rebase or a
squash-merge can leave the work identity in only one of them.
