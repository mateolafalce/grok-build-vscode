import { describe, expect, it } from "vitest";
import { bootWebview, click, dispatch } from "./webview-harness";

const description = "Your content, including inter-session messages, may be used for product improvement.";
const reason = "Muse Code is unavailable on this host: Meta does not provide a native Windows CLI";
function catalog(h: ReturnType<typeof bootWebview>) {
  dispatch(h.window, { type: "session", sessionId: "s", provider: "grok", currentModelId: "grok",
    models: [{ provider: "grok", modelId: "grok", name: "Grok" },
      { provider: "muse", modelId: "muse-spark-1.3-contributor", name: "Muse Contributor", description }] });
}

describe("Muse host advertisement", () => {
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
  const env = api.defaultEnv({ isRemote: remote, providersKnown: true });
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
