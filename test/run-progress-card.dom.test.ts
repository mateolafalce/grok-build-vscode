import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { parseRunProgressUpdate } from "../src/run-progress";
import { bootWebview, dispatch, click, type Harness } from "./webview-harness";

const windows: Harness["window"][] = [];
afterEach(() => { for (const window of windows.splice(0)) window.happyDOM.abort(); });
function boot(options = {}) {
  let now = 100_000;
  const h = bootWebview({ ...options, beforeScripts: (window: Harness["window"]) => {
    (window as any).Date = class extends window.Date { static now() { return now; } };
  } });
  windows.push(h.window);
  return { ...h, advance: (ms: number) => { now += ms; } };
}
const base = {
  sessionUpdate: "workflow_updated", run_id: "r1", name: "deep-research", status: "active",
  current_phase: "Research", elapsed_ms: 728_000, agents_used: 4, agent_budget: 128,
  phases: [{ title: "Plan", state: "done" }, { title: "Research", state: "active" }, { title: "Verify", state: "pending" }, { title: "Report", state: "pending" }],
  agents: [{ agent_id: "a", label: "Researcher A", phase: "Research", state: "running", tokens_used: 0 }],
};
function send(h: Harness, over: Record<string, unknown> = {}) {
  dispatch(h.window, { type: "runProgress", update: parseRunProgressUpdate({ ...base, ...over }) });
}
const card = (h: Harness) => h.doc.querySelector(".workflow-card")!;
const pin = (h: Harness) => h.doc.querySelector(".workflow-pin")!;
const summary = (h: Harness) => pin(h).querySelector(".run-progress-row")!.textContent;
const motion = (h: Harness) => pin(h).querySelector(".workflow-motion")!.textContent;
const agent = (h: Harness) => card(h).querySelector(".workflow-agent")!.textContent;

describe("workflow wire evidence on the card and pin", () => {
  it("carries name, phase ordinal, reported elapsed and motion without expanding", () => {
    const h = boot(); send(h);
    expect(summary(h)).toContain("deep-research");
    expect(summary(h)).toContain("Research, step 2 of 4");
    expect(summary(h)).toContain("12:08");
    expect(motion(h)).toBe("1 reported running · activity unverified");
    expect(pin(h).querySelector(".workflow-receipt")!.textContent).toBe("workflow update received 0s ago");
    expect(agent(h)).toContain("reported running");
    expect(agent(h)).toContain("no activity observed");
    expect(agent(h)).toContain("0 tokens");
    expect(card(h).textContent).toContain("4 of 128 agents used");
    expect(card(h).textContent).not.toContain("%");
    expect(card(h).querySelector(".blink-dots")).toBeNull();
  });
  it("ages token events independently of receipts and duplicate revisions", () => {
    const h = boot(); send(h, { revision: 1 });
    const moved = { revision: 2, agents: [{ ...base.agents[0], tokens_used: 12 }] };
    h.advance(1000); send(h, moved);
    expect(motion(h)).toContain("Researcher A: tokens moved 0s ago");
    h.advance(12000); send(h, moved);
    expect(motion(h)).toContain("tokens moved 12s ago");
    expect(agent(h)).toContain("tokens moved 12s ago");
    expect(pin(h).querySelector(".workflow-receipt")!.textContent).toContain("received 0s ago");
    expect(summary(h)).toContain("12:08");
  });
  it("ages receipt labels while the reported elapsed time and activity stay unchanged", async () => {
    const h = boot(); send(h);
    h.advance(4000);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(pin(h).querySelector(".workflow-receipt")!.textContent).toBe("workflow update received 4s ago");
    expect(summary(h)).toContain("12:08");
    expect(motion(h)).toBe("1 reported running · activity unverified");
  });
  it("keeps elapsed anchored across pause and resume until a new value arrives", () => {
    const h = boot(); send(h, { status: "user_paused" });
    h.advance(60000); send(h, { status: "user_paused" });
    expect(summary(h)).toContain("12:08");
    send(h, { status: "active" });
    expect(summary(h)).toContain("12:08");
    expect(pin(h).querySelector(".run-progress-btn")!.textContent).toBe("Pause");
    send(h, { elapsed_ms: 729000 });
    expect(summary(h)).toContain("12:09");
  });
  it("does not mistake arrival, phase change or a token reset for work", () => {
    const h = boot(); send(h);
    send(h, { current_phase: "Verify", agents: [{ ...base.agents[0], phase: "Verify" }] });
    expect(motion(h)).toContain("activity unverified");
    send(h, { agents: [{ ...base.agents[0], tokens_used: -1 }] });
    expect(motion(h)).toContain("activity unverified");
  });
  it("does not assign evidence across ambiguous labels or changed identities", () => {
    const h = boot();
    const anonymous = { label: "Researcher", state: "running", tokens_used: 0 };
    send(h, { agents: [anonymous, anonymous] });
    send(h, { agents: [{ ...anonymous, tokens_used: 15 }, anonymous] });
    expect(motion(h)).toContain("activity unverified");
    send(h, { agents: [{ agent_id: "new", ...anonymous, tokens_used: 20 }] });
    expect(motion(h)).toContain("activity unverified");
  });
  it.each(["failed", "permission_blocked", "waiting_for_permission", "awaiting_approval"])("surfaces %s before routine counts", (state) => {
    const h = boot(); send(h);
    send(h, { agents: [base.agents[0], { agent_id: "b", label: "Verifier", phase: "Verify", state, tokens_used: 0 }] });
    expect(motion(h)).toMatch(/^Verifier:/);
    expect(motion(h)).toContain(state.replaceAll("_", " "));
    expect(card(h).querySelector('[data-state="' + state + '"]')).not.toBeNull();
    expect(pin(h).classList.contains("is-expanded")).toBe(false);
  });
  it("does not roll back on older revisions or observe a false state change", () => {
    const h = boot(); send(h, { revision: 3 });
    send(h, { revision: 2, current_phase: "Plan", agents: [{ ...base.agents[0], state: "failed" }] });
    expect(summary(h)).toContain("Research");
    expect(motion(h)).toBe("1 reported running · activity unverified");
  });
});

describe("phase order is a reported snapshot", () => {
  it("changes the denominator and ordinal when the latest list grows and reorders", () => {
    const h = boot(); send(h);
    const phases = [{ title: "Intake", state: "done" }, ...base.phases];
    send(h, { phases });
    expect(summary(h)).toContain("Research, step 3 of 5");
    expect([...card(h).querySelectorAll(".workflow-phase")].map((p) => p.textContent)).toEqual(phases.map((p) => p.title));
  });
  it("uses ids through renames, never guesses a continuation by position", () => {
    const h = boot();
    send(h, { current_phase_id: "research", phases: base.phases.map((p, i) => ({ ...p, id: i === 1 ? "research" : String(i), title: i === 1 ? "Renamed phase" : p.title })) });
    expect(summary(h)).toContain("step 2 of 4");
    send(h, { phases: base.phases.map((p, i) => ({ ...p, title: i === 1 ? "Renamed phase" : p.title })) });
    expect(summary(h)).toContain("Research");
    expect(summary(h)).not.toContain("step");
  });
  it("does not invent ordinals for duplicate names or unmatched ids", () => {
    const h = boot(); send(h, { phases: [base.phases[1], base.phases[1]] });
    expect(summary(h)).not.toContain("step");
    send(h, { current_phase_id: "unknown" });
    expect(summary(h)).not.toContain("step");
  });
  it("accepts current_phase as an id and rejects duplicate phase ids", () => {
    const h = boot();
    send(h, { current_phase: "p2", phases: [{ id: "p1", title: "Plan", state: "done" }, { id: "p2", title: "Research", state: "active" }] });
    expect(summary(h)).toContain("Research, step 2 of 2");
    send(h, { current_phase_id: "p2", phases: [{ id: "p2", title: "Research" }, { id: "p2", title: "Research" }] });
    expect(summary(h)).not.toContain("step");
  });
  it("keeps long and many phase names complete and ordered", () => {
    const h = boot();
    const phases = Array.from({ length: 12 }, (_, i) => ({ title: `Extended research phase ${i} with a long title`, state: i === 7 ? "active" : "pending" }));
    send(h, { phases, current_phase: phases[7].title });
    expect(summary(h)).toContain("step 8 of 12");
    expect([...pin(h).querySelectorAll(".workflow-phase")].map((p) => p.textContent)).toEqual(phases.map((p) => p.title));
  });
});

describe("one shared pin with honest controls", () => {
  it.each([{}, { vscode: true }, { remote: true }])("is a transcript sibling on host %j", (options) => {
    const h = boot(options); send(h); send(h, { run_id: "r2", name: "deep-research-2" });
    expect(h.doc.querySelectorAll(".workflow-pin")).toHaveLength(1);
    expect(pin(h).previousElementSibling).toBe(h.doc.getElementById("messages"));
    expect(pin(h).parentElement).toBe(h.doc.getElementById("messages")!.parentElement);
    expect(pin(h).querySelectorAll(".workflow-pin-run")).toHaveLength(2);
    expect(pin(h).textContent).toContain("2 live workflows");
    expect(pin(h).textContent).toContain("deep-research-2");
    const toggle = pin(h).querySelector(".workflow-pin-toggle")!;
    click(h.window, toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(pin(h).classList.contains("is-expanded")).toBe(true);
  });
  it("passes each handle unchanged and switches Pause to Resume from reported state", () => {
    const h = boot(); send(h); send(h, { run_id: "r2", name: "deep-research-2", status: "user_paused" });
    const controls = pin(h).querySelector('[data-run-id="r2"]')!.querySelectorAll<HTMLButtonElement>(".run-progress-btn");
    expect(controls[0].textContent).toBe("Resume");
    controls[0].click(); controls[1].click();
    expect(h.posted.filter((m) => m.type === "workflowControl")).toEqual([
      { type: "workflowControl", action: "resume", displayName: "deep-research-2" },
      { type: "workflowControl", action: "stop", displayName: "deep-research-2" },
    ]);
    send(h, { status: "cancelled" });
    expect(pin(h).querySelectorAll(".workflow-pin-run")).toHaveLength(1);
    send(h, { run_id: "r2", name: "deep-research-2", status: "completed" });
    expect(h.doc.querySelector(".workflow-pin")).toBeNull();
  });
  it.each([undefined, "bad handle", " deep-research "])("makes handle %s visibly uncontrollable", (name) => {
    const h = boot(); send(h, { name });
    for (const surface of [card(h), pin(h)]) {
      const buttons = [...surface.querySelectorAll<HTMLButtonElement>(".run-progress-btn")];
      expect(buttons).toHaveLength(2);
      expect(buttons.every((b) => b.disabled)).toBe(true);
      expect(surface.textContent).toContain("Controls unavailable:");
      buttons.forEach((b) => b.click());
    }
    expect(h.posted.filter((m) => m.type === "workflowControl")).toEqual([]);
  });
  it("preserves focused control elements through duplicate frames", () => {
    const h = boot(); send(h);
    const button = pin(h).querySelector<HTMLButtonElement>(".run-progress-btn")!;
    button.focus(); send(h);
    expect(pin(h).querySelector(".run-progress-btn")).toBe(button);
    expect(h.doc.activeElement).toBe(button);
  });
  it("puts an actionable run before routine runs in the capped stack", () => {
    const h = boot(); send(h);
    send(h, { run_id: "r2", name: "Verifier run", agents: [{ ...base.agents[0], label: "Verifier", state: "permission_blocked" }] });
    expect(pin(h).querySelector(".workflow-pin-run")!.getAttribute("data-run-id")).toBe("r2");
    expect(motion(h)).toMatch(/^Verifier: permission blocked/);
  });
  it("gates fields on arrival and suppresses an old host's spend percentage", () => {
    const h = boot();
    dispatch(h.window, { type: "runProgress", update: { kind: "workflow", id: "old", title: "Old host", phase: "running", done: false, progress: 0.3 } });
    expect(card(h).querySelector<HTMLElement>(".workflow-phases")!.hidden).toBe(true);
    expect(card(h).querySelector<HTMLElement>(".workflow-roster")!.hidden).toBe(true);
    expect(card(h).querySelector<HTMLElement>(".run-progress-elapsed")!.hidden).toBe(true);
    expect(card(h).textContent).not.toContain("%");
    expect(motion(h)).toContain("activity unverified");
  });
  it("clears the pin on conversation reset", () => {
    const h = boot(); send(h);
    dispatch(h.window, { type: "clearMessages" });
    expect(h.doc.querySelector(".workflow-pin")).toBeNull();
  });
  it("does not claim replayed frames are live receipts or observed activity", () => {
    const h = boot();
    dispatch(h.window, { type: "historyReplay", active: true });
    send(h); send(h, { agents: [{ ...base.agents[0], tokens_used: 30 }] });
    dispatch(h.window, { type: "historyReplay", active: false });
    expect(h.doc.querySelector(".workflow-pin")).toBeNull();
    expect(card(h).textContent).toContain("historical workflow update");
    expect(card(h).textContent).not.toContain("tokens moved");
  });
  it("keeps Goal completion in its existing slot", () => {
    const h = boot();
    dispatch(h.window, { type: "runProgress", update: { kind: "goal", id: "goal", title: "Goal", phase: "running", progress: 0.25, done: false } });
    expect(h.doc.querySelector(".run-progress-phase")!.textContent).toBe("· running 25%");
    expect(h.doc.querySelector(".workflow-pin")).toBeNull();
  });
  it("keeps the pin in flow, capped and scrollable, with wrapping phase names", () => {
    const css = readFileSync(new URL("../media/chat.css", import.meta.url), "utf8");
    const pinRule = css.match(/\.workflow-pin \{([^}]+)\}/)![1];
    expect(pinRule).not.toMatch(/position:\s*(fixed|absolute)/);
    expect(pinRule).toContain("max-height: 34vh");
    expect(css).toMatch(/\.workflow-pin-runs\s*\{[^}]*overflow: auto/);
    expect(css).toMatch(/\.workflow-phases\s*\{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/\.workflow-phase\s*\{[^}]*overflow-wrap: anywhere/);
  });
});
