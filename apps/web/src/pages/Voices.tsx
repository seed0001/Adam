import { useState, useEffect, useCallback } from "react";
import {
  api,
  type VoiceProfile,
  type VoiceOption,
  type CreateVoiceInput,
  type EdgeVoiceConfig,
  type LuxVoiceConfig,
  type XTTSVoiceConfig,
} from "../lib/api";

const PROVIDER_LABELS: Record<string, string> = {
  edge: "Edge TTS",
  lux: "Lux TTS",
  xtts: "XTTS",
};

function ProviderBadge({ provider }: { provider: string }) {
  const colors: Record<string, string> = {
    edge: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    lux: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    xtts: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${colors[provider] ?? "bg-zinc-500/15 text-zinc-400"}`}>
      {PROVIDER_LABELS[provider] ?? provider}
    </span>
  );
}

function VoiceCard({ voice, onSelect, onTest }: { voice: VoiceProfile; onSelect: () => void; onTest: () => void }) {
  const configLabel =
    voice.provider === "edge"
      ? (voice.providerConfig as EdgeVoiceConfig).voiceId
      : voice.provider === "lux"
        ? (voice.providerConfig as LuxVoiceConfig).referenceAudioPath || "—"
        : (voice.providerConfig as XTTSVoiceConfig).referenceAudioPath || "—";

  return (
    <button
      onClick={onSelect}
      className="w-full text-left bg-[#0d0d0d] border border-[#1e1e1e] rounded-xl p-4 hover:border-[#2a2a2a] hover:bg-[#111] transition-colors group"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">{voice.name}</p>
        <div className="flex items-center gap-2">
          {voice.isDefault && (
            <span className="text-[10px] text-emerald-500 font-medium">Default</span>
          )}
          <ProviderBadge provider={voice.provider} />
        </div>
      </div>
      {voice.description && (
        <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2 mb-2">{voice.description}</p>
      )}
      <p className="text-[10px] text-zinc-600 font-mono truncate mb-3" title={configLabel}>
        {voice.provider === "edge" ? configLabel : configLabel.slice(0, 50) + (configLabel.length > 50 ? "…" : "")}
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onTest(); }}
          className="text-[10px] text-accent hover:text-cyan-300 transition-colors"
        >
          Test
        </button>
        <span className="text-[10px] text-zinc-700">
          · {new Date(voice.updatedAt).toLocaleDateString()}
        </span>
      </div>
    </button>
  );
}

function CreateVoiceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (v: VoiceProfile) => void }) {
  const [provider, setProvider] = useState<"edge" | "lux" | "xtts">("edge");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [persona, setPersona] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [edgeVoices, setEdgeVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [refPath, setRefPath] = useState("");
  const [language, setLanguage] = useState("en");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (provider === "edge") {
      api.listEdgeVoices().then((v) => {
        setEdgeVoices(v);
        const en = v.filter((x) => (x.locale ?? "").startsWith("en"));
        if (en.length > 0) setVoiceId((prev) => prev || en[0].id);
        else setVoiceId("en-US-JennyNeural");
      }).catch(() => setVoiceId("en-US-JennyNeural"));
    }
  }, [provider]);

  const handleSubmit = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      let providerConfig: EdgeVoiceConfig | LuxVoiceConfig | XTTSVoiceConfig;
      if (provider === "edge") {
        if (!voiceId) { setError("Select an Edge voice"); setSaving(false); return; }
        providerConfig = { voiceId };
      } else if (provider === "lux") {
        if (!refPath.trim()) { setError("Reference audio path is required"); setSaving(false); return; }
        providerConfig = {
          referenceAudioPath: refPath.trim(),
          params: { rms: 0.01, tShift: 0.9, numSteps: 4, speed: 1.0, returnSmooth: false, refDuration: 5 },
        };
      } else {
        if (!refPath.trim()) { setError("Reference audio path is required"); setSaving(false); return; }
        providerConfig = { referenceAudioPath: refPath.trim(), language: language.trim() || "en" };
      }
      const input: CreateVoiceInput = {
        name: name.trim(),
        description: description.trim(),
        provider,
        providerConfig,
        persona: persona.trim(),
        isDefault,
      };
      const voice = await api.createVoice(input);
      onCreated(voice);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 pt-16 px-4 pb-8 overflow-y-auto">
      <div className="w-full max-w-lg bg-[#0f0f0f] border border-[#242424] rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[#1a1a1a]">
          <h2 className="text-sm font-semibold text-zinc-100">Add Voice</h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as "edge" | "lux" | "xtts")}
              className="w-full bg-[#0a0a0a] border border-[#242424] rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-[#333]"
            >
              <option value="edge">Edge TTS — built-in voices</option>
              <option value="lux">Lux TTS — clone from reference audio</option>
              <option value="xtts">XTTS — clone from reference audio</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jenny"
              className="w-full bg-[#0a0a0a] border border-[#242424] rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-[#333]"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">Description (optional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description"
              className="w-full bg-[#0a0a0a] border border-[#242424] rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-[#333]"
            />
          </div>

          {provider === "edge" && (
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">Edge Voice</label>
              <select
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                className="w-full bg-[#0a0a0a] border border-[#242424] rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-[#333]"
              >
                {edgeVoices.filter((v) => (v.locale ?? "").startsWith("en")).slice(0, 30).length > 0 ? (
                  edgeVoices.filter((v) => (v.locale ?? "").startsWith("en")).slice(0, 30).map((v) => (
                    <option key={v.id} value={v.id}>{v.name} ({v.locale})</option>
                  ))
                ) : (
                  <option value="en-US-JennyNeural">en-US-JennyNeural (loading…)</option>
                )}
              </select>
            </div>
          )}

          {(provider === "lux" || provider === "xtts") && (
            <>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">Reference audio path</label>
                <input
                  value={refPath}
                  onChange={(e) => setRefPath(e.target.value)}
                  placeholder="/path/to/sample.wav (min 3 sec)"
                  className="w-full bg-[#0a0a0a] border border-[#242424] rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-[#333] font-mono"
                />
              </div>
              {provider === "xtts" && (
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">Language</label>
                  <input
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    placeholder="en"
                    className="w-full bg-[#0a0a0a] border border-[#242424] rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-[#333]"
                  />
                </div>
              )}
            </>
          )}

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">Persona (optional)</label>
            <textarea
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              placeholder="How this voice should speak…"
              rows={2}
              className="w-full bg-[#0a0a0a] border border-[#242424] rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-[#333] resize-none"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="rounded" />
            <span className="text-xs text-zinc-400">Set as default voice</span>
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-[#1a1a1a]">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="px-3 py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 rounded hover:bg-accent/30 transition-colors disabled:opacity-40"
          >
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function VoiceDetailModal({ voice, onClose, onUpdate, onDelete }: {
  voice: VoiceProfile;
  onClose: () => void;
  onUpdate: (v: VoiceProfile) => void;
  onDelete: (id: string) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setAudioUrl(null);
    try {
      const result = await api.synthesizeVoice("Hello, this is a test of the voice.", voice.id);
      if (result.audioBase64) {
        setAudioUrl(`data:audio/mpeg;base64,${result.audioBase64}`);
      }
    } catch {
      // ignore
    } finally {
      setTesting(false);
    }
  };

  const handleSetDefault = async () => {
    try {
      const updated = await api.patchVoice(voice.id, { isDefault: true });
      onUpdate(updated);
    } catch {
      // ignore
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete voice "${voice.name}"?`)) return;
    await api.deleteVoice(voice.id);
    onDelete(voice.id);
    onClose();
  };

  const configLabel =
    voice.provider === "edge"
      ? (voice.providerConfig as EdgeVoiceConfig).voiceId
      : voice.provider === "lux"
        ? (voice.providerConfig as LuxVoiceConfig).referenceAudioPath
        : (voice.providerConfig as XTTSVoiceConfig).referenceAudioPath;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 pt-16 px-4 pb-8 overflow-y-auto">
      <div className="w-full max-w-lg bg-[#0f0f0f] border border-[#242424] rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[#1a1a1a]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-sm font-semibold text-zinc-100">{voice.name}</h2>
              <ProviderBadge provider={voice.provider} />
              {voice.isDefault && <span className="text-[10px] text-emerald-500">Default</span>}
            </div>
            <p className="text-[11px] text-zinc-600 font-mono">{voice.id}</p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          {voice.description && <p className="text-sm text-zinc-400">{voice.description}</p>}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Config</p>
            <p className="text-xs font-mono text-zinc-500 break-all">{configLabel}</p>
          </div>
          {voice.persona && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Persona</p>
              <p className="text-xs text-zinc-400 leading-relaxed">{voice.persona}</p>
            </div>
          )}
          {audioUrl && (
            <audio src={audioUrl} controls className="w-full h-10" />
          )}
        </div>
        <div className="flex items-center justify-between gap-2 p-5 border-t border-[#1a1a1a]">
          <div className="flex gap-2">
            <button
              onClick={() => void handleTest()}
              disabled={testing}
              className="px-3 py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 rounded hover:bg-accent/30 transition-colors disabled:opacity-40"
            >
              {testing ? "Synthesizing…" : "Test"}
            </button>
            {!voice.isDefault && (
              <button
                onClick={() => void handleSetDefault()}
                className="px-3 py-1.5 text-xs text-zinc-400 border border-[#2a2a2a] rounded hover:text-zinc-200 hover:border-[#333] transition-colors"
              >
                Set default
              </button>
            )}
          </div>
          <button
            onClick={() => void handleDelete()}
            className="px-3 py-1.5 text-xs text-zinc-600 hover:text-red-400 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Voices() {
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<VoiceProfile | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.listVoices();
      setVoices(data);
    } catch {
      // daemon not running
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleTest = useCallback((voice: VoiceProfile) => {
    setSelected(voice);
  }, []);

  const handleUpdate = useCallback((v: VoiceProfile) => {
    setVoices((prev) => prev.map((x) => (x.id === v.id ? v : x)));
    setSelected(v);
  }, []);

  const handleDelete = useCallback((id: string) => {
    setVoices((prev) => prev.filter((x) => x.id !== id));
    setSelected(null);
  }, []);

  const handleCreated = useCallback((v: VoiceProfile) => {
    setVoices((prev) => [v, ...prev]);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#1a1a1a] shrink-0">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Voices</h2>
          <p className="text-[10px] text-zinc-600 mt-0.5">
            {voices.length === 0 ? "No voices yet" : `${voices.length} voice${voices.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 rounded hover:bg-accent/30 transition-colors"
        >
          Add voice
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-600 text-sm">Loading…</p>
          </div>
        ) : voices.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 select-none text-center px-8">
            <div className="w-12 h-12 rounded-xl bg-[#111] border border-[#222] flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 3v14M3 10h14" stroke="#3a3a3a" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-zinc-500 text-sm">No voices yet.</p>
            <p className="text-zinc-700 text-xs max-w-[280px]">
              Add Edge TTS (built-in), Lux TTS (clone from audio), or XTTS voices. Run <code className="text-zinc-600">adam voice create</code> in the CLI for more options.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="px-3 py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 rounded hover:bg-accent/30 transition-colors"
            >
              Add voice
            </button>
          </div>
        ) : (
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {voices.map((voice) => (
              <VoiceCard
                key={voice.id}
                voice={voice}
                onSelect={() => setSelected(voice)}
                onTest={() => handleTest(voice)}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateVoiceModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}

      {selected && (
        <VoiceDetailModal
          voice={selected}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
