# Composer location row

Claude Code draws four facts in a quiet row above the prompt: where the session runs (`Local`), the folder leaf, the current branch (truncated), and a worktree checkbox.

The composer card here shows the same four.

- **Place** comes from the host: `local` or `cloud`. A phone is looking at the machine the agent runs on, so the chip does not say Remote.
- **Folder** is the leaf of the session checkout. The tooltip is the full path. Click copies it. On the remote client, click opens the repository switcher.
- **Branch** is `git rev-parse --abbrev-ref HEAD` of that checkout. The host reads it (`readComposerWhere` in `src/git-run.ts`, parsed by `src/composer-where.ts`) and posts `composerWhere`. The client never names a path for git to read. Detached HEAD says Detached. A directory that is not a repository omits the branch.
- **Worktree** is checked when `--git-dir` differs from `--git-common-dir`, or when the session was started as one of ours. In Coding, on the desk, the empty box starts a new worktree session (the same `newWorktreeSession` the conversation menu already posts). Unchecking does not delete the checkout. Apply and Remove stay where they were. Knowledge work only shows the chip once the checkout already is a worktree.

The frame is mirrored to remotes under the session's existing scope. It is refreshed with the conversation name, on startup, and after a Changes-view git operation, because that is when the branch can move.
