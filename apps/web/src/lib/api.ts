export type ProfileFact = {
  id: string;
  key: string;
  value: string;
  category: string;
  confidence: number;
  source: string;
  updatedAt: string;
};

export type EpisodicEntry = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  source: string;
  importance: number;
  createdAt: string;
};

export type StatusData = {
  version: string;
  uptime: number;
  agentName: string;
  port: number;
  providers: { cloud: string[]; local: string[] };
  budget: { dailyLimitUsd: number; monthlyLimitUsd: number; fallbackToLocalOnExhaustion: boolean };
  memory: { profileFacts: number; categories: string[] };
};

export type ChatResponse = {
  response: string;
  sessionId: string;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type DiscordConfig = {
  enabled: boolean;
  clientId?: string;
  channelWhitelist: string[];
  userBlacklist: string[];
  adminUsers: string[];
  mentionOnly: boolean;
  respondInThreads: boolean;
  rateLimitPerUserPerMinute: number;
  systemPromptOverride?: string;
  maxMessageLength: number;
};

export type DaemonConfig = {
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
  systemPrompt?: string;
  agentName: string;
};

export type BudgetConfig = {
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  fallbackToLocalOnExhaustion: boolean;
};

export type FullConfig = {
  discord: DiscordConfig;
  daemon: DaemonConfig;
  budget: BudgetConfig;
};

export type CloudProviderConfig = {
  enabled: boolean;
  defaultModels: { fast?: string; capable?: string };
};

export type LocalProviderConfig = {
  enabled: boolean;
  baseUrl: string;
  models: { fast: string; capable: string };
};

export type HuggingFaceConfig = {
  enabled: boolean;
  inferenceApiModel?: string;
  tgiBaseUrl?: string;
  embeddingModel: string;
};

export type ProvidersConfig = {
  anthropic: CloudProviderConfig;
  openai: CloudProviderConfig;
  google: CloudProviderConfig;
  groq: CloudProviderConfig;
  mistral: CloudProviderConfig;
  deepseek: CloudProviderConfig;
  openrouter: CloudProviderConfig;
  ollama: LocalProviderConfig;
  lmstudio: LocalProviderConfig;
  vllm: LocalProviderConfig;
  huggingface: HuggingFaceConfig;
};

export type MemoryConfig = {
  decayHalfLifeDays: number;
  decayMinConfidence: number;
  consolidateAfterDays: number;
};

export type VaultStatus = Record<string, boolean>;

export const api = {
  chat: (message: string, sessionId: string) =>
    apiFetch<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message, sessionId }),
    }),

  getStatus: () => apiFetch<StatusData>("/api/status"),

  getProfile: () =>
    apiFetch<{ facts: ProfileFact[] }>("/api/memory/profile").then((r) => r.facts),

  deleteProfileFact: (key: string) =>
    apiFetch<{ ok: boolean }>(`/api/memory/profile/${encodeURIComponent(key)}`, {
      method: "DELETE",
    }),

  getEpisodic: (limit = 50) =>
    apiFetch<{ entries: EpisodicEntry[] }>(`/api/memory/episodic?limit=${limit}`).then(
      (r) => r.entries,
    ),

  getConfig: () => apiFetch<FullConfig>("/api/config"),

  patchDiscord: (patch: Partial<DiscordConfig>) =>
    apiFetch<{ ok: boolean; config: DiscordConfig }>("/api/config/discord", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  patchDaemon: (patch: Partial<DaemonConfig>) =>
    apiFetch<{ ok: boolean; config: DaemonConfig }>("/api/config/daemon", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  patchBudget: (patch: Partial<BudgetConfig>) =>
    apiFetch<{ ok: boolean; config: BudgetConfig }>("/api/config/budget", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  getPersonality: () =>
    apiFetch<{ content: string; path: string }>("/api/personality"),

  patchPersonality: (content: string) =>
    apiFetch<{ ok: boolean; content: string }>("/api/personality", {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),

  resetPersonality: () =>
    apiFetch<{ ok: boolean; content: string }>("/api/personality/reset", {
      method: "POST",
    }),

  getVaultStatus: () =>
    apiFetch<{ status: VaultStatus }>("/api/vault/status").then((r) => r.status),

  setVaultKey: (key: string, value: string) =>
    apiFetch<{ ok: boolean }>("/api/vault/set", {
      method: "POST",
      body: JSON.stringify({ key, value }),
    }),

  deleteVaultKey: (key: string) =>
    apiFetch<{ ok: boolean }>("/api/vault/key", {
      method: "DELETE",
      body: JSON.stringify({ key }),
    }),

  getProviders: () =>
    apiFetch<{ providers: ProvidersConfig }>("/api/config/providers").then((r) => r.providers),

  patchProviders: (patch: Partial<ProvidersConfig>) =>
    apiFetch<{ ok: boolean; providers: ProvidersConfig }>("/api/config/providers", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  getMemoryConfig: () =>
    apiFetch<{ memory: MemoryConfig }>("/api/config/memory").then((r) => r.memory),

  patchMemoryConfig: (patch: Partial<MemoryConfig>) =>
    apiFetch<{ ok: boolean; config: MemoryConfig }>("/api/config/memory", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};
