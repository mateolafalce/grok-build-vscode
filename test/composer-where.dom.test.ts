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

describe("composer location row", () => {
  it("shows the folder from the cwd before git has answered", () => {
    const h = bootWebview({ ready: true, vscode: true });
    dispatch(h.window, initial);
    expect(h.doc.getElementById("composer-where")!.hidden).toBe(false);
    expect(labels(h.doc)).toEqual(["Local", "n8n-workflows"]);
  });

  it("paints branch and an unchecked worktree, and checking it starts one", () => {
    const h = bootWebview({ ready: true, vscode: true });
    dispatch(h.window, initial);
    dispatch(h.window, { type: "appPurpose", value: "coding" });
    dispatch(h.window, {
      type: "composerWhere",
      cwd: "/work/n8n-workflows",
      folder: "n8n-workflows",
      branch: "chore/sync-workflows-2026-04",
      detached: false,
      linkedWorktree: false,
      place: "local",
      kind: "ok",
    });
    expect(labels(h.doc)).toEqual(["Local", "n8n-workflows", "chore/sync-workflows-2026-04", "worktree"]);
    const box = h.doc.querySelector(".where-worktree") as HTMLElement;
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect(box.title).toContain("new worktree");
    click(h.window, box);
    expect(h.posted.some((m) => m.type === "newWorktreeSession")).toBe(true);
  });

  it("checks the box on a linked worktree and does not remove it on click", () => {
    const h = bootWebview({ ready: true, vscode: true });
    dispatch(h.window, initial);
    dispatch(h.window, { type: "appPurpose", value: "coding" });
    dispatch(h.window, {
      type: "composerWhere",
      cwd: "/work/wt",
      folder: "wt",
      branch: "feat/composer-where",
      detached: false,
      linkedWorktree: true,
      worktreeLabel: "composer-where",
      place: "local",
      kind: "ok",
    });
    dispatch(h.window, { type: "sessionName", sessionId: "s1", name: "Where", cwd: "/work/wt" });
    const box = h.doc.querySelector(".where-worktree") as HTMLElement;
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(box.title).toBe("Worktree: composer-where");
    click(h.window, box);
    expect(h.posted.some((m) => m.type === "newWorktreeSession" || m.type === "removeWorktree")).toBe(false);
    expect(labels(h.doc)).toContain("feat/composer-where");
  });

  it("omits branch and worktree outside a repository", () => {
    const h = bootWebview({ ready: true, vscode: true });
    dispatch(h.window, { ...initial, cwd: "/home/notes" });
    dispatch(h.window, {
      type: "composerWhere",
      cwd: "/home/notes",
      folder: "notes",
      branch: null,
      detached: false,
      linkedWorktree: false,
      place: "cloud",
      kind: "not-a-repo",
    });
    expect(labels(h.doc)).toEqual(["Cloud", "notes"]);
  });

  it("ignores a where frame for a checkout we have already left", () => {
    const h = bootWebview({ ready: true, vscode: true });
    dispatch(h.window, initial);
    dispatch(h.window, { type: "sessionName", sessionId: "s1", name: "Here", cwd: "/work/n8n-workflows" });
    dispatch(h.window, {
      type: "composerWhere",
      cwd: "/work/other",
      folder: "other",
      branch: "stale",
      detached: false,
      linkedWorktree: false,
      place: "local",
      kind: "ok",
    });
    expect(labels(h.doc)).toEqual(["Local", "n8n-workflows"]);
  });

  it("does not offer a new worktree from the remote client", () => {
    const h = bootWebview({ ready: true, remote: true });
    dispatch(h.window, initial);
    dispatch(h.window, { type: "appPurpose", value: "coding" });
    dispatch(h.window, {
      type: "composerWhere",
      cwd: "/work/n8n-workflows",
      folder: "n8n-workflows",
      branch: "main",
      detached: false,
      linkedWorktree: false,
      place: "local",
      kind: "ok",
    });
    expect(h.doc.querySelector(".where-worktree")).toBeNull();
    expect(h.posted.some((m) => m.type === "newWorktreeSession")).toBe(false);
  });
});
