import { useState, useEffect, useCallback } from "react";
import { api, type DiscordConfig, type DaemonConfig, type BudgetConfig, type MemoryConfig } from "../lib/api";

// ── Reusable primitives ───────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#111111] border border-[#1e1e1e] rounded-xl overflow-hidden mb-4">
      <div className="px-4 py-3 border-b border-[#1e1e1e] bg-[#0f0f0f]">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{title}</h3>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="shrink-0 w-48">
        <p className="text-sm text-zinc-300">{label}</p>
        {hint && <p className="text-xs text-zinc-600 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors ${checked ? "bg-accent" : "bg-[#2a2a2a]"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : ""}`}
      />
    </button>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  min,
  max,
  monospace = false,
}: {
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  min?: number;
  max?: number;
  monospace?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      min={min}
      max={max}
      className={`w-full bg-[#0f0f0f] border border-[#242424] rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-[#333] transition-colors${monospace ? " font-mono" : ""}`}
    />
  );
}

function Textarea({ value, onChange, placeholder, rows = 3 }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full bg-[#0f0f0f] border border-[#242424] rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-[#333] transition-colors resize-none font-mono"
    />
  );
}

function TagList({
  items,
  onRemove,
  onAdd,
  placeholder,
}: {
  items: string[];
  onRemove: (item: string) => void;
  onAdd: (item: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (v && !items.includes(v)) { onAdd(v); setDraft(""); }
  };

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <span
              key={item}
              className="flex items-center gap-1.5 text-xs text-zinc-300 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 font-mono"
            >
              {item}
              <button
                onClick={() => onRemove(item)}
                className="text-zinc-600 hover:text-red-400 transition-colors"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1 bg-[#0f0f0f] border border-[#242424] rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-[#333] transition-colors font-mono"
        />
        <button
          onClick={add}
          className="text-xs text-accent hover:text-cyan-300 px-2 transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function SaveButton({
  onClick,
  saving,
  saved,
}: {
  onClick: () => void;
  saving: boolean;
  saved: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="text-xs px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 disabled:opacity-40 transition-colors"
    >
      {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
    </button>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────────

function DiscordSection({ initial }: { initial: DiscordConfig }) {
  const [cfg, setCfg] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof DiscordConfig>(key: K, value: DiscordConfig[K]) => {
    setCfg((c) => ({ ...c, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.patchDiscord(cfg);
      setCfg(res.config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Discord Bot">
      <Field label="Enabled">
        <Toggle checked={cfg.enabled} onChange={(v) => set("enabled", v)} />
      </Field>

      <Field label="Client ID" hint="From Discord Developer Portal">
        <Input
          value={cfg.clientId ?? ""}
          onChange={(v) => set("clientId", v || undefined)}
          placeholder="1234567890123456789"
        />
      </Field>

      <Field label="Mention-only" hint="Server messages require @mention">
        <Toggle checked={cfg.mentionOnly} onChange={(v) => set("mentionOnly", v)} />
      </Field>

      <Field label="Respond in threads" hint="Auto-create threads for responses">
        <Toggle checked={cfg.respondInThreads} onChange={(v) => set("respondInThreads", v)} />
      </Field>

      <Field label="Rate limit" hint="Max messages per user/min (0 = off)">
        <Input
          type="number"
          value={cfg.rateLimitPerUserPerMinute}
          onChange={(v) => set("rateLimitPerUserPerMinute", parseInt(v, 10) || 0)}
          min={0}
          max={60}
        />
      </Field>

      <Field label="Max message length">
        <Input
          type="number"
          value={cfg.maxMessageLength}
          onChange={(v) => set("maxMessageLength", parseInt(v, 10) || 2000)}
          min={500}
          max={4000}
        />
      </Field>

      <Field label="Channel whitelist" hint="Empty = all channels. Paste channel IDs.">
        <TagList
          items={cfg.channelWhitelist}
          onAdd={(id) => set("channelWhitelist", [...cfg.channelWhitelist, id])}
          onRemove={(id) => set("channelWhitelist", cfg.channelWhitelist.filter((c) => c !== id))}
          placeholder="Channel ID (e.g. 1234567890)"
        />
      </Field>

      <Field label="User blacklist" hint="User IDs that Adam will ignore">
        <TagList
          items={cfg.userBlacklist}
          onAdd={(id) => set("userBlacklist", [...cfg.userBlacklist, id])}
          onRemove={(id) => set("userBlacklist", cfg.userBlacklist.filter((u) => u !== id))}
          placeholder="User ID"
        />
      </Field>

      <Field label="Admin users" hint="Can run !adam commands in Discord">
        <TagList
          items={cfg.adminUsers}
          onAdd={(id) => set("adminUsers", [...cfg.adminUsers, id])}
          onRemove={(id) => set("adminUsers", cfg.adminUsers.filter((u) => u !== id))}
          placeholder="User ID"
        />
      </Field>

      <Field label="System prompt override" hint="Discord-specific personality. Leave blank to use default.">
        <Textarea
          value={cfg.systemPromptOverride ?? ""}
          onChange={(v) => set("systemPromptOverride", v || undefined)}
          placeholder="Override Adam's personality for Discord only…"
          rows={4}
        />
      </Field>

      <div className="flex justify-end pt-1">
        <SaveButton onClick={() => void save()} saving={saving} saved={saved} />
      </div>
    </Section>
  );
}

function AgentSection({ initial }: { initial: DaemonConfig }) {
  const [cfg, setCfg] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof DaemonConfig>(key: K, value: DaemonConfig[K]) => {
    setCfg((c) => ({ ...c, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.patchDaemon(cfg);
      setCfg(res.config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Agent">
      <Field label="Name">
        <Input value={cfg.agentName} onChange={(v) => set("agentName", v)} placeholder="Adam" />
      </Field>

      <Field label="Port" hint="Daemon HTTP port">
        <Input
          type="number"
          value={cfg.port}
          onChange={(v) => set("port", parseInt(v, 10) || 18800)}
          min={1024}
          max={65535}
        />
      </Field>

      <Field label="Log level">
        <select
          value={cfg.logLevel}
          onChange={(e) => set("logLevel", e.target.value as DaemonConfig["logLevel"])}
          className="bg-[#0f0f0f] border border-[#242424] rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-[#333] transition-colors"
        >
          {(["debug", "info", "warn", "error"] as const).map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </Field>

      <Field
        label="Workspace"
        hint="Default directory for all projects and files Adam creates. Relative paths in code tools resolve here."
      >
        <Input
          value={cfg.workspace ?? ""}
          onChange={(v) => set("workspace", v || undefined)}
          placeholder="e.g. C:\Users\you\Projects"
          monospace
        />
        {cfg.workspace && (
          <p className="text-xs text-zinc-600 mt-1">
            Adam will always know to look here first. Set this to avoid losing created files.
          </p>
        )}
        {!cfg.workspace && (
          <p className="text-xs text-amber-700 mt-1">
            Not set — falls back to home directory. Files may be hard to find.
          </p>
        )}
      </Field>

      <Field label="System prompt" hint="Global personality. Overrides the default.">
        <Textarea
          value={cfg.systemPrompt ?? ""}
          onChange={(v) => set("systemPrompt", v || undefined)}
          placeholder="Leave blank to use the built-in personality…"
          rows={5}
        />
      </Field>

      <div className="flex justify-end pt-1">
        <SaveButton onClick={() => void save()} saving={saving} saved={saved} />
      </div>
    </Section>
  );
}

function BudgetSection({ initial }: { initial: BudgetConfig }) {
  const [cfg, setCfg] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof BudgetConfig>(key: K, value: BudgetConfig[K]) => {
    setCfg((c) => ({ ...c, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.patchBudget(cfg);
      setCfg(res.config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Budget">
      <Field label="Daily limit (USD)">
        <Input
          type="number"
          value={cfg.dailyLimitUsd}
          onChange={(v) => set("dailyLimitUsd", parseFloat(v) || 0)}
          min={0}
        />
      </Field>

      <Field label="Monthly limit (USD)">
        <Input
          type="number"
          value={cfg.monthlyLimitUsd}
          onChange={(v) => set("monthlyLimitUsd", parseFloat(v) || 0)}
          min={0}
        />
      </Field>

      <Field label="Local fallback" hint="Switch to local models when budget is exhausted">
        <Toggle
          checked={cfg.fallbackToLocalOnExhaustion}
          onChange={(v) => set("fallbackToLocalOnExhaustion", v)}
        />
      </Field>

      <div className="flex justify-end pt-1">
        <SaveButton onClick={() => void save()} saving={saving} saved={saved} />
      </div>
    </Section>
  );
}

function MemorySection({ initial }: { initial: MemoryConfig }) {
  const [cfg, setCfg] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof MemoryConfig>(key: K, value: MemoryConfig[K]) => {
    setCfg((c) => ({ ...c, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.patchMemoryConfig(cfg);
      setCfg(res.config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  // Confidence threshold as a percentage label
  const minPct = Math.round(cfg.decayMinConfidence * 100);

  return (
    <Section title="Memory Lifecycle">
      <p className="text-xs text-zinc-600 leading-relaxed -mt-1">
        Profile facts have a living confidence score. Facts used in conversations are reinforced.
        Facts that go unreferenced decay over time and are pruned when they fall below the threshold.
        User-entered and protected facts are immune.
      </p>

      <Field
        label="Decay half-life"
        hint="Days until an unreferenced fact loses half its confidence. Lower = faster forgetting."
      >
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={365}
            step={1}
            value={cfg.decayHalfLifeDays}
            onChange={(e) => set("decayHalfLifeDays", parseInt(e.target.value, 10))}
            className="flex-1 accent-cyan-400"
          />
          <span className="text-sm text-zinc-300 w-16 text-right font-mono tabular-nums">
            {cfg.decayHalfLifeDays}d
          </span>
        </div>
        <div className="flex justify-between text-xs text-zinc-700 mt-0.5 px-0.5">
          <span>1d (aggressive)</span>
          <span>30d (default)</span>
          <span>365d (permanent)</span>
        </div>
      </Field>

      <Field
        label="Pruning threshold"
        hint="Facts that decay below this confidence are permanently removed."
      >
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={95}
            step={1}
            value={minPct}
            onChange={(e) => set("decayMinConfidence", parseInt(e.target.value, 10) / 100)}
            className="flex-1 accent-cyan-400"
          />
          <span className="text-sm text-zinc-300 w-16 text-right font-mono tabular-nums">
            {minPct}%
          </span>
        </div>
        <div className="flex justify-between text-xs text-zinc-700 mt-0.5 px-0.5">
          <span>1% (tolerant)</span>
          <span>25% (default)</span>
          <span>95% (aggressive pruning)</span>
        </div>
      </Field>

      <Field
        label="Consolidation window"
        hint="Episodic sessions older than this many days are eligible for long-term consolidation."
      >
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={90}
            step={1}
            value={cfg.consolidateAfterDays}
            onChange={(e) => set("consolidateAfterDays", parseInt(e.target.value, 10))}
            className="flex-1 accent-cyan-400"
          />
          <span className="text-sm text-zinc-300 w-16 text-right font-mono tabular-nums">
            {cfg.consolidateAfterDays}d
          </span>
        </div>
      </Field>

      <div className="flex justify-end pt-1">
        <SaveButton onClick={() => void save()} saving={saving} saved={saved} />
      </div>
    </Section>
  );
}

function PersonalitySection() {
  const [content, setContent] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getPersonality();
      setContent(data.content);
      setDraft(data.content);
      setFilePath(data.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.patchPersonality(draft);
      setContent(res.content);
      setDraft(res.content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirm("Reset personality to built-in defaults? This cannot be undone.")) return;
    setResetting(true);
    try {
      const res = await api.resetPersonality();
      setContent(res.content);
      setDraft(res.content);
    } finally {
      setResetting(false);
    }
  };

  const isDirty = draft !== content;

  return (
    <Section title="Personality Profile">
      <div className="space-y-3">
        <p className="text-xs text-zinc-500 leading-relaxed">
          This file is injected into every conversation and defines who Adam is.
          You can edit it directly here, or just tell Adam how you want him to behave in chat — he'll update it himself.
        </p>

        {filePath && (
          <p className="text-xs text-zinc-700 font-mono">{filePath}</p>
        )}

        {loading ? (
          <p className="text-xs text-zinc-600 py-4 text-center">Loading…</p>
        ) : error ? (
          <p className="text-xs text-red-400">{error}</p>
        ) : (
          <textarea
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setSaved(false); }}
            rows={24}
            spellCheck={false}
            className="w-full bg-[#0a0a0a] border border-[#242424] rounded-lg px-3 py-2.5 text-xs text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-[#333] transition-colors resize-none font-mono leading-relaxed"
            placeholder="Personality profile will be generated here…"
          />
        )}

        <div className="flex items-center justify-between pt-1">
          <button
            onClick={() => void reset()}
            disabled={resetting}
            className="text-xs text-zinc-600 hover:text-red-400 disabled:opacity-40 transition-colors"
          >
            {resetting ? "Resetting…" : "Reset to defaults"}
          </button>
          <div className="flex items-center gap-3">
            {isDirty && !saved && (
              <span className="text-xs text-zinc-600">Unsaved changes</span>
            )}
            <SaveButton onClick={() => void save()} saving={saving} saved={saved} />
          </div>
        </div>
      </div>
    </Section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Settings() {
  const [config, setConfig] = useState<{
    discord: DiscordConfig;
    daemon: DaemonConfig;
    budget: BudgetConfig;
    memory: MemoryConfig;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfg, mem] = await Promise.all([api.getConfig(), api.getMemoryConfig()]);
      setConfig({ discord: cfg.discord, daemon: cfg.daemon, budget: cfg.budget, memory: mem });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot reach daemon");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs text-zinc-600">Loading…</p>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <p className="text-red-400 text-sm">{error ?? "Failed to load config"}</p>
        <p className="text-xs text-zinc-600">Make sure the daemon is running: <code className="text-zinc-400">adam start</code></p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">Settings</h2>
          <p className="text-xs text-zinc-600 mt-0.5">Changes are saved to ~/.adam/config.json and applied live.</p>
        </div>
        <button
          onClick={() => void load()}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Reload
        </button>
      </div>

      <PersonalitySection />
      <MemorySection initial={config.memory} />
      <AgentSection initial={config.daemon} />
      <BudgetSection initial={config.budget} />
      <DiscordSection initial={config.discord} />
    </div>
  );
}
