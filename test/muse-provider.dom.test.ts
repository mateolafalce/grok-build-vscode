import { describe, expect, it } from "vitest";
import { bootWebview, click, dispatch } from "./webview-harness";
import { INTERNAL_PROVIDERS, supportsCompaction } from "../src/acp-backend";

const description = "Your content, including inter-session messages, may be used for product improvement.";
const reason = "Muse Code is unavailable on this host: Meta does not provide a native Windows CLI";

it("retains every advertised provider's identity in the model picker", () => {
  const h = bootWebview();
  dispatch(h.window, { type: "providerState", providers: INTERNAL_PROVIDERS.map(id => ({ id, connected: true })) });
  dispatch(h.window, { type: "session", sessionId: "s", provider: "grok", models: INTERNAL_PROVIDERS.map(provider => ({ provider, modelId: provider, name: provider })) });
  click(h.window, h.doc.getElementById("gear-btn"));
  expect(h.doc.querySelectorAll(".model-picker-row")).toHaveLength(INTERNAL_PROVIDERS.length);
  for (const provider of INTERNAL_PROVIDERS) {
    expect(h.doc.querySelector(`.model-picker-row .provider-${provider}`)).not.toBeNull();
  }
});

it.each(INTERNAL_PROVIDERS)("offers compaction only when implemented for %s", provider => {
  const h = bootWebview();
  dispatch(h.window, { type: "providerState", providers: INTERNAL_PROVIDERS.map(id => ({ id, connected: true })) });
  dispatch(h.window, { type: "session", sessionId: "s", provider, models: [] });
  dispatch(h.window, { type: "contextUsage", used: 10000, window: 100000 });
  click(h.window, h.doc.getElementById("donut"));
  const button = h.doc.querySelector(".context-compact");
  expect(!!button).toBe(supportsCompaction(provider));
  if (button) click(h.window, button);
  expect(h.posted.some(m => m.type === "send" && m.text === "/compact")).toBe(supportsCompaction(provider));
});
function catalog(h: ReturnType<typeof bootWebview>) {
  dispatch(h.window, { type: "session", sessionId: "s", provider: "grok", currentModelId: "grok",
    models: [{ provider: "grok", modelId: "grok", name: "Grok" },
      { provider: "muse", modelId: "muse-spark-1.3-contributor", name: "Muse Contributor", description }] });
}

describe("Muse host advertisement", () => {
  it.each(["connectProvider", "connectRemote"])("gates %s on advertisement even with remote sign-in capability", act => {
    const h = bootWebview({ remote: true });
    dispatch(h.window, { type: "initialState", capabilities: { remoteAgentSignIn: true } });
    const button = h.doc.createElement("button");
    button.className = "onb-action";
    button.dataset.act = act;
    button.dataset.provider = "muse";
    h.doc.getElementById("welcome-onboarding")!.appendChild(button);
    h.posted.length = 0;
    click(h.window, button);
    expect(h.posted).toEqual([]);
    dispatch(h.window, { type: "providerState", providers: [{ id: "muse", connected: false }] });
    click(h.window, button);
    expect(h.posted).toContainEqual({ type: "runGrokLogin", provider: "muse" });
    dispatch(h.window, { type: "providerState", providers: [{ id: "grok", connected: true }] });
    h.posted.length = 0;
    click(h.window, button);
    expect(h.posted).toEqual([]);
  });

  it.each([false, true])("sends no Muse message without host advertisement (remote=%s)", remote => {
    const h = bootWebview({ remote });
    dispatch(h.window, { type: "initialState", capabilities: {} });
    dispatch(h.window, { type: "providerState", providers: [{ id: "grok", connected: true }] });
    catalog(h);
    click(h.window, h.doc.getElementById("gear-btn"));
    expect(h.doc.getElementById("gear-popover")?.textContent).not.toContain("Muse");
    // A stale injected control exercises the send guard as well as visibility.
    const button = h.doc.createElement("button"); button.className = "onb-action";
    button.dataset.act = "recheckProvider"; button.dataset.provider = "muse";
    h.doc.getElementById("welcome-onboarding")!.appendChild(button);
    click(h.window, button);
    expect(h.posted.some(m => JSON.stringify(m).includes('"muse"'))).toBe(false);
    dispatch(h.window, { type: "providerState", providers: [{ id: "muse", connected: true }] });
    click(h.window, button);
    expect(h.posted.some(m => m.type === "recheckConnection" && m.provider === "muse")).toBe(true);
    h.posted.length = 0;
    dispatch(h.window, { type: "providerState", providers: [{ id: "grok", connected: true }] });
    click(h.window, button);
    expect(h.posted.some(m => m.provider === "muse")).toBe(false);
  });

  it.each([false, true])("offers the host's Muse catalog and verbatim description (remote=%s)", remote => {
    const h = bootWebview({ remote });
    dispatch(h.window, { type: "providerState", providers: [{ id: "grok", connected: true }, { id: "muse", connected: true }] });
    catalog(h);
    click(h.window, h.doc.getElementById("gear-btn"));
    expect(h.doc.getElementById("gear-popover")?.textContent).toContain(description);
    expect(h.doc.querySelectorAll(".model-picker-row")).toHaveLength(2);
  });

  it("does not offer models when the execution host reports Windows", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "providerState", providers: [{ id: "muse", connected: false, unavailableReason: reason }] });
    catalog(h);
    click(h.window, h.doc.getElementById("gear-btn"));
    expect(h.doc.getElementById("gear-popover")?.textContent).not.toContain("Muse Contributor");
  });
});


it.each([false, true])("shows only the advertised disabled host row in Settings (remote=%s)", remote => {
  const h = bootWebview({ remote });
  const api = (h.window as any).GrokSettings;
  const root = h.doc.createElement("div"); h.doc.body.appendChild(root);
  const posted: any[] = [];
  const env = api.defaultEnv({ isRemote: remote, providersKnown: true, hostCaps: { remoteAgentSignIn: true } });
  const surface = api.mount(root, { standalone: true, category: "providers", env,
    snapshot: api.defaultSnapshot({ providers: [{ id: "grok", connected: true }] }), post: (m: any) => posted.push(m) });
  expect(root.textContent).not.toContain("Muse Code");
  surface.update(api.defaultSnapshot({ providers: [{ id: "muse", connected: false, unavailableReason: reason }] }), env);
  expect(root.textContent).toContain(reason);
  const row = root.querySelector('[data-id="providerMuse"]') || [...root.querySelectorAll('.settings-row')].find(el => el.textContent?.includes("Muse Code"));
  expect(row).toBeTruthy();
  expect([...row!.querySelectorAll('button')].every(button => button.disabled)).toBe(true);
  for (const button of row!.querySelectorAll('button')) click(h.window, button);
  expect(posted.some(m => m.provider === "muse")).toBe(false);
  surface.update(api.defaultSnapshot({ providers: [{ id: "muse", connected: false }] }), env);
  expect(root.textContent).not.toContain(reason);
  expect(root.textContent).toContain("Muse Code");
  expect(root.querySelector<HTMLButtonElement>('[data-provider="muse"].settings-provider-recheck')?.disabled).toBe(false);
});
