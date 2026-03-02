import { useState, useEffect, useCallback } from "react";
import {
  api,
  type ProvidersConfig,
  type CloudProviderConfig,
  type LocalProviderConfig,
  type VaultStatus,
} from "../lib/api";

// ── Primitives ────────────────────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#111111] border border-[#1e1e1e] rounded-xl overflow-hidden mb-4">
      <div className="px-4 py-3 border-b border-[#1e1e1e] bg-[#0f0f0f]">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{title}</h3>
        {subtitle && <p className="text-xs text-zinc-600 mt-0.5">{subtitle}</p>}
      </div>
      <div className="divide-y divide-[#1a1a1a]">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? "bg-accent" : "bg-[#2a2a2a]"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : ""}`} />
    </button>
  );
}

function ModelInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="text-xs text-zinc-600 w-14 shrink-0">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="model-name"
        className="flex-1 min-w-0 bg-[#0a0a0a] border border-[#242424] rounded px-2 py-1 text-xs text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-[#333] font-mono"
      />
    </div>
  );
}

// ── API Key field ──────────────────────────────────────────────────────────────

function ApiKeyField({
  vaultKey,
  isSet,
  onSaved,
}: {
  vaultKey: string;
  isSet: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.setVaultKey(vaultKey, value.trim());
      setValue("");
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!confirm(`Remove this API key?`)) return;
    try {
      await api.deleteVaultKey(vaultKey);
      onSaved();
    } catch {
      // silent
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-1">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }}
          placeholder="Paste key here…"
          autoFocus
          className="flex-1 bg-[#0a0a0a] border border-[#333] rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-700 focus:outline-none font-mono"
        />
        <button onClick={() => void save()} disabled={saving} className="text-xs text-accent hover:text-cyan-300 disabled:opacity-40 transition-colors">
          {saving ? "…" : "Save"}
        </button>
        <button onClick={() => { setEditing(false); setValue(""); }} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
          Cancel
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {isSet ? (
        <>
          <span className="text-xs text-emerald-500">● Set</span>
          <button onClick={() => setEditing(true)} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Update</button>
          <button onClick={() => void clear()} className="text-xs text-zinc-700 hover:text-red-400 transition-colors">Clear</button>
        </>
      ) : (
        <>
          <span className="text-xs text-zinc-700">● Not set</span>
          <button onClick={() => setEditing(true)} className="text-xs text-accent hover:text-cyan-300 transition-colors">Add key</button>
        </>
      )}
    </div>
  );
}

// ── Token field (for adapter tokens) ─────────────────────────────────────────

function TokenField({ vaultKey, isSet, onSaved }: { vaultKey: string; isSet: boolean; onSaved: () => void }) {
  return <ApiKeyField vaultKey={vaultKey} isSet={isSet} onSaved={onSaved} />;
}

// ── Cloud provider row ────────────────────────────────────────────────────────

const CLOUD_PROVIDERS: {
  id: keyof Pick<ProvidersConfig, "anthropic" | "openai" | "google" | "groq" | "xai" | "mistral" | "deepseek" | "openrouter">;
  name: string;
  subtitle: string;
  fastDefault: string;
  capableDefault: string;
  docsUrl: string;
  modelsUrl: string;
}[] = [
  {
    id: "xai", name: "Grok (xAI)",
    subtitle: "Grok-3, Grok-3 Fast — by xAI",
    fastDefault: "grok-3-fast", capableDefault: "grok-3",
    docsUrl: "https://console.x.ai/", modelsUrl: "https://docs.x.ai/docs/models",
  },
  {
    id: "groq", name: "Groq",
    subtitle: "Cloud-hosted LLaMA & Mixtral — very fast inference",
    fastDefault: "llama-3.1-8b-instant", capableDefault: "llama-3.3-70b-versatile",
    docsUrl: "https://console.groq.com/keys", modelsUrl: "https://console.groq.com/docs/models",
  },
  {
    id: "openai", name: "OpenAI",
    subtitle: "GPT-4o, GPT-4o mini, o1, o3",
    fastDefault: "gpt-4o-mini", capableDefault: "gpt-4o",
    docsUrl: "https://platform.openai.com/api-keys", modelsUrl: "https://platform.openai.com/docs/models",
  },
  {
    id: "anthropic", name: "Anthropic",
    subtitle: "Claude 3.5 Haiku, Claude Sonnet, Claude Opus",
    fastDefault: "claude-3-5-haiku-latest", capableDefault: "claude-sonnet-4-5",
    docsUrl: "https://console.anthropic.com/settings/keys", modelsUrl: "https://docs.anthropic.com/en/docs/about-claude/models",
  },
  {
    id: "google", name: "Google",
    subtitle: "Gemini 2.0 Flash, Gemini 2.5 Pro",
    fastDefault: "gemini-2.0-flash", capableDefault: "gemini-2.5-pro-preview-05-06",
    docsUrl: "https://aistudio.google.com/app/apikey", modelsUrl: "https://ai.google.dev/gemini-api/docs/models/gemini",
  },
  {
    id: "mistral", name: "Mistral",
    subtitle: "Mistral Small, Mistral Large, Codestral",
    fastDefault: "mistral-small-latest", capableDefault: "mistral-large-latest",
    docsUrl: "https://console.mistral.ai/api-keys", modelsUrl: "https://docs.mistral.ai/getting-started/models/",
  },
  {
    id: "deepseek", name: "DeepSeek",
    subtitle: "DeepSeek-V3 (chat), DeepSeek-R1 (reasoner)",
    fastDefault: "deepseek-chat", capableDefault: "deepseek-reasoner",
    docsUrl: "https://platform.deepseek.com/api_keys", modelsUrl: "https://platform.deepseek.com/",
  },
  {
    id: "openrouter", name: "OpenRouter",
    subtitle: "Unified gateway to 200+ models",
    fastDefault: "meta-llama/llama-3.1-8b-instruct:free", capableDefault: "anthropic/claude-sonnet-4-5",
    docsUrl: "https://openrouter.ai/keys", modelsUrl: "https://openrouter.ai/models",
  },
];

function CloudProviderRow({
  id,
  name,
  subtitle,
  docsUrl,
  modelsUrl,
  fastDefault,
  capableDefault,
  config,
  vaultStatus,
  onChange,
  onVaultChange,
}: {
  id: string;
  name: string;
  subtitle: string;
  docsUrl: string;
  modelsUrl: string;
  fastDefault: string;
  capableDefault: string;
  config: CloudProviderConfig;
  vaultStatus: VaultStatus;
  onChange: (patch: Partial<CloudProviderConfig>) => void;
  onVaultChange: () => void;
}) {
  const vaultKey = `provider:${id}:api-key`;
  const isSet = vaultStatus[vaultKey] ?? false;

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Toggle checked={config.enabled} onChange={(v) => onChange({ enabled: v })} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-200 font-medium">{name}</span>
              <a href={docsUrl} target="_blank" rel="noreferrer" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors shrink-0">
                Get key ↗
              </a>
            </div>
            <p className="text-xs text-zinc-600 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <ApiKeyField vaultKey={vaultKey} isSet={isSet} onSaved={onVaultChange} />
      </div>

      {/* Model inputs — full width, stacked */}
      {config.enabled && (
        <div className="pl-12 space-y-2">
          <ModelInput
            label="Fast"
            value={config.defaultModels.fast ?? fastDefault}
            onChange={(v) => onChange({ defaultModels: { ...config.defaultModels, fast: v } })}
          />
          <ModelInput
            label="Capable"
            value={config.defaultModels.capable ?? capableDefault}
            onChange={(v) => onChange({ defaultModels: { ...config.defaultModels, capable: v } })}
          />
          <a
            href={modelsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs text-zinc-700 hover:text-zinc-500 transition-colors mt-1"
          >
            Browse {name} models ↗
          </a>
        </div>
      )}
    </div>
  );
}

// ── Local provider row ────────────────────────────────────────────────────────

function LocalProviderRow({
  name,
  config,
  onChange,
}: {
  name: string;
  config: LocalProviderConfig;
  onChange: (patch: Partial<LocalProviderConfig>) => void;
}) {
  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-center gap-3">
        <Toggle checked={config.enabled} onChange={(v) => onChange({ enabled: v })} />
        <span className="text-sm text-zinc-200 font-medium">{name}</span>
        <span className="text-xs text-zinc-600">Local — no API key needed</span>
      </div>
      {config.enabled && (
        <div className="pl-12 space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-600 w-14 shrink-0">Base URL</span>
            <input
              value={config.baseUrl}
              onChange={(e) => onChange({ baseUrl: e.target.value })}
              className="flex-1 bg-[#0a0a0a] border border-[#242424] rounded px-2 py-1 text-xs text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-[#333] font-mono"
            />
          </div>
          <div className="flex gap-4">
            <ModelInput label="Fast" value={config.models.fast} onChange={(v) => onChange({ models: { ...config.models, fast: v } })} />
            <ModelInput label="Capable" value={config.models.capable} onChange={(v) => onChange({ models: { ...config.models, capable: v } })} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Save bar ──────────────────────────────────────────────────────────────────

function SaveBar({ dirty, saving, saved, onSave }: { dirty: boolean; saving: boolean; saved: boolean; onSave: () => void }) {
  if (!dirty && !saved) return null;
  return (
    <div className="sticky bottom-0 bg-[#0a0a0a] border-t border-[#1e1e1e] px-4 py-3 flex items-center justify-between">
      <p className="text-xs text-zinc-600">{saved ? "Changes saved." : "You have unsaved changes."}</p>
      <button
        onClick={onSave}
        disabled={saving || !dirty}
        className="text-xs px-4 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 disabled:opacity-40 transition-colors"
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Providers() {
  const [providers, setProviders] = useState<ProvidersConfig | null>(null);
  const [original, setOriginal] = useState<ProvidersConfig | null>(null);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, v] = await Promise.all([api.getProviders(), api.getVaultStatus()]);
      setProviders(p);
      setOriginal(p);
      setVaultStatus(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot reach daemon");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reloadVault = useCallback(async () => {
    const v = await api.getVaultStatus().catch(() => ({}));
    setVaultStatus(v);
  }, []);

  const patch = <K extends keyof ProvidersConfig>(key: K, value: Partial<ProvidersConfig[K]>) => {
    setProviders((prev) => prev ? ({ ...prev, [key]: { ...(prev[key] as object), ...value } }) : prev);
    setSaved(false);
  };

  const save = async () => {
    if (!providers) return;
    setSaving(true);
    try {
      const res = await api.patchProviders(providers);
      setProviders(res.providers);
      setOriginal(res.providers);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const dirty = JSON.stringify(providers) !== JSON.stringify(original);

  if (loading) {
    return <div className="h-full flex items-center justify-center"><p className="text-xs text-zinc-600">Loading…</p></div>;
  }

  if (error || !providers) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <p className="text-red-400 text-sm">{error ?? "Failed to load"}</p>
        <p className="text-xs text-zinc-600">Make sure the daemon is running: <code className="text-zinc-400">adam start</code></p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-4">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">Providers</h2>
            <p className="text-xs text-zinc-600 mt-0.5">Enable providers, set models, and manage API keys. Keys are stored in your OS keychain.</p>
          </div>
          <button onClick={() => void load()} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Reload</button>
        </div>

        {/* Cloud providers */}
        <Section title="Cloud Providers" subtitle="API keys are stored securely — never written to disk in plain text.">
          {CLOUD_PROVIDERS.map(({ id, name, subtitle, docsUrl, modelsUrl, fastDefault, capableDefault }) => (
            <CloudProviderRow
              key={id}
              id={id}
              name={name}
              subtitle={subtitle}
              docsUrl={docsUrl}
              modelsUrl={modelsUrl}
              fastDefault={fastDefault}
              capableDefault={capableDefault}
              config={providers[id as keyof typeof providers] as CloudProviderConfig}
              vaultStatus={vaultStatus}
              onChange={(p) => patch(id as keyof ProvidersConfig, p as never)}
              onVaultChange={() => void reloadVault()}
            />
          ))}
        </Section>

        {/* Local providers */}
        <Section title="Local Providers" subtitle="Run models on your own hardware — no API keys required.">
          <LocalProviderRow
            name="Ollama"
            config={providers.ollama}
            onChange={(p) => patch("ollama", p)}
          />
          <LocalProviderRow
            name="LM Studio"
            config={providers.lmstudio}
            onChange={(p) => patch("lmstudio", p)}
          />
          <LocalProviderRow
            name="vLLM"
            config={providers.vllm}
            onChange={(p) => patch("vllm", p)}
          />
        </Section>

        {/* Adapter tokens */}
        <Section title="Adapter Tokens" subtitle="Bot tokens for messaging integrations.">
          <div className="px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-200 font-medium">Discord Bot Token</p>
              <p className="text-xs text-zinc-600 mt-0.5">From Discord Developer Portal → Bot → Token</p>
            </div>
            <TokenField
              vaultKey="adapter:discord:bot-token"
              isSet={vaultStatus["adapter:discord:bot-token"] ?? false}
              onSaved={() => void reloadVault()}
            />
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-200 font-medium">Telegram Bot Token</p>
              <p className="text-xs text-zinc-600 mt-0.5">From @BotFather on Telegram</p>
            </div>
            <TokenField
              vaultKey="adapter:telegram:bot-token"
              isSet={vaultStatus["adapter:telegram:bot-token"] ?? false}
              onSaved={() => void reloadVault()}
            />
          </div>
        </Section>
      </div>

      <SaveBar dirty={dirty} saving={saving} saved={saved} onSave={() => void save()} />
    </div>
  );
}
