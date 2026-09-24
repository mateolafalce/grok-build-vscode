/**
 * Conventional Commits gate: subject shape, the GitHub event range, and the
 * CI / release wiring that has to keep calling it.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUBJECT_MAX_LENGTH,
  checkCommitMessage,
  commitRangeForEvent,
  evaluateCommits,
  formatCommitFailures,
  gitLogArgs,
  parseGitLog,
  reportParsedLog,
} from "../scripts/check-conventional-commits.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "a".repeat(40);
const head = "b".repeat(40);
const before = "c".repeat(40);

function subjectOfLength(length: number): string {
  const prefix = "feat: ";
  return prefix + "x".repeat(length - prefix.length);
}

describe("checkCommitMessage", () => {
  it("accepts a type and a description", () => {
    expect(checkCommitMessage("feat: add a commit gate")).toEqual({ ok: true, errors: [] });
  });

  it("accepts a scope, a breaking marker, and a body after a blank line", () => {
    const message = "feat(ci)!: require conventional subjects\n\nThe body says why.\n\nBREAKING CHANGE: prose subjects fail CI\n";
    expect(checkCommitMessage(message).ok).toBe(true);
  });

  it("accepts every allowed type", () => {
    for (const type of ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"]) {
      expect(checkCommitMessage(`${type}: one line`).ok).toBe(true);
    }
  });

  it("rejects a prose subject", () => {
    const result = checkCommitMessage("Put the rule into the hub doc");
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/type\(optional-scope\)/);
  });

  it("rejects a missing space, an unknown type, and an empty description", () => {
    expect(checkCommitMessage("feat:no space").ok).toBe(false);
    expect(checkCommitMessage("feature: too long a type").ok).toBe(false);
    expect(checkCommitMessage("feat:").ok).toBe(false);
    expect(checkCommitMessage("feat: ").ok).toBe(false);
  });

  it("rejects a body that starts on the next line", () => {
    const result = checkCommitMessage("fix: stop the leak\nThe why belongs after a blank line.");
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("a body must be separated from the subject by a blank line");
  });

  it("rejects an empty message and surrounding whitespace on the subject", () => {
    expect(checkCommitMessage("\n").ok).toBe(false);
    expect(checkCommitMessage(" feat: padded").errors).toContain("subject has leading or trailing whitespace");
  });

  it("caps the subject at 100 characters", () => {
    expect(subjectOfLength(SUBJECT_MAX_LENGTH).length).toBe(100);
    expect(checkCommitMessage(subjectOfLength(SUBJECT_MAX_LENGTH)).ok).toBe(true);
    const over = checkCommitMessage(subjectOfLength(SUBJECT_MAX_LENGTH + 1));
    expect(over.ok).toBe(false);
    expect(over.errors.join("\n")).toMatch(/101 characters/);
  });
});

describe("evaluateCommits", () => {
  it("skips merge commits and reports the others", () => {
    const failures = evaluateCommits([
      { hash: "m".repeat(40), parents: ["a", "b"], message: "Merge pull request #9 from someone/branch\n" },
      { hash: "d".repeat(40), parents: ["a"], message: "docs: name the commit rule\n" },
      { hash: "e".repeat(40), parents: ["d"], message: "Explain the why in prose\n" },
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.hash.startsWith("e")).toBe(true);
    expect(formatCommitFailures(failures)).toMatch(/Explain the why in prose/);
  });
});

describe("git log parsing and event ranges", () => {
  it("parses hash, parents, and message records", () => {
    const raw = `abc\x1fparent\x1ffeat: add a gate\n\x1e\nmerge\x1fleft right\x1fMerge branch 'x'\n\x1e`;
    expect(parseGitLog(raw)).toEqual([
      { hash: "abc", parents: ["parent"], message: "feat: add a gate\n" },
      { hash: "merge", parents: ["left", "right"], message: "Merge branch 'x'\n" },
    ]);
    expect(reportParsedLog(raw)).toEqual({ ok: true, checked: 1 });
  });

  it("uses the pull request head, not the synthetic merge commit", () => {
    expect(commitRangeForEvent({
      eventName: "pull_request",
      baseSha: base,
      prHeadSha: head,
    })).toEqual({ kind: "range", range: `${base}..${head}` });
  });

  it("uses the push range, and only the tip when the ref is new", () => {
    expect(commitRangeForEvent({
      eventName: "push",
      beforeSha: before,
      headSha: head,
    })).toEqual({ kind: "range", range: `${before}..${head}` });
    const created = commitRangeForEvent({
      eventName: "push",
      beforeSha: "0".repeat(40),
      headSha: head,
    });
    expect(created).toEqual({ kind: "new-ref", head });
    expect(gitLogArgs(created)).toEqual(["log", "-1", "--format=%H%x1f%P%x1f%B%x1e", head]);
  });

  it("refuses a range built from anything other than a full SHA", () => {
    expect(() => commitRangeForEvent({
      eventName: "push",
      beforeSha: "HEAD",
      headSha: head,
    })).toThrow(/push before SHA/);
    expect(() => commitRangeForEvent({ eventName: "workflow_dispatch" })).toThrow(/unsupported GitHub event/);
  });
});

describe("wiring", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  const claude = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
  const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  const releaseSh = fs.readFileSync(path.join(root, "scripts", "release.sh"), "utf8");
  const releasePs1 = fs.readFileSync(path.join(root, "scripts", "release.ps1"), "utf8");

  it("CI runs the checker on pull requests and pushes to main", () => {
    expect(workflow).toMatch(/jobs:[\s\S]*\n {2}commits:/);
    expect(workflow).toContain("node scripts/check-conventional-commits.mjs --github");
    expect(workflow).toContain("PR_BASE_SHA:");
    expect(workflow).toContain("PR_HEAD_SHA:");
    expect(workflow).toContain("PUSH_BEFORE_SHA:");
    expect(workflow).toContain("PUSH_HEAD_SHA:");
  });

  it("documents the rule where agents read it", () => {
    expect(agents).toMatch(/Conventional Commits/);
    expect(claude).toMatch(/checkCommitMessage/);
    expect(claude).toMatch(/commitRangeForEvent/);
    expect(pkg.scripts["check:commits"]).toBe("node scripts/check-conventional-commits.mjs");
  });

  it("defaults the release commit subject to a conventional subject", () => {
    expect(releaseSh).toContain('MSG="chore: release $tag"');
    expect(releasePs1).toContain('$Message = "chore: release $tag"');
    expect(checkCommitMessage("chore: release v4.11.2").ok).toBe(true);
  });
});
