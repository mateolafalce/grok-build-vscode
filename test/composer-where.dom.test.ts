import { describe, expect, it } from "vitest";
import { bootWebview, click, dispatch } from "./webview-harness";

const initial = {
  type: "initialState" as const,
  effort: "",
  cwd: "/work/n8n-workflows",
  useCtrlEnter: false,
  extVersion: "9.9.9",
  showThinking: false,
  expandCommandOutputs: false,
  steerByDefault: false,
  soundNotifications: false,
  processingSound: false,
  readRepliesAloud: false,
  capabilities: {},
};

function labels(doc: Document): string[] {
  return [...doc.querySelectorAll("#composer-where .where-label")].map((el) => el.textContent || "");
}

const whereMain = {
  type: "composerWhere" as const,
  cwd: "/work/n8n-workflows",
  folder: "n8n-workflows",
  branch: "main",
  detached: false,
  branches: ["feat/composer-where", "main"],
  linkedWorktree: false,
  place: "local" as const,
  kind: "ok" as const,
};

describe("composer location row", () => {
  it("shows the open project's folder before git has answered", () => {
    const h = bootWebview({ ready: true, vscode: true });
    dispatch(h.window, initial);
    expect(h.doc.getElementById("composer-where")!.hidden).toBe(false);
    expect(labels(h.doc)).toEqual(["n8n-workflows"]);
    expect(h.doc.querySelector(".where-place")).toBeNull();
    expect(h.doc.querySelector(".where-worktree")).toBeNull();
  });

  it("opens a branch menu and checks out the branch that was picked", () => {
    const h = bootWebview({ ready: true, vscode: true });
    dispatch(h.window, initial);
    dispatch(h.window, whereMain);
    expect(labels(h.doc)).toEqual(["n8n-workflows", "main"]);
    click(h.window, h.doc.querySelector(".where-branch")!);
    const items = [...h.doc.querySelectorAll(".where-branch-item")].map((el) => el.textContent);
    expect(items).toEqual(["main", "feat/composer-where"]);
    click(h.window, h.doc.querySelectorAll(".where-branch-item")[1]);
    expect(h.posted).toContainEqual({
      type: "switchBranch",
      cwd: "/work/n8n-workflows",
      branch: "feat/composer-where",
    });
    expect(h.doc.querySelector(".where-branch-menu")).toBeNull();
  });

  it("does not check out the branch that is already current", () => {
    const h = bootWebview({ ready: true, vscode: true });
    dispatch(h.window, initial);
    dispatch(h.window, whereMain);
    click(h.window, h.doc.querySelector(".where-branch")!);
    click(h.window, h.doc.querySelector(".where-branch-item")!);
    expect(h.posted.some((m) => m.type === "switchBranch")).toBe(false);
  });

  it("follows the project that was opened, not the conversation", () => {
    const h = bootWebview({ ready: true, vscode: true });
    dispatch(h.window, initial);
    dispatch(h.window, whereMain);
    dispatch(h.window, { type: "sessionName", sessionId: "s1", name: "Here", cwd: "/work/n8n-workflows" });
    dispatch(h.window, {
      type: "repos",
      entries: [],
      selectedCwd: "/work/other-app",
      activeCwd: "/work/n8n-workflows",
      workspaceCwd: "/work/other-app",
    });
    expect(labels(h.doc)).toEqual(["other-app"]);
    expect(h.doc.querySelector(".where-branch")).toBeNull();
  });

  it("ignores a where frame for a project we have already left", () => {
    const h = bootWebview({ ready: true, vscode: true });
    dispatch(h.window, initial);
    dispatch(h.window, {
      type: "composerWhere",
      cwd: "/work/other",
      folder: "other",
      branch: "stale",
      detached: false,
      branches: ["stale"],
      linkedWorktree: false,
      place: "local",
      kind: "ok",
    });
    expect(labels(h.doc)).toEqual(["n8n-workflows"]);
  });

  it("omits the branch outside a repository", () => {
    const h = bootWebview({ ready: true, vscode: true });
    dispatch(h.window, { ...initial, cwd: "/home/notes" });
    dispatch(h.window, {
      type: "composerWhere",
      cwd: "/home/notes",
      folder: "notes",
      branch: null,
      detached: false,
      branches: [],
      linkedWorktree: false,
      place: "cloud",
      kind: "not-a-repo",
    });
    expect(labels(h.doc)).toEqual(["notes"]);
    expect(h.doc.querySelector(".where-branch")).toBeNull();
  });
});
