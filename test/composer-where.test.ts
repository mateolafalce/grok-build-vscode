import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { composerWhereFromGit, folderLeaf, gitDirsDiffer } from "../src/composer-where";
import { readComposerWhere, type GitIo } from "../src/git-run";

describe("composerWhereFromGit", () => {
  it("reads a main checkout", () => {
    expect(composerWhereFromGit({
      cwd: "/work/n8n-workflows",
      result: { ok: true, stdout: "true\nchore/sync-workflows\n.git\n.git\n", stderr: "" },
    })).toEqual({
      folder: "n8n-workflows",
      branch: "chore/sync-workflows",
      detached: false,
      linkedWorktree: false,
      kind: "ok",
    });
  });

  it("treats a differing git dir as a linked worktree", () => {
    expect(gitDirsDiffer(
      "/repo/.git/worktrees/feat",
      "/repo/.git",
      "/repo-wt",
    )).toBe(true);
    expect(composerWhereFromGit({
      cwd: "/repo-wt",
      result: {
        ok: true,
        stdout: "true\nfeat/composer-where\n/repo/.git/worktrees/feat\n/repo/.git\n",
        stderr: "",
      },
    })).toMatchObject({ branch: "feat/composer-where", linkedWorktree: true, detached: false });
  });

  it("resolves a relative git dir against the cwd before comparing", () => {
    expect(gitDirsDiffer(".git", ".git", "/work/app")).toBe(false);
    expect(gitDirsDiffer(".git/worktrees/wt", ".git", "/work/app")).toBe(true);
  });

  it("folds windows paths only", () => {
    expect(gitDirsDiffer("C:/Repo/.git", "c:/repo/.git", "C:/Repo", "win32")).toBe(false);
    expect(gitDirsDiffer("C:/Repo/.git", "c:/repo/.git", "C:/Repo", "linux")).toBe(true);
  });

  it("says Detached when abbrev-ref is HEAD", () => {
    expect(composerWhereFromGit({
      cwd: "/work/app",
      result: { ok: true, stdout: "true\nHEAD\n.git\n.git\n", stderr: "" },
    })).toMatchObject({ branch: null, detached: true, linkedWorktree: false });
  });

  it("classifies a missing git and a non-repo", () => {
    expect(composerWhereFromGit({
      cwd: "/work/app",
      result: { ok: false, stdout: "", stderr: "spawn git ENOENT", spawnFailed: true },
    }).kind).toBe("no-git");
    expect(composerWhereFromGit({
      cwd: "/work/notes",
      result: { ok: false, stdout: "", stderr: "fatal: not a git repository" },
    })).toMatchObject({ folder: "notes", kind: "not-a-repo", branch: null });
  });

  it("keeps an unborn repository as a checkout with no branch", () => {
    expect(composerWhereFromGit({
      cwd: "/work/new",
      result: { ok: false, stdout: "true\n", stderr: "fatal: ambiguous argument 'HEAD'" },
    })).toMatchObject({ kind: "ok", branch: null, detached: false });
  });

  it("names the folder from the last segment", () => {
    expect(folderLeaf("/work/n8n-workflows/")).toBe("n8n-workflows");
    expect(folderLeaf("")).toBe("");
  });
});

describe("readComposerWhere", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function git(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd }, (err, stdout, stderr) => {
        if (err) reject(new Error(String(stderr || err.message)));
        else resolve(String(stdout));
      });
    });
  }

  it("asks rev-parse for the four lines, in order", async () => {
    let args: string[] = [];
    const io = {
      execFile: ((_cmd: string, got: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
        args = got;
        cb(null, "true\nmain\n.git\n.git\n", "");
        return {} as never;
      }),
    } as unknown as GitIo;
    const where = await readComposerWhere("/work/app", { io });
    expect(args.slice(0, 2)).toEqual(["-C", "/work/app"]);
    expect(args.slice(2)).toEqual([
      "rev-parse", "--is-inside-work-tree", "--abbrev-ref", "HEAD", "--git-dir", "--git-common-dir",
    ]);
    expect(where).toMatchObject({ folder: "app", branch: "main", linkedWorktree: false, kind: "ok" });
  });

  it("reads a real main checkout and a linked worktree", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "composer-where-"));
    dirs.push(root);
    const repo = path.join(root, "repo");
    const wt = path.join(root, "wt");
    fs.mkdirSync(repo);
    await git(repo, ["init"]);
    await git(repo, ["config", "user.email", "where@example.com"]);
    await git(repo, ["config", "user.name", "where"]);
    fs.writeFileSync(path.join(repo, "f.txt"), "a\n");
    await git(repo, ["add", "f.txt"]);
    await git(repo, ["commit", "-m", "init"]);
    const branch = (await git(repo, ["branch", "--show-current"])).trim();
    expect(await readComposerWhere(repo)).toMatchObject({
      folder: "repo",
      branch,
      detached: false,
      linkedWorktree: false,
      kind: "ok",
    });
    await git(repo, ["worktree", "add", "-b", "feat/isolated", wt]);
    expect(await readComposerWhere(wt)).toMatchObject({
      folder: "wt",
      branch: "feat/isolated",
      detached: false,
      linkedWorktree: true,
      kind: "ok",
    });
    const empty = fs.mkdtempSync(path.join(root, "empty-"));
    expect((await readComposerWhere(empty)).kind).toBe("not-a-repo");
  });
});
