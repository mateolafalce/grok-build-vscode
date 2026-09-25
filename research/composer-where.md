# Composer location row

The composer card shows two facts above the prompt: the open project's folder, and its current branch.

- **Folder** is the leaf of the project the editor has open (`workspaceRoot` on the desk, `workspaceCwd` on the `repos` frame). Opening another project repaints it. The tooltip is the full path. Click copies it. On the remote client, click opens the repository switcher. The conversation's own checkout does not relabel this chip.
- **Branch** is `git rev-parse --abbrev-ref HEAD` of that same folder. The host reads it (`readComposerWhere` in `src/git-run.ts`, parsed by `src/composer-where.ts`) and posts `composerWhere`, including the local names from `readLocalBranches`. The client never names a path for git to read. Detached HEAD says Detached. A directory that is not a repository omits the branch.
- The branch chip opens a menu of those local names. Picking one posts `switchBranch`. The host checks the name against a fresh `for-each-ref` list and then runs `git checkout` in the open project (`checkoutLocalBranch`). A name that is not in the list never reaches git.

The frame is mirrored to remotes under the session's existing scope. It is refreshed when the open project changes, with the conversation name, on startup, and after a Changes-view git operation.
