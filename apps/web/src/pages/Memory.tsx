import { useState, useEffect, useCallback } from "react";
import { api, type ProfileFact } from "../lib/api";

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item);
    (acc[k] ??= []).push(item);
    return acc;
  }, {});
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1 bg-[#1e1e1e] rounded-full overflow-hidden">
        <div
          className="h-full bg-accent/50 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-zinc-600">{pct}%</span>
    </div>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  identity: "text-violet-400 bg-violet-950/40 border-violet-900/50",
  preference: "text-sky-400 bg-sky-950/40 border-sky-900/50",
  context: "text-amber-400 bg-amber-950/40 border-amber-900/50",
  goal: "text-green-400 bg-green-950/40 border-green-900/50",
  general: "text-zinc-400 bg-zinc-900/40 border-zinc-800/50",
};

function CategoryBadge({ category }: { category: string }) {
  const cls = CATEGORY_COLORS[category] ?? CATEGORY_COLORS["general"];
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${cls}`}>
      {category}
    </span>
  );
}

export default function Memory() {
  const [facts, setFacts] = useState<ProfileFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearEpisodic, setConfirmClearEpisodic] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFacts(await api.getProfile());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load memory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const deleteFact = async (key: string) => {
    setDeleting((d) => new Set(d).add(key));
    try {
      await api.deleteProfileFact(key);
      setFacts((prev) => prev.filter((f) => f.key !== key));
    } catch {
      /* ignore */
    } finally {
      setDeleting((d) => { const n = new Set(d); n.delete(key); return n; });
    }
  };

  const clearAll = async () => {
    try {
      await api.clearAllProfileMemory();
      setFacts([]);
    } catch {
      /* ignore */
    }
    setConfirmClear(false);
  };

  const grouped = groupBy(facts, (f) => f.category);
  const categoryOrder = ["identity", "preference", "goal", "context", "general"];
  const sortedCategories = [
    ...categoryOrder.filter((c) => grouped[c]),
    ...Object.keys(grouped).filter((c) => !categoryOrder.includes(c)),
  ];

  const clearEpisodic = async () => {
    try {
      await api.clearAllEpisodicMemory();
    } catch {
      /* ignore */
    }
    setConfirmClearEpisodic(false);
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">Profile Memory</h2>
          <p className="text-xs text-zinc-600 mt-0.5">
            {loading ? "Loading…" : `${facts.length} facts across ${sortedCategories.length} categories`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Episodic clear */}
          {!confirmClearEpisodic && !confirmClear && (
            <button
              onClick={() => setConfirmClearEpisodic(true)}
              className="text-xs text-zinc-600 hover:text-amber-400 transition-colors"
              title="Clear all conversation history"
            >
              Clear history
            </button>
          )}
          {confirmClearEpisodic && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Erase all conversation history?</span>
              <button
                onClick={() => void clearEpisodic()}
                className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmClearEpisodic(false)}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
          {/* Profile clear */}
          {facts.length > 0 && !confirmClear && !confirmClearEpisodic && (
            <button
              onClick={() => setConfirmClear(true)}
              className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
            >
              Clear profile
            </button>
          )}
          {confirmClear && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Erase all profile facts?</span>
              <button
                onClick={() => void clearAll()}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
          <button
            onClick={() => void load()}
            disabled={loading}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-red-400 text-xs bg-red-950/30 border border-red-900/40 rounded px-3 py-2">
          {error}
        </div>
      )}

      {!loading && facts.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-zinc-600">
          <p className="text-sm">No memories yet.</p>
          <p className="text-xs text-zinc-700">Adam builds a profile as you chat.</p>
        </div>
      )}

      {/* Categories */}
      <div className="space-y-6">
        {sortedCategories.map((cat) => (
          <section key={cat}>
            <div className="flex items-center gap-2 mb-2">
              <CategoryBadge category={cat} />
              <span className="text-[10px] text-zinc-700">{grouped[cat]?.length ?? 0} facts</span>
            </div>

            <div className="space-y-1.5">
              {(grouped[cat] ?? []).map((fact) => (
                <div
                  key={fact.key}
                  className="flex items-start gap-3 bg-[#111111] border border-[#1e1e1e] rounded-lg px-3.5 py-2.5 group hover:border-[#2a2a2a] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-xs font-medium text-zinc-300 font-mono">{fact.key}</span>
                      <span className="text-zinc-600 text-xs">·</span>
                      <span className="text-xs text-zinc-400 leading-relaxed">{fact.value}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5">
                      <ConfidenceBar value={fact.confidence} />
                      {fact.source && (
                        <span className="text-[10px] text-zinc-700">via {fact.source}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => void deleteFact(fact.key)}
                    disabled={deleting.has(fact.key)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-zinc-700 hover:text-red-400 transition-all disabled:opacity-40 mt-0.5"
                    title="Forget this"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M1.5 1.5L10.5 10.5M1.5 10.5L10.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
