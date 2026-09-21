import type { EffortLevel, PromptContentBlock } from "./acp";

export const ACP_PROVIDERS = ["grok", "codex", "claude"] as const;
// The legacy wire vocabulary above stays frozen for older receivers.
export const INTERNAL_PROVIDERS = [...ACP_PROVIDERS, "muse"] as const;
export type LegacyAcpProvider = (typeof ACP_PROVIDERS)[number];
export type AcpProvider = (typeof INTERNAL_PROVIDERS)[number];

export function isInternalProvider(value: unknown): value is AcpProvider {
  return typeof value === "string" && (INTERNAL_PROVIDERS as readonly string[]).includes(value);
}

// Exhaustive: each new provider must explicitly opt into implemented actions.
const PROVIDER_ACTIONS: Record<AcpProvider, {
  deleteHistory: boolean;
  compact: boolean;
  adapterHistory: boolean;
  modeSwitching: boolean;
  perCallContext: boolean;
  clientMcp: boolean;
}> = {
  grok: { deleteHistory: true, compact: true, adapterHistory: false, modeSwitching: true, perCallContext: false, clientMcp: true },
  codex: { deleteHistory: true, compact: true, adapterHistory: true, modeSwitching: true, perCallContext: true, clientMcp: true },
  claude: { deleteHistory: true, compact: true, adapterHistory: true, modeSwitching: true, perCallContext: true, clientMcp: true },
  muse: { deleteHistory: false, compact: false, adapterHistory: true, modeSwitching: false, perCallContext: false, clientMcp: false },
};

export function supportsHistoryDeletion(provider: AcpProvider): boolean {
  return PROVIDER_ACTIONS[provider].deleteHistory;
}

export function supportsCompaction(provider: AcpProvider): boolean {
  return PROVIDER_ACTIONS[provider].compact;
}

export function supportsSessionDeletion(provider: AcpProvider): boolean {
  return usesAdapterHistory(provider) && supportsHistoryDeletion(provider);
}

export function supportsModeSwitching(provider: AcpProvider): boolean {
  return PROVIDER_ACTIONS[provider].modeSwitching;
}

export function usesPerCallContextOccupancy(provider: AcpProvider): boolean {
  return PROVIDER_ACTIONS[provider].perCallContext;
}

export function supportsClientMcpServers(provider: AcpProvider): boolean {
  return PROVIDER_ACTIONS[provider].clientMcp;
}

export function isAcpProvider(value: unknown): value is LegacyAcpProvider {
  return typeof value === "string" && (ACP_PROVIDERS as readonly string[]).includes(value);
}

/** Providers whose conversations live in an adapter catalog, not ~/.grok. */
export function usesAdapterHistory(provider: AcpProvider): boolean {
  return PROVIDER_ACTIONS[provider].adapterHistory;
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
