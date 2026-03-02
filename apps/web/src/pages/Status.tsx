import { useState, useEffect, useCallback } from "react";
import { api, type StatusData } from "../lib/api";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#111111] border border-[#1e1e1e] rounded-xl p-4 ${className}`}>
      {children}
    </div>
  );
}

function Row({ label, value, accent = false }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[#181818] last:border-0">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-xs font-medium ${accent ? "text-accent" : "text-zinc-300"}`}>
        {value}
      </span>
    </div>
  );
}

function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${online ? "bg-green-400" : "bg-red-500"}`}
    />
  );
}

export default function Status() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await api.getStatus();
      setData(status);
      setOnline(true);
    } catch (e) {
      setOnline(false);
      setError(e instanceof Error ? e.message : "Cannot reach daemon");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh every 30s
  useEffect(() => {
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs text-zinc-600">Loading…</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <StatusDot online={online} />
          <h2 className="text-sm font-semibold text-zinc-200">
            {online ? "Daemon running" : "Daemon offline"}
          </h2>
        </div>
        <button
          onClick={() => void load()}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 text-red-400 text-xs bg-red-950/30 border border-red-900/40 rounded px-3 py-2">
          {error}
        </div>
      )}

      {data && (
        <div className="space-y-3">
          {/* System */}
          <Card>
            <p className="text-[11px] text-zinc-600 font-medium uppercase tracking-wider mb-3">System</p>
            <Row label="Agent" value={data.agentName} accent />
            <Row label="Version" value={`v${data.version}`} />
            <Row label="Uptime" value={formatUptime(data.uptime)} />
            <Row label="Port" value={data.port} />
          </Card>

          {/* Providers */}
          <Card>
            <p className="text-[11px] text-zinc-600 font-medium uppercase tracking-wider mb-3">Providers</p>
            {data.providers.cloud.length > 0 ? (
              <Row
                label="Cloud"
                value={
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {data.providers.cloud.map((p) => (
                      <span key={p} className="text-[10px] text-sky-400 bg-sky-950/40 border border-sky-900/50 px-1.5 py-0.5 rounded">
                        {p}
                      </span>
                    ))}
                  </div>
                }
              />
            ) : (
              <Row label="Cloud" value={<span className="text-zinc-600">none</span>} />
            )}
            {data.providers.local.length > 0 ? (
              <Row
                label="Local"
                value={
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {data.providers.local.map((p) => (
                      <span key={p} className="text-[10px] text-green-400 bg-green-950/40 border border-green-900/50 px-1.5 py-0.5 rounded">
                        {p}
                      </span>
                    ))}
                  </div>
                }
              />
            ) : (
              <Row label="Local" value={<span className="text-zinc-600">none</span>} />
            )}
          </Card>

          {/* Budget */}
          <Card>
            <p className="text-[11px] text-zinc-600 font-medium uppercase tracking-wider mb-3">Budget</p>
            <Row label="Daily limit" value={`$${data.budget.dailyLimitUsd.toFixed(2)}`} />
            <Row label="Monthly limit" value={`$${data.budget.monthlyLimitUsd.toFixed(2)}`} />
            <Row
              label="Local fallback"
              value={data.budget.fallbackToLocalOnExhaustion ? "enabled" : "disabled"}
            />
          </Card>

          {/* Memory */}
          <Card>
            <p className="text-[11px] text-zinc-600 font-medium uppercase tracking-wider mb-3">Memory</p>
            <Row label="Profile facts" value={data.memory.profileFacts} accent={data.memory.profileFacts > 0} />
            {data.memory.categories.length > 0 && (
              <Row
                label="Categories"
                value={
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {data.memory.categories.map((c) => (
                      <span key={c} className="text-[10px] text-zinc-400 bg-zinc-900/60 border border-zinc-800/50 px-1.5 py-0.5 rounded">
                        {c}
                      </span>
                    ))}
                  </div>
                }
              />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
