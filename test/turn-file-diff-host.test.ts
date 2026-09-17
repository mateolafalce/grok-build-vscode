import { afterEach, describe, expect, it, vi } from "vitest";
import { GrokSidebar } from "../src/sidebar";
import { Session, beginTurn } from "../src/session";
import * as git from "../src/git-run";
import { emptyGitStatus } from "../src/git-status";

const SHA = "b".repeat(40);
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const sidebar = Object.create(GrokSidebar.prototype) as any;
  const session = new Session();
  session.cwd = "/repo";
  sidebar.focused = session;
  sidebar.host = { workspaceRoot: () => "/repo", appendLine: vi.fn() };
  sidebar.turnDiffBaselines = new Map();
  sidebar.pendingTurnDiffCaptures = new WeakSet();
  sidebar.gitRunGate = new git.GitRunGate();
  sidebar.mirrorToProjectsRail = vi.fn();
  sidebar.sendRemoteSession = vi.fn();
  sidebar.post = vi.fn();
  sidebar.sendRemoteRequester = vi.fn();
  sidebar.captureRemoteRequester = () => ({ clientId: "phone" });
  sidebar.remoteClients = { active: () => undefined, cwd: () => "/repo" };
  sidebar.remoteTargetableCwd = (cwd: string) => cwd === "/repo";
  return { sidebar, session };
}
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe("host-owned turn baselines", () => {
  it.each(["grok", "codex", "claude"] as const)("captures without waiting for %s, behind the same git gate", async provider => {
    let resolve!: (sha: string) => void;
    const capture = vi.spyOn(git, "captureGitTurnBaseline").mockImplementation(() => new Promise(r => { resolve = r; }));
    const { sidebar, session } = fixture();
    session.provider = provider;
    const turn = beginTurn(session);
    expect(sidebar.startTurnDiffBaseline(session, turn)).toBeUndefined();
    expect(capture).toHaveBeenCalledWith("/repo");
    expect(sidebar.gitRunGate.isBusy("/repo")).toBe(true);
    const identity = session.buffer.at(-1) as any;
    expect(identity).toMatchObject({ type: "turnDiffBaseline", cwd: "/repo" });
    expect(identity).not.toHaveProperty("sha");
    expect(sidebar.turnDiffBaselines.get(identity.turnId).sha).toBeUndefined();
    resolve(SHA);
    await settle();
    expect(sidebar.turnDiffBaselines.get(identity.turnId).sha).toBe(SHA);
    expect(sidebar.gitRunGate.isBusy("/repo")).toBe(false);
  });

  it("skips a busy repository instead of queueing a later baseline", () => {
    const capture = vi.spyOn(git, "captureGitTurnBaseline");
    const { sidebar, session } = fixture();
    sidebar.gitRunGate.tryAcquire("/repo");
    sidebar.startTurnDiffBaseline(session, beginTurn(session));
    expect(capture).not.toHaveBeenCalled();
    expect(sidebar.gitRunGate.isBusy("/repo")).toBe(true);
  });

  it.each(["toolCall", "toolCallUpdate", "permissionRequest", "new-turn", "session-reset", "turn-end"])("discards a late capture after %s", async event => {
    let resolve!: (sha: string) => void;
    vi.spyOn(git, "captureGitTurnBaseline").mockImplementation(() => new Promise(r => { resolve = r; }));
    const { sidebar, session } = fixture();
    sidebar.startTurnDiffBaseline(session, beginTurn(session));
    const identity = session.buffer.at(-1) as any;
    if (event === "new-turn") beginTurn(session);
    else if (event === "session-reset") session.gen++;
    else if (event === "turn-end") session.turnToken = undefined;
    else sidebar.emit(session, { type: event });
    resolve(SHA);
    await settle();
    expect(sidebar.turnDiffBaselines.get(identity.turnId).sha).toBeUndefined();
    expect(sidebar.gitRunGate.isBusy("/repo")).toBe(false);
  });

  it("bounds memory and never resurrects an evicted pending turn", async () => {
    let resolve!: (sha: string) => void;
    vi.spyOn(git, "captureGitTurnBaseline").mockImplementation(() => new Promise(r => { resolve = r; }));
    const { sidebar, session } = fixture();
    sidebar.startTurnDiffBaseline(session, beginTurn(session));
    const oldest = (session.buffer.at(-1) as any).turnId;
    for (let i = 0; i < 100; i++) {
      const another = new Session();
      another.cwd = "/repo";
      sidebar.startTurnDiffBaseline(another, beginTurn(another));
    }
    expect(sidebar.turnDiffBaselines.size).toBe(100);
    resolve(SHA);
    await settle();
    expect(sidebar.turnDiffBaselines.has(oldest)).toBe(false);
  });

  it("releases the git gate after an asynchronous capture failure", async () => {
    vi.spyOn(git, "captureGitTurnBaseline").mockRejectedValue(new Error("failed"));
    const { sidebar, session } = fixture();
    sidebar.startTurnDiffBaseline(session, beginTurn(session));
    await settle();
    expect(sidebar.gitRunGate.isBusy("/repo")).toBe(false);
    expect([...sidebar.turnDiffBaselines.values()][0].sha).toBeUndefined();
  });
});

describe("turn diff request fences", () => {
  function requestFixture() {
    const { sidebar, session } = fixture();
    sidebar.turnDiffBaselines.set("turn", { root: "/repo", sha: SHA });
    const status = vi.spyOn(git, "readGitStatus").mockResolvedValue({ ok: true, snapshot: {
      ...emptyGitStatus(), files: [{ path: "a.ts", status: "M", added: 2, deleted: 2 }],
    } });
    const diff = vi.spyOn(git, "readGitFileDiff").mockResolvedValue({ ok: true, patch: "patch", truncated: false, untracked: false });
    const request = { type: "turnFileDiff", requestId: "request", turnId: "turn", cwd: "/repo", path: "a.ts" };
    return { sidebar, session, status, diff, request };
  }
  it.each(["local", "remote"])("serves %s using the host SHA even if a client smuggles a ref field", async origin => {
    const { sidebar, diff, request } = requestFixture();
    await sidebar.onMessage({ ...request, baseline: "--output=evil", ref: "HEAD" }, origin, origin === "remote" ? "phone" : undefined);
    expect(diff).toHaveBeenCalledWith("/repo", "a.ts", { baseline: SHA, untracked: false });
    const reply = origin === "local" ? sidebar.post.mock.calls[0][0] : sidebar.sendRemoteRequester.mock.calls[0][1];
    expect(reply).toMatchObject({ ...request, type: "turnFileDiffResult", ok: true, patch: "patch" });
    expect(reply).not.toHaveProperty("baseline");
    if (origin === "remote") expect(sidebar.post).not.toHaveBeenCalled();
  });
  it.each([
    { cwd: "/other" }, { turnId: SHA }, { turnId: "expired" }, { path: "../secret" }, { path: "unchanged.ts" },
  ])("refuses a request outside its root, turn or current changed-path fence: %j", async over => {
    const { sidebar, diff, request } = requestFixture();
    await sidebar.onMessage({ ...request, ...over }, "local");
    expect(diff).not.toHaveBeenCalled();
    expect(sidebar.post.mock.calls[0][0].ok).toBe(false);
  });
  it("does not allow a turn from another repository", async () => {
    const { sidebar, diff, request } = requestFixture();
    sidebar.turnDiffBaselines.set("turn", { root: "/other", sha: SHA });
    await sidebar.onMessage(request, "local");
    expect(diff).not.toHaveBeenCalled();
  });
  it("answers an unfinished capture immediately without running git", async () => {
    const { sidebar, diff, status, request } = requestFixture();
    sidebar.turnDiffBaselines.set("turn", { root: "/repo" });
    await sidebar.onMessage(request, "local");
    expect(status).not.toHaveBeenCalled();
    expect(diff).not.toHaveBeenCalled();
    expect(sidebar.post.mock.calls[0][0].ok).toBe(false);
  });
  it("keeps the whole-file no-index path for currently untracked files", async () => {
    const { sidebar, diff, status, request } = requestFixture();
    status.mockResolvedValue({ ok: true, snapshot: { ...emptyGitStatus(), files: [{ path: "a.ts", status: "?", added: null, deleted: null }] } });
    await sidebar.onMessage(request, "local");
    expect(diff).toHaveBeenCalledWith("/repo", "a.ts", { baseline: SHA, untracked: true });
  });
});
