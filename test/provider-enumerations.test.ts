import { describe, expect, it, vi } from "vitest";
import { INTERNAL_PROVIDERS, ACP_PROVIDERS, isInternalProvider, supportsCompaction, supportsHistoryDeletion, usesAdapterHistory } from "../src/acp-backend";
import { PROVIDER_ORDER, connectedProviderIds, providerDisplayName } from "../src/provider-ui";
import { parseWebviewMsg } from "../src/desktop/webview-msg-validate";
import { parseRelayFrame } from "../src/remote-frames";
import { PROVIDER_CONFIG_FILES, resolveProviderConfigFile } from "../src/provider-config";
import { GrokSidebar } from "../src/sidebar";
import { matchProviderSlashCommand, matchSlashCommand } from "../src/slash-filter";
import { sanitizeSessionStartProps } from "../src/telemetry";
// @ts-expect-error plain JS settings catalog
import { ROWS } from "../media/settings.js";
// @ts-expect-error plain JS shared by both renderers
import { PROVIDER_ACTIONS, providerSupports, clearHistoryConfirmation } from "../media/webview-helpers.js";

const messages = [
  ...["runGrokLogin", "logout", "recheckConnection", "retryProviderSession", "cancelDeviceLogin"].map(type => ({ type })),
  { type: "submitDeviceLoginCode", code: "code" },
  { type: "setModel", modelId: "model" },
  { type: "openProviderConfig" }, { type: "readProviderConfig" },
  { type: "restartProviderSession", sessionId: "session" },
  { type: "writeProviderConfig", text: "", expectedAbsPath: "/config", stamp: { mtimeMs: 0, size: 0 } },
];

describe("provider registration across surfaces", () => {
  it("keeps host catalogs, advertisement, backend routing and renderer actions set-equal", () => {
    expect(Object.keys(PROVIDER_ACTIONS)).toEqual([...INTERNAL_PROVIDERS]);
    expect(PROVIDER_ORDER).toEqual(INTERNAL_PROVIDERS);
    expect(ROWS.filter((row: any) => row.id === `provider${row.provider?.[0]?.toUpperCase()}${row.provider?.slice(1)}`)
      .map((row: any) => row.provider).sort()).toEqual([...INTERNAL_PROVIDERS].sort());
    const all = Object.fromEntries(INTERNAL_PROVIDERS.map(id => [id, true]));
    expect(connectedProviderIds(all, all)).toEqual(INTERNAL_PROVIDERS);
    const host: any = Object.create(GrokSidebar.prototype);
    host.providerConnectionState = all;
    host.codexSessionCache = new Map(); host.claudeSessionCache = new Map();
    host.locateProvider = vi.fn(() => "/cli");
    expect(Object.keys(host.locatedProviders())).toEqual([...INTERNAL_PROVIDERS]);
    expect(host.providerStateMessage().providers.map((p: any) => p.id).sort()).toEqual([...INTERNAL_PROVIDERS].sort());
    for (const id of INTERNAL_PROVIDERS) {
      expect(isInternalProvider(id)).toBe(true);
      expect(sanitizeSessionStartProps({ provider: id }).provider).toBe(id);
      expect(PROVIDER_ACTIONS[id].label).toBe(providerDisplayName(id));
      expect(providerSupports(id, "compact")).toBe(supportsCompaction(id));
      expect(providerSupports(id, "deleteHistory")).toBe(supportsHistoryDeletion(id));
      expect(!!host.createProviderBackend(id)).toBe(usesAdapterHistory(id));
      expect(!!host.adapterHistory(id)).toBe(usesAdapterHistory(id));
      if (usesAdapterHistory(id)) host.adapterHistory(id).cache.set("/repo", [{ id }]);
    }
    expect([...host.allAdapterCatalogs()].flat().map(entry => entry.id))
      .toEqual(INTERNAL_PROVIDERS.filter(usesAdapterHistory));
    expect(providerSupports("future-agent", "compact")).toBe(false);
    expect(providerSupports("future-agent", "deleteHistory")).toBe(false);
  });

  it.each(INTERNAL_PROVIDERS)("desktop accepts every provider-bearing operation for %s", provider => {
    for (const message of messages) {
      const payload = { ...message, provider };
      expect(parseWebviewMsg(payload), message.type).toEqual(payload);
    }
  });

  it("rejects unknown providers and keeps GitHub specific to device cancellation", () => {
    for (const provider of ["future-agent", "", null, 3, {}, "github"]) {
      for (const message of messages) {
        const payload = { ...message, provider };
        expect(parseWebviewMsg(payload), message.type).toEqual(
          provider === "github" && message.type === "cancelDeviceLogin" ? payload : null,
        );
      }
    }
  });

  it("keeps remote configuration deliberately narrower than agent identity", () => {
    expect(Object.keys(PROVIDER_CONFIG_FILES)).toEqual([...ACP_PROVIDERS]);
    const parse = (msg: unknown) => parseRelayFrame(JSON.stringify({ t: "msg", clientId: "client", msg }));
    for (const provider of INTERNAL_PROVIDERS) {
      expect(parse({ type: "restartProviderSession", provider, sessionId: "session" })).not.toBeNull();
      for (const message of messages.filter(m => ["readProviderConfig", "writeProviderConfig"].includes(m.type))) {
        expect(!!parse({ ...message, provider })).toBe(resolveProviderConfigFile(provider).ok);
      }
    }
    expect(resolveProviderConfigFile("muse").ok).toBe(false);
  });

  it.each(INTERNAL_PROVIDERS)("only interprets compact for capable providers: %s", provider => {
    for (const names of [[], ["compact"]]) {
      expect(matchProviderSlashCommand(provider, "/compact", names)).toBe(supportsCompaction(provider) ? "compact" : null);
    }
    expect(matchSlashCommand("/compact", [])).toBe("compact");
  });

  it("names only deletable providers in the shared confirmation", () => {
    const copy = clearHistoryConfirmation("/repo");
    for (const provider of INTERNAL_PROVIDERS) {
      expect(copy.includes(providerDisplayName(provider))).toBe(supportsHistoryDeletion(provider));
    }
    expect(copy).toContain("Open conversations are kept");
  });
});
