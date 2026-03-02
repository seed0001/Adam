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
};
