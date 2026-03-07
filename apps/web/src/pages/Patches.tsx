import { useState, useEffect, useCallback } from "react";
import { api, type Patch } from "../lib/api";

function Card({
    children,
    className = "",
    title,
}: {
    children: React.ReactNode;
    className?: string;
    title?: string;
}) {
    return (
        <div className={`bg-[#111111] border border-[#1e1e1e] rounded-xl p-4 ${className}`}>
            {title && (
                <p className="text-[11px] text-zinc-600 font-medium uppercase tracking-wider mb-3">{title}</p>
            )}
            {children}
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const colors: Record<string, string> = {
        pending: "bg-amber-500/20 text-amber-400 border-amber-500/40",
        proposed: "bg-amber-500/20 text-amber-400 border-amber-500/40",
        approved: "bg-blue-500/20 text-blue-400 border-blue-500/40",
        applied: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
        rejected: "bg-zinc-500/20 text-zinc-400 border-zinc-500/40",
        failed: "bg-red-500/20 text-red-400 border-red-500/40",
    };
    return (
        <span
            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${colors[status] ?? "bg-zinc-500/20 text-zinc-400"}`}
        >
            {status}
        </span>
    );
}

export default function Patches() {
    const [patches, setPatches] = useState<Patch[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.listPatches();
            setPatches(data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load patches");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const handleAction = async (id: string, action: "approve" | "reject") => {
        setActionLoading(id);
        try {
            if (action === "approve") {
                await api.approvePatch(id);
            } else {
                await api.rejectPatch(id);
            }
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : `Failed to ${action} patch`);
        } finally {
            setActionLoading(null);
        }
    };

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <p className="text-xs text-zinc-600">Loading patches…</p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col overflow-hidden px-4 py-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-xl font-semibold text-zinc-100 mb-1">Patch Queue</h1>
                    <p className="text-xs text-zinc-500">Review and apply autonomous code fixes.</p>
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

            <div className="flex-1 overflow-y-auto space-y-4">
                {patches.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center">
                        <div className="w-12 h-12 rounded-full bg-[#111] flex items-center justify-center mb-3">
                            <span className="text-zinc-700">✓</span>
                        </div>
                        <p className="text-sm text-zinc-500">No pending patches</p>
                        <p className="text-xs text-zinc-700">Adam's self-repair system will propose fixes here if errors occur.</p>
                    </div>
                ) : (
                    patches.map((patch) => (
                        <Card key={patch.id} className="group transition-all hover:border-zinc-700">
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                        <StatusBadge status={patch.status} />
                                        <span className="text-[11px] font-mono text-zinc-500">{patch.id}</span>
                                    </div>
                                    <h3 className="text-sm font-medium text-zinc-200">{patch.filePath}</h3>
                                    <p className="text-zinc-500 text-[10px]">{new Date(patch.createdAt).toLocaleString()}</p>
                                </div>

                                {(patch.status === "pending" || patch.status === "proposed") && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => void handleAction(patch.id, "reject")}
                                            disabled={!!actionLoading}
                                            className="px-3 py-1.5 rounded text-[10px] font-semibold bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
                                        >
                                            Reject
                                        </button>
                                        <button
                                            onClick={() => void handleAction(patch.id, "approve")}
                                            disabled={!!actionLoading}
                                            className="px-3 py-1.5 rounded text-[10px] font-semibold bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-50"
                                        >
                                            {actionLoading === patch.id ? "Applying..." : "Approve & Apply"}
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="bg-[#080808] border border-[#1e1e1e] rounded-lg p-3 mb-3">
                                <p className="text-zinc-500 text-[10px] uppercase tracking-wider mb-1 font-medium">Rationale</p>
                                <p className="text-xs text-zinc-300 leading-relaxed">{patch.rationale}</p>
                            </div>

                            <div className="bg-[#0d0d0d] rounded-lg border border-[#1e1e1e] overflow-hidden">
                                <div className="bg-[#141414] px-3 py-2 border-b border-[#1e1e1e] flex justify-between items-center">
                                    <span className="text-[10px] text-zinc-500 font-mono">Unified Diff</span>
                                </div>
                                <pre className="p-3 text-[11px] font-mono text-zinc-400 overflow-x-auto max-h-64 whitespace-pre">
                                    {patch.diff.split('\n').map((line, i) => {
                                        const color = line.startsWith("+") ? "text-emerald-400" : line.startsWith("-") ? "text-red-400" : "";
                                        return (
                                            <div key={i} className={color}>
                                                {line}
                                            </div>
                                        );
                                    })}
                                </pre>
                            </div>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
