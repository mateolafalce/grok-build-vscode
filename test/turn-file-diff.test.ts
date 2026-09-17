import { describe, it, expect } from "vitest";
import { gitDiffArgs, gitTurnDiffArgs, GIT_TURN_BASELINE_ARGS, parseGitBaseline } from "../src/git-status";
import { captureGitTurnBaseline, GIT_BASELINE_TIMEOUT_MS, GIT_DIFF_MAX_BYTES, readGitFileDiff, type GitIo } from "../src/git-run";
import { parseUnifiedDiff, patchRowsToDiffHunks } from "../media/file-panel.js";
import { parseWebviewMsg } from "../src/desktop/webview-msg-validate";
import { INBOUND_DISPOSITION, OUTBOUND_DISPOSITION, OUTBOUND_PROJECT_AUTH, REMOTE_REQUIRES_BOUND_SESSION,
  allowFromRemote, allowRemoteRepoTarget, mayDeliverRemoteHostMsg } from "../src/remote-policy";

const HEAD = "a".repeat(40);
const STASH = "b".repeat(40);

function fakeGit(replies: Array<{ stdout?: string; error?: unknown }>) {
  const calls: Array<{ args: string[]; opts: any }> = [];
  const io: GitIo = { execFile: ((_: string, args: string[], opts: any, cb: Function) => {
    calls.push({ args, opts });
    const reply = replies.shift() || {};
    queueMicrotask(() => cb(reply.error || null, reply.stdout || "", ""));
  }) as any };
  return { io, calls };
}

describe("turn baselines", () => {
  it("constructs a host-ref diff without changing the HEAD default or path operand", () => {
    expect(gitDiffArgs("dir/a b.ts")).toEqual(["diff", "HEAD", "--", "dir/a b.ts"]);
    expect(gitDiffArgs("-file.ts", STASH)).toEqual(["diff", STASH, "--", "-file.ts"]);
    expect(gitTurnDiffArgs("a[1].ts", STASH)).toEqual(["--literal-pathspecs", "diff", STASH, "--", "a[1].ts"]);
    expect(GIT_TURN_BASELINE_ARGS).toEqual(["stash", "create"]);
  });

  it.each([HEAD, "c".repeat(64)])("accepts complete Git object ids", (sha) => {
    expect(parseGitBaseline(sha + "\n")).toBe(sha);
  });
  it.each(["", "HEAD", "--output=oops", "abc123", HEAD + "\n" + STASH, "fatal: bad", "f".repeat(41)])("rejects %s", (out) => {
    expect(parseGitBaseline(out)).toBeUndefined();
  });

  it("captures stash without updating a ref and uses a bounded hidden process", async () => {
    const { io, calls } = fakeGit([{ stdout: HEAD }, { stdout: STASH + "\n" }]);
    expect(await captureGitTurnBaseline("/repo", { io })).toBe(STASH);
    expect(calls.map(c => c.args)).toEqual([
      ["-C", "/repo", "rev-parse", "--verify", "HEAD"], ["-C", "/repo", "stash", "create"],
    ]);
    for (const { opts } of calls) expect(opts).toMatchObject({
      timeout: GIT_BASELINE_TIMEOUT_MS, windowsHide: true, env: { GIT_OPTIONAL_LOCKS: "0" },
    });
  });
  it("uses the captured HEAD only for a successful empty stash", async () => {
    const { io } = fakeGit([{ stdout: HEAD }, {}]);
    expect(await captureGitTurnBaseline("/repo", { io })).toBe(HEAD);
  });
  it.each([
    new Error("index.lock exists"), Object.assign(new Error("timed out"), { killed: true }),
    Object.assign(new Error("spawn failed"), { code: "ENOENT" }),
  ])("never falls back to HEAD on a stash failure", async error => {
    const { io } = fakeGit([{ stdout: HEAD }, { stdout: STASH, error }]);
    expect(await captureGitTurnBaseline("/repo", { io })).toBeUndefined();
  });
  it("does not attempt stash in an unborn or non-git directory", async () => {
    const { io, calls } = fakeGit([{ error: new Error("no HEAD") }]);
    expect(await captureGitTurnBaseline("/repo", { io })).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
  it("does not turn malformed stash output into HEAD", async () => {
    const { io } = fakeGit([{ stdout: HEAD }, { stdout: "oops" }]);
    expect(await captureGitTurnBaseline("/repo", { io })).toBeUndefined();
  });
  it("passes only the chosen base to the existing capped diff reader", async () => {
    const { io, calls } = fakeGit([{ stdout: "patch" }]);
    expect(await readGitFileDiff("/repo", "a.ts", { io, baseline: STASH })).toMatchObject({ ok: true, patch: "patch" });
    expect(calls[0].args).toEqual(["-C", "/repo", "--literal-pathspecs", "diff", STASH, "--", "a.ts"]);
  });
  it("retains the patch cap and reports truncation", async () => {
    const { io, calls } = fakeGit([{ stdout: "+".repeat(GIT_DIFF_MAX_BYTES + 10) }]);
    const result = await readGitFileDiff("/repo", "a.ts", { io, baseline: STASH });
    expect(calls[0].opts.maxBuffer).toBe(GIT_DIFF_MAX_BYTES + 1024);
    expect(result.ok && result.truncated).toBe(true);
    expect(result.ok && result.patch.length).toBe(GIT_DIFF_MAX_BYTES);
  });
});

describe("parsed patch rows become the existing inline hunk shape", () => {
  it("preserves disjoint hunks, line numbers and text while excluding metadata", () => {
    const patch = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -10,2 +10,2 @@ fn\n-old\n+<new>\n context\n@@ -50 +60 @@\n-away\n+back\n\\ No newline at end of file\n";
    expect(patchRowsToDiffHunks(parseUnifiedDiff(patch))).toEqual([
      { site: { oldLine: 10, newLine: 10 }, result: { lines: [
        { type: "del", text: "old" }, { type: "add", text: "<new>" }, { type: "ctx", text: "context" },
      ] } },
      { site: { oldLine: 50, newLine: 60 }, result: { lines: [
        { type: "del", text: "away" }, { type: "add", text: "back" },
      ] } },
    ]);
  });
  it.each(["", "Binary files a/a and b/a differ\n", "old mode 100644\nnew mode 100755\n"])("does not invent text hunks", patch => {
    expect(patchRowsToDiffHunks(parseUnifiedDiff(patch))).toEqual([]);
  });
  it.each([
    ["@@ -0,0 +1,2 @@\n+one\n+two\n", { newLine: 1 }, "add"],
    ["@@ -35,2 +34,0 @@\n-one\n-two\n", { oldLine: 35 }, "del"],
  ])("supports pure additions and deletions", (patch, site, type) => {
    expect(patchRowsToDiffHunks(parseUnifiedDiff(patch))).toEqual([
      { site, result: { lines: [{ type, text: "one" }, { type, text: "two" }] } },
    ]);
  });
});

describe("turn diff remote policy", () => {
  const request = { type: "turnFileDiff" as const, turnId: "turn", requestId: "request", cwd: "/repo", path: "a.ts" };
  const same = (a: string, b: string) => a === b;
  it("validates the new desktop request type and requires identity and correlation", () => {
    expect(parseWebviewMsg(request)).toEqual(request);
    for (const key of ["turnId", "cwd", "path", "requestId"]) {
      expect(parseWebviewMsg({ ...request, [key]: undefined })).toBeNull();
      expect(parseWebviewMsg({ ...request, [key]: 12 })).toBeNull();
    }
  });
  it("allows read-only review at view tier without a bound session, but only in a known repo", () => {
    expect(INBOUND_DISPOSITION.turnFileDiff).toBe("view");
    expect(REMOTE_REQUIRES_BOUND_SESSION.turnFileDiff).toBe(false);
    expect(allowFromRemote("turnFileDiff", "view")).toBe(true);
    expect(allowRemoteRepoTarget(request, cwd => cwd === "/repo")).toBe(true);
    expect(allowRemoteRepoTarget(request, () => false)).toBe(false);
  });
  it("scopes identity to the session and rechecks the result cwd against the live catalog", () => {
    expect(OUTBOUND_DISPOSITION.turnDiffBaseline).toBe("mirror");
    expect(OUTBOUND_DISPOSITION.turnFileDiffResult).toBe("mirror");
    expect(OUTBOUND_PROJECT_AUTH.turnDiffBaseline).toBe("scope");
    expect(OUTBOUND_PROJECT_AUTH.turnFileDiffResult).toBe("message-cwd");
    const baseline = { type: "turnDiffBaseline" as const, turnId: "turn", cwd: "/repo" };
    expect(mayDeliverRemoteHostMsg(baseline, ["/repo"], "/repo", same)).toBe(true);
    expect(mayDeliverRemoteHostMsg(baseline, ["/repo"], "/other", same)).toBe(false);
    const result = { ...request, type: "turnFileDiffResult" as const, ok: true as const, patch: "", truncated: false };
    expect(mayDeliverRemoteHostMsg(result, ["/repo"], "/other", same)).toBe(true);
    expect(mayDeliverRemoteHostMsg(result, [], "/repo", same)).toBe(false);
  });
});
