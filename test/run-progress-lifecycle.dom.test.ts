// Real CLI capture through the real parser and renderer. In particular, revision
// 4 arrives twice and tokens_used stays zero across the entire lifecycle.
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GrokSidebar } from "../src/sidebar";
import { Session } from "../src/session";
import { sessionDirFor } from "../src/sessions";
import { parseRunProgressUpdate } from "../src/run-progress";
import { bootWebview, dispatch, type Harness } from "./webview-harness";

const frames = readFileSync(new URL("fixtures/workflow-lifecycle-live.jsonl", import.meta.url), "utf8")
  .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const windows: Harness["window"][] = [];
afterEach(() => { for (const window of windows.splice(0)) window.happyDOM.abort(); });
function replay() {
  let now = 100_000;
  const h = bootWebview({ beforeScripts: (window) => {
    (window as any).Date = class extends window.Date { static now() { return now; } };
  } });
  windows.push(h.window);
  return { ...h,
    advance: (ms: number) => { now += ms; },
    frame: (i: number) => dispatch(h.window, { type: "runProgress", update: parseRunProgressUpdate(frames[i]) }),
  };
}
const text = (h: Harness, selector: string) => h.doc.querySelector(selector)?.textContent ?? "";

const statelessRuns = JSON.parse(readFileSync(new URL("fixtures/workflow-stateless-phases.json", import.meta.url), "utf8")).runs;
const outputRuns = JSON.parse(readFileSync(new URL("fixtures/workflow-output.json", import.meta.url), "utf8")).runs;

describe("old host output compatibility", () => {
  it.each(outputRuns)("omits ambiguous legacy detail while settling $run_id", (run) => {
    const h = replay();
    const { workflowContent, ...legacy } = parseRunProgressUpdate(run)!;
    dispatch(h.window, { type: "historyReplay", active: true });
    dispatch(h.window, { type: "runProgress", update: legacy });
    dispatch(h.window, { type: "historyReplay", active: false });
    expect({ output: h.doc.querySelector(".workflow-output"), pin: h.doc.querySelector(".workflow-pin"),
      detail: text(h, ".run-progress-detail"), summary: text(h, ".run-progress-sub"),
      spend: text(h, ".workflow-spend"), open: (h.doc.querySelector("details") as HTMLDetailsElement).open,
    }).toEqual({ output: null, pin: null, detail: "", summary: run.objective,
      spend: `${run.agents_used} of ${run.agent_budget} agents used`, open: false });
  });
});

describe("completion without a terminal notification", () => {
  it.each(["live", "unobserved completion", "cold replay", "browser reload"])("reconciles both CLI state files for %s and settles closed reports", (mode) => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), "workflow-state-"));
    vi.stubEnv("GROK_HOME", dir);
    const h = replay();
    const sidebar = Object.create(GrokSidebar.prototype) as any;
    const session = new Session();
    session.provider = "grok";
    session.activeSessionId = "01a0c8e9-649c-7130-9515-915e62291d30";
    sidebar.focused = session;
    sidebar.pool = new Set([session]);
    let watching = mode !== "unobserved completion";
    sidebar.view = watching ? { webview: { postMessage: (message: unknown) => dispatch(h.window, message) } } : undefined;
    sidebar.localizeHistoryMessage = (message: unknown) => message;
    sidebar.mirrorToProjectsRail = () => {};
    sidebar.sendRemoteSession = () => {};
    sidebar.sessionCwd = () => dir;
    sidebar.isAuthorizedCwd = () => true;
    sidebar.remoteClients = { clientsForActiveValue: () => watching ? ["phone"] : [] };
    sidebar.sendRemoteClient = (_id: string, message: unknown) => dispatch(h.window, message);
    const sessionDir = sessionDirFor(dir, dir, session.activeSessionId)!;
    const writeStates = () => {
      for (const run of statelessRuns) {
        const folder = join(sessionDir, "workflows", run.run_id);
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "state.json"), JSON.stringify(run.state));
      }
    };
    try {
      if (mode === "cold replay") writeStates();
      dispatch(h.window, { type: "historyReplay", active: mode !== "live" });
      for (const run of statelessRuns) {
        // A deliberately stale notification, not a fabricated capture from the
        // affected machine. Disk state is the supplied CLI shape.
        const message = { type: "runProgress", update: parseRunProgressUpdate({ ...run.state,
          status: "active", sessionUpdate: "workflow_updated", run_id: run.run_id, name: run.name,
          elapsed_ms: run.state.elapsed_ms_floor, revision: 42 })! };
        if (mode === "browser reload") session.buffer.push(message as any);
        else sidebar.emit(session, message);
      }
      if (mode === "cold replay") {
        expect(session.buffer.filter(m => m.type === "runProgress" && m.update.done)).toHaveLength(2);
      }
      if (mode !== "cold replay") writeStates();
      if (mode === "live" || mode === "unobserved completion") {
        if (watching) (h.doc.querySelector(".workflow-pin-toggle") as any).click();
        sidebar.startWorkflowCompletionPolling();
        vi.advanceTimersByTime(2000);
        if (!watching) {
          expect(session.buffer.filter(m => m.type === "runProgress" && m.update.done)).toHaveLength(2);
          watching = true;
          sidebar.sendRemoteHistorySnapshot(session);
        }
      } else sidebar.sendRemoteHistorySnapshot(session);
      dispatch(h.window, { type: "historyReplay", active: false });
      expect(h.doc.querySelector(".workflow-pin, .workflow-marker, .run-progress-btn, [aria-current=step]")).toBeNull();
      expect([...h.doc.querySelectorAll(".workflow-report-toggle")].map(el => el.textContent))
        .toEqual(["demo-stages · done", "demo-stages-2 · done"]);
      expect([...h.doc.querySelectorAll("details")].map(el => el.open)).toEqual([false, false]);
      expect([...h.doc.querySelectorAll(".workflow-phase")].map(el => el.getAttribute("data-state")))
        .toEqual(["done", "done", "done", "done"]);
      expect([...h.doc.querySelectorAll(".run-progress-elapsed")].map(el => el.textContent)).toEqual(["4:09", "6:06"]);
      expect(h.doc.querySelector(".workflow-agent button, .workflow-agent-chevron")).toBeNull();
      const count = session.buffer.length;
      sidebar.refreshWorkflowCompletions(session);
      expect(session.buffer).toHaveLength(count);
    } finally {
      clearInterval(sidebar.workflowTimer);
      vi.useRealTimers();
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([false, true])("repairs an old host's complete/done:false snapshot (historical %s)", (historical) => {
    const h = replay();
    dispatch(h.window, { type: "historyReplay", active: historical });
    for (const run of statelessRuns) {
      const update = parseRunProgressUpdate({ ...run.state, sessionUpdate: "workflow_updated", run_id: run.run_id, name: run.name })!;
      dispatch(h.window, { type: "runProgress", update: { ...update, done: false } });
    }
    dispatch(h.window, { type: "historyReplay", active: false });
    expect(h.doc.querySelector(".workflow-pin, .workflow-marker, .run-progress-btn")).toBeNull();
    expect([...h.doc.querySelectorAll(".workflow-report")].map(el => (el as HTMLDetailsElement).open)).toEqual([false, false]);
    expect([...h.doc.querySelectorAll(".workflow-report-toggle")].map(el => el.textContent))
      .toEqual(["demo-stages · done", "demo-stages-2 · done"]);
  });
});

describe("the captured workflow lifecycle", () => {
  // Synthetic completion extends the captured start/pause/cancel vocabulary;
  // the capture itself never reached Report.
  it.each([false, true])("settles a complete rollup and rejects an older active revision (replay %s)", (historical) => {
    const h = replay();
    dispatch(h.window, { type: "historyReplay", active: historical });
    h.frame(0);
    const finish = { ...frames[6], revision: 8, status: "complete", current_phase: "Report",
      phases: frames[0].phases.map((p: { title: string }) => ({ ...p, state: "done" })),
      result_summary: "Partial", agents_used: 6, agent_budget: 16, elapsed_ms: 390000,
    };
    dispatch(h.window, { type: "runProgress", update: parseRunProgressUpdate(finish) });
    h.frame(2);
    dispatch(h.window, { type: "historyReplay", active: false });
    expect(h.doc.querySelector(".workflow-pin, .workflow-marker, [aria-current=step]")).toBeNull();
    expect(text(h, ".workflow-report-toggle")).toBe("deep-research · done");
    expect(text(h, ".workflow-card .run-progress-elapsed")).toBe("6:30");
    expect(text(h, ".workflow-card .workflow-output-body")).toBe("Partial");
    expect(text(h, ".workflow-card .workflow-spend")).toBe("6 of 16 agents used");
    expect(h.doc.querySelectorAll('.workflow-phase[data-state="done"]')).toHaveLength(4);
  });

  it("preserves observed fields, including the zero-token cancelled agent", () => {
    const updates = frames.map(parseRunProgressUpdate);
    expect(updates.every(Boolean)).toBe(true);
    expect(updates[0]!.agents).toBeUndefined();
    expect(updates[0]!.currentPhase).toBeUndefined();
    expect(updates[1]!.phases).toHaveLength(4);
    expect(updates[2]!.agents![0]).toMatchObject({ label: "research-planner", phase: "Plan", state: "running", tokensUsed: 0 });
    expect(updates[2]).toEqual(updates[3]);
    expect(updates[5]!.agents![0].state).toBe("cancelled");
    expect(updates.slice(4).map((u) => u!.elapsedMs)).toEqual([182, 182, 182]);
    expect(updates.every((u) => u!.displayName === "deep-research")).toBe(true);
  });
  it("never claims motion from duplicate frames, run pause or zero tokens", () => {
    const h = replay();
    for (let i = 0; i <= 4; i++) {
      h.advance(4000); h.frame(i);
      expect(h.doc.querySelector(".workflow-motion")).toBeNull();
      expect(text(h, ".workflow-agent-activity")).not.toMatch(/tokens moved|state changed/);
      expect(h.doc.querySelector(".workflow-card .blink-dots")).toBeNull();
    }
    expect(text(h, ".workflow-pin .run-progress-phase")).toBe("Plan · user paused");
    expect([...h.doc.querySelectorAll(".workflow-pin .run-progress-btn")].map((b) => b.textContent)).toEqual(["Resume", "Stop"]);
  });
  it("observes a cancelled state transition without portraying it as ongoing work", () => {
    const h = replay(); h.frame(4); h.frame(5);
    expect(text(h, ".workflow-agent-state")).toBe("Plan · cancelled · 0 tokens");
    expect(text(h, ".workflow-agent-activity")).toBe("state changed 0s ago \u00b7 no token activity observed");
    h.advance(12000); h.frame(5);
    expect(text(h, ".workflow-agent-activity")).toBe("state changed 12s ago \u00b7 no token activity observed");
    expect(h.doc.querySelector(".workflow-motion")).toBeNull();
    expect(text(h, ".workflow-receipt")).toBe("updated 0s ago");
  });
  it("ends the pin on stop while retaining the reported duration and roster in the transcript", () => {
    const h = replay(); frames.forEach((_, i) => h.frame(i));
    expect(h.doc.querySelector(".workflow-pin")).toBeNull();
    expect(text(h, ".workflow-card .run-progress-phase")).toBe("");
    expect(text(h, ".workflow-card .run-progress-elapsed")).toBe("0:00");
    expect(text(h, ".workflow-agent-state")).toBe("Plan · cancelled · 0 tokens");
    expect(h.doc.querySelector(".workflow-card")!.classList.contains("run-progress-cancelled")).toBe(true);
    expect(h.doc.querySelectorAll(".workflow-card .run-progress-btn")).toHaveLength(0);
  });
  it("keeps state-change evidence without denying an unchanged positive token total", () => {
    const h = replay();
    for (const i of [4, 5, 6]) {
      const update = parseRunProgressUpdate(frames[i])!;
      dispatch(h.window, { type: "runProgress", update: {
        ...update, agents: update.agents!.map((agent) => ({ ...agent, tokensUsed: 288307 })),
      } });
    }
    expect(text(h, ".workflow-card .workflow-agent-state")).toBe("Plan · cancelled · 288K tokens");
    expect(text(h, ".workflow-card .workflow-agent-activity")).toBe("state changed");
  });
});
