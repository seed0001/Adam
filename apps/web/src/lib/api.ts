export type SkillInput = { name: string; type: string; description: string; required: boolean; example?: string };
export type SkillOutput = { name: string; type: string; description: string };
export type SkillSpec = {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  status: "draft" | "approved" | "latent" | "active" | "deprecated";
  triggers: string[];
  inputs: SkillInput[];
  outputs: SkillOutput[];
  allowedTools: string[];
  steps: string[];
  artifacts: string[];
  successCriteria: string[];
  constraints: string[];
  template: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  activatedAt?: string;
};

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
  activeModels: { fast: string | null; capable: string | null };
  budget: { dailyLimitUsd: number; monthlyLimitUsd: number; fallbackToLocalOnExhaustion: boolean };
  memory: { profileFacts: number; categories: string[] };
};

export type ChatResponse = {
  response: string;
  sessionId: string;
  /** Base64-encoded MP3 when voice is enabled and a default voice profile exists */
  audioBase64?: string;
  /** Base64-encoded PNG/JPEG when generate_chat_background was used */
  backgroundBase64?: string;
};

export type Patch = {
  id: string;
  source: string;
  filePath: string;
  diff: string;
  rationale: string;
  status: "proposed" | "pending" | "applied" | "rejected" | "failed";
  createdAt: string;
};

export type TraitScore = {
  trait: string;
  score: number;
  lastUpdated: string;
};

export type FeedbackSignal = {
  id: string;
  type: "positive" | "negative" | "neutral";
  category: string;
  observation: string;
  trait?: string;
  impact: string;
  createdAt: string;
};

export type GoldenExample = {
  id: string;
  sessionId: string;
  category: string;
  notes?: string;
  createdAt: string;
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
  workspace?: string;
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
  models: { fast: string; capable: string; coder?: string };
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
  xai: CloudProviderConfig;
  mistral: CloudProviderConfig;
  deepseek: CloudProviderConfig;
  openrouter: CloudProviderConfig;
  qwen: CloudProviderConfig;
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

  getChatBackground: (sessionId: string) =>
    apiFetch<{ backgroundBase64: string }>(
      `/api/chat/background?sessionId=${encodeURIComponent(sessionId)}`,
    ).catch(() => null),

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

  getScratchpad: () =>
    apiFetch<{ content: string | null; lastModified: string | null; path: string }>("/api/scratchpad"),

  patchScratchpad: (content: string) =>
    apiFetch<{ ok: boolean; lastModified: string | null }>("/api/scratchpad", {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),

  clearScratchpad: () =>
    apiFetch<{ ok: boolean }>("/api/scratchpad", { method: "DELETE" }),

  // ── Skills ────────────────────────────────────────────────────────────────

  listSkills: () =>
    apiFetch<{ skills: SkillSpec[] }>("/api/skills").then((r) => r.skills),

  getSkill: (id: string) =>
    apiFetch<{ skill: SkillSpec }>(`/api/skills/${id}`).then((r) => r.skill),

  patchSkill: (id: string, patch: Partial<SkillSpec>) =>
    apiFetch<{ ok: boolean; skill: SkillSpec }>(`/api/skills/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteSkill: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/skills/${id}`, { method: "DELETE" }),

  skillAction: (id: string, action: "approve" | "latent" | "activate" | "deprecate", body?: object) =>
    apiFetch<{ ok: boolean; skill: SkillSpec }>(`/api/skills/${id}/action/${action}`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  // ── Voices ─────────────────────────────────────────────────────────────────

  listVoices: () =>
    apiFetch<{ voices: VoiceProfile[] }>("/api/voices").then((r) => r.voices),

  listEdgeVoices: () =>
    apiFetch<{ voices: VoiceOption[] }>("/api/voices/edge").then((r) => r.voices),

  createVoice: (input: CreateVoiceInput) =>
    apiFetch<{ voice: VoiceProfile }>("/api/voices", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.voice),

  getVoice: (id: string) =>
    apiFetch<{ voice: VoiceProfile }>(`/api/voices/${id}`).then((r) => r.voice),

  patchVoice: (id: string, patch: Partial<CreateVoiceInput>) =>
    apiFetch<{ voice: VoiceProfile }>(`/api/voices/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).then((r) => r.voice),

  deleteVoice: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/voices/${id}`, { method: "DELETE" }),

  synthesizeVoice: (text: string, voiceProfileId: string, format?: "path" | "base64") =>
    apiFetch<SynthesisResult>("/api/voices/synthesize", {
      method: "POST",
      body: JSON.stringify({ text, voiceProfileId, format: format ?? "base64" }),
    }),

  // ── Diagnostics ────────────────────────────────────────────────────────────

  getDiagnosticsAnalysis: () => apiFetch<DiagnosticsAnalysis>("/api/diagnostics/analysis"),

  getDiagnosticsPipeline: () => apiFetch<DiagnosticsPipeline>("/api/diagnostics/pipeline"),

  getDiagnosticsTests: () =>
    apiFetch<{ tests: DynamicTestDefinition[] }>("/api/diagnostics/tests").then((r) => r.tests),

  setDiagnosticsTests: (tests: DynamicTestDefinition[]) =>
    apiFetch<{ tests: DynamicTestDefinition[] }>("/api/diagnostics/tests", {
      method: "POST",
      body: JSON.stringify({ tests }),
    }).then((r) => r.tests),

  addDiagnosticsTest: (test: DynamicTestDefinition) =>
    apiFetch<{ tests: DynamicTestDefinition[] }>("/api/diagnostics/tests", {
      method: "POST",
      body: JSON.stringify({ test }),
    }).then((r) => r.tests),

  removeDiagnosticsTest: (id: string) =>
    apiFetch<{ tests: DynamicTestDefinition[] }>(`/api/diagnostics/tests/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then((r) => r.tests),

  runDiagnostics: () => apiFetch<DiagnosticRunResult>("/api/diagnostics/run", { method: "POST" }),

  getDiagnosticsResults: () => apiFetch<DiagnosticRunResult | { error: string }>("/api/diagnostics/results"),

  runPipelineTest: (prompt?: string) =>
    apiFetch<PipelineTestResult>("/api/diagnostics/pipeline-test", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),

  enhancePrompt: (prompt: string) =>
    apiFetch<{ enhanced: string }>("/api/diagnostics/enhance-prompt", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),

  // ── Patches ───────────────────────────────────────────────────────────────

  listPatches: () =>
    apiFetch<{ patches: Patch[] }>("/api/patches").then((r) => r.patches),

  approvePatch: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/patches/${id}/approve`, { method: "POST" }),

  rejectPatch: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/patches/${id}/reject`, { method: "POST" }),

  // ── Reinforcement ──────────────────────────────────────────────────────────

  submitFeedback: (feedback: Omit<FeedbackSignal, "id" | "createdAt">) =>
    apiFetch<{ ok: boolean }>("/api/feedback", {
      method: "POST",
      body: JSON.stringify(feedback),
    }),

  listTraits: () =>
    apiFetch<{ traits: TraitScore[] }>("/api/traits").then((r) => r.traits),

  listGoldenExamples: () =>
    apiFetch<{ examples: GoldenExample[] }>("/api/golden-examples").then((r) => r.examples),
};

// ── Diagnostics types ─────────────────────────────────────────────────────────

export type ModuleExport = { kind: string; name: string; line: number };
export type ModuleInfo = { path: string; packageName: string; exports: ModuleExport[]; imports: string[] };
export type DiagnosticsAnalysis = {
  modules: ModuleInfo[];
  packages: { name: string; path: string; hasTests: boolean }[];
  totalExports: number;
  totalModules: number;
  analyzedAt: string;
};
export type PipelineStage = { id: string; name: string; module: string; functionName: string; description: string };
export type DiagnosticsPipeline = { stages: PipelineStage[]; flow: string[] };
export type DynamicTestDefinition = {
  id: string;
  name: string;
  target: string;
  targetPath?: string;
  input: unknown;
  expected?: unknown;
  timeoutMs?: number;
};
export type SingleTestResult = {
  name: string;
  file: string;
  status: "passed" | "failed" | "skipped" | "timeout" | "error";
  durationMs?: number;
  error?: string;
};
export type PackageTestResult = {
  package: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  durationMs: number;
  tests: SingleTestResult[];
};
export type DiagnosticRunResult = {
  runId: string;
  startedAt: string;
  completedAt: string;
  packageResults: PackageTestResult[];
  summary: {
    totalPassed: number;
    totalFailed: number;
    totalSkipped: number;
    totalTests: number;
    durationMs: number;
  };
};

export type PipelineTestResult = {
  ok: boolean;
  prompt: string;
  response?: string;
  error?: string;
  errorCode?: string;
  diagnostics: {
    workspace: string;
    targetProjectRoot?: string;
    requireOllama?: boolean;
    backendMode?: "auto" | "agent" | "codex" | "claude";
    backendOrder?: Array<"agent" | "codex" | "claude">;
    maxAttempts?: number;
    pool: { fast: string | null; capable: string | null; coder: string | null; ollamaInPool: boolean };
    configOllamaEnabled: boolean;
    ollamaProbe?: { reachable: boolean; status: string; message: string };
  };
  attempts?: Array<{
    attempt: number;
    prompt: string;
    backendUsed?: "agent" | "codex" | "claude";
    backendTrace: Array<{
      backend: "agent" | "codex" | "claude";
      available?: boolean;
      command?: string;
      argsPreview?: string[];
      exitCode?: number | null;
      timedOut?: boolean;
      stdoutPreview?: string;
      stderrPreview?: string;
      error?: string;
    }>;
    ok: boolean;
    durationMs: number;
    responseText?: string;
    jsonParseOk: boolean;
    jsonParseError?: string;
    declaredPaths: string[];
    fsSnapshot: { exists: boolean; totalFiles: number; pythonFiles: string[]; files: string[] };
    failureReasons: string[];
    error?: string;
    errorCode?: string;
  }>;
  summary?: {
    successfulAttempt: number | null;
    attemptsRun: number;
    projectRoot: string;
    filesCreated: number;
    pythonFilesCreated: number;
  };
  nextActions?: string[];
};

// ── Voice types ──────────────────────────────────────────────────────────────

export type VoiceProvider = "edge" | "lux" | "xtts";

export type EdgeVoiceConfig = { voiceId: string; rate?: string; pitch?: string };
export type LuxVoiceConfig = {
  referenceAudioPath: string;
  params?: { rms?: number; tShift?: number; numSteps?: number; speed?: number; returnSmooth?: boolean; refDuration?: number };
};
export type XTTSVoiceConfig = { referenceAudioPath: string; language?: string; speakerId?: string };

export type VoiceProfile = {
  id: string;
  name: string;
  description: string;
  provider: VoiceProvider;
  providerConfig: EdgeVoiceConfig | LuxVoiceConfig | XTTSVoiceConfig;
  persona: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VoiceOption = {
  id: string;
  name: string;
  locale?: string;
  gender?: string;
  provider: VoiceProvider;
};

export type CreateVoiceInput = {
  name: string;
  description?: string;
  provider: VoiceProvider;
  providerConfig: EdgeVoiceConfig | LuxVoiceConfig | XTTSVoiceConfig;
  persona?: string;
  isDefault?: boolean;
};

export type SynthesisResult = {
  audioPath: string;
  durationMs: number;
  sampleRate: number;
  generatedAt: string;
  audioBase64?: string;
};
