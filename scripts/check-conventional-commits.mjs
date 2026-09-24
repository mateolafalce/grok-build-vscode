/**
 * Reject commit subjects that are not Conventional Commits 1.0.0.
 *
 * CI (`commits` in `.github/workflows/ci.yml`) passes `--github` and the
 * SHAs of the push or pull request. The check covers commits that event
 * introduced. Merge commits are skipped. History already on the base is
 * not revisited.
 *
 *   node scripts/check-conventional-commits.mjs origin/main..HEAD
 *   node scripts/check-conventional-commits.mjs --github
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const COMMIT_TYPES = Object.freeze([
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
]);

export const SUBJECT_MAX_LENGTH = 100;

const ZERO_SHA = "0".repeat(40);
const SHA_RE = /^[0-9a-f]{40}$/;
const TYPE_RE = COMMIT_TYPES.join("|");
const SUBJECT_RE = new RegExp(`^(?:${TYPE_RE})(?:\\([A-Za-z0-9._/-]+\\))?!?: [^\\s].*$`);

/**
 * @param {string} message
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkCommitMessage(message) {
  const errors = [];
  const normalized = String(message).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");
  if (normalized.length === 0) {
    return { ok: false, errors: ["commit message is empty"] };
  }
  const lines = normalized.split("\n");
  const subject = lines[0];
  if (subject !== subject.trim() || /\s$/.test(subject)) {
    errors.push("subject has leading or trailing whitespace");
  }
  const trimmed = subject.trim();
  if (trimmed.length > SUBJECT_MAX_LENGTH) {
    errors.push(`subject is ${trimmed.length} characters; the maximum is ${SUBJECT_MAX_LENGTH}`);
  }
  if (!SUBJECT_RE.test(trimmed)) {
    errors.push(
      "subject must be `type(optional-scope)!: description` with type one of " +
        COMMIT_TYPES.join(", "),
    );
  }
  if (lines.length > 1 && lines[1] !== "") {
    errors.push("a body must be separated from the subject by a blank line");
  }
  return { ok: errors.length === 0, errors };
}

/**
 * @param {string[]} parents
 */
export function isMergeCommit(parents) {
  return Array.isArray(parents) && parents.filter((parent) => parent && parent.length > 0).length > 1;
}

/**
 * @param {{ hash?: string, parents?: string[], message: string }[]} commits
 * @returns {{ hash: string, subject: string, errors: string[] }[]}
 */
export function evaluateCommits(commits) {
  const failures = [];
  for (const commit of commits) {
    const parents = commit.parents ?? [];
    if (isMergeCommit(parents)) continue;
    const result = checkCommitMessage(commit.message);
    if (result.ok) continue;
    const subject = String(commit.message).replace(/\r\n/g, "\n").split("\n")[0] ?? "";
    failures.push({
      hash: commit.hash ?? "",
      subject,
      errors: result.errors,
    });
  }
  return failures;
}

/**
 * @param {{ hash: string, subject: string, errors: string[] }[]} failures
 */
export function formatCommitFailures(failures) {
  const blocks = failures.map((failure) => {
    const where = failure.hash ? `${failure.hash.slice(0, 12)} ${failure.subject}` : failure.subject;
    const lines = failure.errors.map((error) => `  - ${error}`);
    return [where, ...lines].join("\n");
  });
  return (
    `Conventional Commits check failed (${failures.length} commit${failures.length === 1 ? "" : "s"}).\n` +
    "Subject shape: type(optional-scope)!: description\n" +
    `Types: ${COMMIT_TYPES.join(", ")}\n\n` +
    blocks.join("\n\n")
  );
}

/**
 * Split `git log --format=%H%x1f%P%x1f%B%x1e` output into commits.
 * @param {string} raw
 * @returns {{ hash: string, parents: string[], message: string }[]}
 */
export function parseGitLog(raw) {
  return String(raw)
    .split("\x1e")
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record.length > 0)
    .map((record) => {
      const parts = record.split("\x1f");
      const hash = (parts[0] ?? "").trim();
      const parents = (parts[1] ?? "")
        .trim()
        .split(/\s+/)
        .filter((parent) => parent.length > 0);
      const message = parts.slice(2).join("\x1f").replace(/^\n/, "");
      return { hash, parents, message };
    });
}

/**
 * @param {string} sha
 * @param {string} label
 */
export function requireSha(sha, label) {
  const value = String(sha ?? "").trim().toLowerCase();
  if (!SHA_RE.test(value)) {
    throw new Error(`${label} must be a 40-character hexadecimal SHA (got ${JSON.stringify(sha)})`);
  }
  return value;
}

/**
 * @param {{ eventName?: string, baseSha?: string, prHeadSha?: string, beforeSha?: string, headSha?: string }} event
 * @returns {{ kind: "range", range: string } | { kind: "new-ref", head: string }}
 */
export function commitRangeForEvent(event) {
  const eventName = event.eventName;
  if (eventName === "pull_request") {
    const base = requireSha(event.baseSha, "pull request base SHA");
    const head = requireSha(event.prHeadSha, "pull request head SHA");
    return { kind: "range", range: `${base}..${head}` };
  }
  if (eventName === "push") {
    const head = requireSha(event.headSha, "push head SHA");
    const before = String(event.beforeSha ?? "").trim().toLowerCase();
    if (before.length === 0 || before === ZERO_SHA) {
      return { kind: "new-ref", head };
    }
    requireSha(before, "push before SHA");
    return { kind: "range", range: `${before}..${head}` };
  }
  throw new Error(`unsupported GitHub event ${JSON.stringify(eventName)}; expected pull_request or push`);
}

/**
 * @param {{ kind: "range", range: string } | { kind: "new-ref", head: string }} plan
 * @returns {string[]}
 */
export function gitLogArgs(plan) {
  const format = "%H%x1f%P%x1f%B%x1e";
  if (plan.kind === "new-ref") {
    return ["log", "-1", `--format=${format}`, plan.head];
  }
  return ["log", "--reverse", `--format=${format}`, plan.range];
}

/**
 * @param {string} raw
 * @returns {{ ok: true, checked: number } | { ok: false, message: string }}
 */
export function reportParsedLog(raw) {
  const commits = parseGitLog(raw);
  const failures = evaluateCommits(commits);
  if (failures.length > 0) {
    return { ok: false, message: formatCommitFailures(failures) };
  }
  return { ok: true, checked: commits.filter((commit) => !isMergeCommit(commit.parents)).length };
}

function readGitLog(plan) {
  return execFileSync("git", gitLogArgs(plan), {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function planFromGithubEnv(env) {
  return commitRangeForEvent({
    eventName: env.GITHUB_EVENT_NAME,
    baseSha: env.PR_BASE_SHA,
    prHeadSha: env.PR_HEAD_SHA,
    beforeSha: env.PUSH_BEFORE_SHA,
    headSha: env.PUSH_HEAD_SHA || env.GITHUB_SHA,
  });
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isMain()) {
  const arg = process.argv[2];
  let plan;
  try {
    if (arg === "--github") {
      plan = planFromGithubEnv(process.env);
    } else if (!arg || arg.startsWith("-")) {
      console.error("usage: node scripts/check-conventional-commits.mjs <git-range>");
      console.error("       node scripts/check-conventional-commits.mjs --github");
      process.exit(2);
    } else {
      plan = { kind: "range", range: arg };
    }
  } catch (err) {
    const why = err && typeof err === "object" && "message" in err ? err.message : String(err);
    console.error(why);
    process.exit(2);
  }

  if (plan.kind === "new-ref") {
    console.log(`New ref ${plan.head}: checking that commit only.`);
  }

  let raw;
  try {
    raw = readGitLog(plan);
  } catch (err) {
    const why = err && typeof err === "object" && "message" in err ? err.message : String(err);
    console.error(`failed to read commits: ${why}`);
    process.exit(1);
  }

  const report = reportParsedLog(raw);
  if (!report.ok) {
    console.error(report.message);
    process.exit(1);
  }
  const span = plan.kind === "range" ? plan.range : plan.head;
  console.log(`Conventional Commits check passed (${report.checked} commit${report.checked === 1 ? "" : "s"} in ${span}).`);
}
