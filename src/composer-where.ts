/**
 * Where the composer says the session is standing.
 *
 * Claude Code draws this as a quiet row above the prompt: the machine, the
 * folder, the branch, and whether the checkout is a worktree. The host owns
 * the git read. The webview only paints the frame, so a client cannot point
 * `git` at a path the host did not already trust as this session's cwd.
 *
 * One `git rev-parse` is enough:
 * `--is-inside-work-tree`, `--abbrev-ref HEAD`, `--git-dir`, `--git-common-dir`.
 * A linked worktree is the case where the git dir and the common dir differ.
 * The main checkout prints the same path for both.
 */

export type ComposerWhereKind = "ok" | "no-git" | "not-a-repo";

export interface ComposerWhere {
  folder: string;
  branch: string | null;
  detached: boolean;
  linkedWorktree: boolean;
  kind: ComposerWhereKind;
}

/** The slice of a git result this parser needs. Kept local so git-run can call in. */
export interface WhereGitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  spawnFailed?: boolean;
}

const NOT_A_REPO = /not a git repository|does not appear to be a git repository/i;

/** Last path segment. Empty when there is no cwd yet. */
export function folderLeaf(cwd: string): string {
  const parts = String(cwd || "").replace(/[\\/]+$/, "").split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

function normalizeGitPath(p: string, cwd: string, platform: NodeJS.Platform): string {
  let n = String(p || "").trim().replace(/\\/g, "/");
  if (!n) return "";
  const absolute = n.startsWith("/") || /^[A-Za-z]:\//.test(n);
  if (!absolute) {
    const base = String(cwd || "").replace(/\\/g, "/").replace(/\/+$/, "");
    n = base ? `${base}/${n}` : n;
  }
  n = n.replace(/\/+$/, "");
  return platform === "win32" ? n.toLowerCase() : n;
}

/**
 * True when this checkout is a linked worktree.
 * Equal paths are the main worktree, including a submodule that is not linked.
 */
export function gitDirsDiffer(
  gitDir: string,
  commonDir: string,
  cwd: string,
  platform: NodeJS.Platform = "linux",
): boolean {
  const a = normalizeGitPath(gitDir, cwd, platform);
  const b = normalizeGitPath(commonDir, cwd, platform);
  if (!a || !b) return false;
  return a !== b;
}

export function composerWhereFromGit(opts: {
  cwd: string;
  result: WhereGitResult;
  platform?: NodeJS.Platform;
}): ComposerWhere {
  const platform = opts.platform ?? "linux";
  const folder = folderLeaf(opts.cwd);
  const blank = (kind: ComposerWhereKind): ComposerWhere => ({
    folder,
    branch: null,
    detached: false,
    linkedWorktree: false,
    kind,
  });
  const result = opts.result;
  if (result.spawnFailed) return blank("no-git");
  if (!result.ok) {
    if (NOT_A_REPO.test(result.stderr || "")) return blank("not-a-repo");
    // Unborn repository: rev-parse dies on HEAD. Still a checkout, just no branch.
    return blank("ok");
  }
  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if ((lines[0] || "").toLowerCase() !== "true") return blank("not-a-repo");
  const rawBranch = lines[1] || "";
  const detached = rawBranch === "HEAD";
  return {
    folder,
    branch: detached || !rawBranch ? null : rawBranch,
    detached,
    linkedWorktree: gitDirsDiffer(lines[2] || "", lines[3] || "", opts.cwd, platform),
    kind: "ok",
  };
}
