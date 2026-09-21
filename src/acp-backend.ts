import type { EffortLevel, PromptContentBlock } from "./acp";

export const ACP_PROVIDERS = ["grok", "codex", "claude"] as const;
// The legacy wire vocabulary above stays frozen for older receivers.
export const INTERNAL_PROVIDERS = [...ACP_PROVIDERS, "muse"] as const;
export type LegacyAcpProvider = (typeof ACP_PROVIDERS)[number];
export type AcpProvider = (typeof INTERNAL_PROVIDERS)[number];

export function isInternalProvider(value: unknown): value is AcpProvider {
  return isAcpProvider(value) || value === "muse";
}

export function supportsSessionDeletion(provider: AcpProvider): boolean {
  return provider === "codex" || provider === "claude";
}

export function supportsModeSwitching(provider: AcpProvider): boolean {
  return provider !== "muse";
}

export function usesPerCallContextOccupancy(provider: AcpProvider): boolean {
  return provider === "codex" || provider === "claude";
}

export function supportsClientMcpServers(provider: AcpProvider): boolean {
  return provider !== "muse";
}

export function isAcpProvider(value: unknown): value is LegacyAcpProvider {
  return value === "grok" || value === "codex" || value === "claude";
}

/** Providers whose conversations live in an adapter catalog, not ~/.grok. */
export function usesAdapterHistory(provider: AcpProvider): boolean {
  return provider === "codex" || provider === "claude" || provider === "muse";
}

export const isAdapterProvider = usesAdapterHistory;

export interface BackendSpawnOptions {
  cliPath: string;
  cwd: string;
  effort?: EffortLevel;
  env: NodeJS.ProcessEnv;
}

export interface BackendSpawnSpec {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  shell: boolean;
}

export interface BackendConfigState {
  modelId?: string;
  reasoningEffort?: string;
  modeId?: string;
}

export interface BackendUpdate {
  update?: any;
  meta?: any;
  sessionTitle?: string;
  contextWindow?: number;
  /** Direct occupancy reported by a backend, including an empty context. */
  contextUsed?: number;
  /**
   * Ordinary `usage_update.used` is billed per model call (includes output).
   * Compact's getContextUsage is the exception — the host only adopts this
   * when a compact just completed. Otherwise these are per-call observations
   * for occupancyFromAdapterTurn, not occupancy by themselves.
   */
  usageUpdateUsed?: number;
}

export interface BackendSessionListEntry {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string | number;
  createdAt?: string | number;
  turnCount?: number;
  modelId?: string;
  branch?: string;
}

export interface BackendSessionListResult {
  sessions: BackendSessionListEntry[];
  nextCursor?: string | null;
}

export interface BackendSteeringCapabilities {
  supported: boolean;
  acceptsContent: boolean;
}

export interface BackendSteeringOptions {
  grokVersion?: string;
  grokVersionVerified?: boolean;
}

export interface AcpBackend<Provider extends string = AcpProvider> {
  readonly provider: Provider;
  readonly processName: string;
  readonly usesClientPlanGate: boolean;
  spawn(options: BackendSpawnOptions): BackendSpawnSpec;
  normalizeSessionResponse(response: any): any;
  normalizePromptResult(result: any): any;
  normalizeUpdate(update: any, meta: any): BackendUpdate;
  normalizePermissionParams(params: any): any;
  setModel(sessionId: string, modelId: string, reasoningEffort?: string): { method: string; params: any };
  setReasoningEffort(sessionId: string, modelId: string | undefined, level: string): { method: string; params: any } | null;
  setMode(sessionId: string, modeId: string): { method: string; params: any };
  steeringCapabilities(initializeResult: any, options: BackendSteeringOptions): BackendSteeringCapabilities;
  interject(sessionId: string, text: string, content?: readonly PromptContentBlock[]): { method: string; params: any } | null;
  /**
   * Whether a steering RPC that RESOLVED actually delivered the text. Some
   * adapters report a steering failure in-band, as a successful response.
   */
  steerDelivered(result: any): boolean;
  configState(response: any, fallback: BackendConfigState): BackendConfigState;
  modelSetSucceeded(response: any): boolean;
  listSessions(
    request: (method: string, params: any) => Promise<any>,
    cwd: string,
    platform: NodeJS.Platform,
  ): Promise<BackendSessionListResult>;
  isCredentialError(error: unknown): boolean;
}
