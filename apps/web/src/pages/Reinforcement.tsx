import { useState, useEffect, useCallback } from "react";
import { api, type TraitScore, type GoldenExample } from "../lib/api";

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

function TraitBar({ trait, score }: { trait: string; score: number }) {
    // Normalize score for display (0-100 assuming 50 is base)
    const percent = Math.min(100, Math.max(0, score));
    const color = score > 75 ? "bg-emerald-500" : score > 40 ? "bg-accent" : "bg-zinc-600";

    return (
        <div className="space-y-1">
            <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-300 font-medium">{trait}</span>
                <span className="text-zinc-500">{score.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 w-full bg-[#1a1a1a] rounded-full overflow-hidden">
                <div
                    className={`h-full ${color} transition-all duration-500`}
                    style={{ width: `${percent}%` }}
                />
            </div>
        </div>
    );
}

export default function Reinforcement() {
    const [traits, setTraits] = useState<TraitScore[]>([]);
    const [goldenExamples, setGoldenExamples] = useState<GoldenExample[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeSubTab, setActiveSubTab] = useState<"traits" | "golden">("traits");

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [t, g] = await Promise.all([
                api.listTraits().catch(() => []),
                api.listGoldenExamples().catch(() => []),
            ]);
            setTraits(t);
            setGoldenExamples(g);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load reinforcement data");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <p className="text-xs text-zinc-600">Analyzing behavior history…</p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col overflow-hidden px-4 py-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-xl font-semibold text-zinc-100 mb-1">Reinforcement</h1>
                    <p className="text-xs text-zinc-500">Adam&apos;s guided evolution and behavioral traits.</p>
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

            {/* Internal Tabs */}
            <div className="flex gap-1 mb-6 border-b border-[#1e1e1e] pb-2">
                <button
                    onClick={() => setActiveSubTab("traits")}
                    className={`px-4 py-2 rounded text-xs font-medium transition-all ${activeSubTab === "traits" ? "bg-[#1a1a1a] text-accent font-bold" : "text-zinc-500 hover:text-zinc-300"
                        }`}
                >
                    Trait Card
                </button>
                <button
                    onClick={() => setActiveSubTab("golden")}
                    className={`px-4 py-2 rounded text-xs font-medium transition-all ${activeSubTab === "golden" ? "bg-[#1a1a1a] text-accent font-bold" : "text-zinc-500 hover:text-zinc-300"
                        }`}
                >
                    Golden Examples
                </button>
            </div>

            <div className="flex-1 overflow-y-auto">
                {activeSubTab === "traits" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card title="Agent Scorecard">
                            <div className="space-y-6">
                                {traits.length === 0 ? (
                                    <p className="text-zinc-600 text-xs italic">No traits tracked yet. Interaction history required.</p>
                                ) : (
                                    traits.map((t) => (
                                        <TraitBar key={t.trait} trait={t.trait} score={t.score} />
                                    ))
                                )}
                            </div>
                        </Card>

                        <Card title="Emerging Strengths">
                            <div className="space-y-4">
                                {traits.filter(t => t.score > 80).length === 0 ? (
                                    <div className="h-32 flex items-center justify-center border border-dashed border-[#222] rounded-lg">
                                        <p className="text-[10px] text-zinc-700 uppercase tracking-tighter">No strengths identified yet</p>
                                    </div>
                                ) : (
                                    traits.filter(t => t.score > 80).map(t => (
                                        <div key={t.trait} className="flex items-center gap-3 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                            <div>
                                                <p className="text-xs font-semibold text-emerald-400">{t.trait}</p>
                                                <p className="text-[10px] text-zinc-500">Adam has consistently demonstrated high proficiency in this area.</p>
                                            </div>
                                        </div>
                                    ))
                                )}

                                <div className="mt-4 pt-4 border-t border-[#1e1e1e]">
                                    <p className="text-[10px] text-zinc-600 mb-2">HOW IT WORKS</p>
                                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                                        Trait scores grow based on positive reinforcement signals. High scores influence Adam&apos;s behavior prioritisation in future tasks.
                                    </p>
                                </div>
                            </div>
                        </Card>
                    </div>
                )}

                {activeSubTab === "golden" && (
                    <div className="space-y-4">
                        {goldenExamples.length === 0 ? (
                            <div className="h-64 flex flex-col items-center justify-center text-center">
                                <p className="text-sm text-zinc-600 mb-1">No Golden Examples Curated</p>
                                <p className="text-xs text-zinc-800 italic">Flag exemplary interactions in chat to benchmark Adam&apos;s behavior.</p>
                            </div>
                        ) : (
                            goldenExamples.map((ex) => (
                                <Card key={ex.id} className="hover:border-zinc-700 transition-colors">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-0.5 rounded-full bg-accent/10 border border-accent/30 text-[10px] text-accent font-bold uppercase tracking-wider">
                                                {ex.category}
                                            </span>
                                            <span className="text-[10px] text-zinc-600 font-mono">Session: {ex.sessionId.substring(0, 8)}...</span>
                                        </div>
                                        <span className="text-[10px] text-zinc-600">{new Date(ex.createdAt).toLocaleDateString()}</span>
                                    </div>
                                    {ex.notes && <p className="text-xs text-zinc-400 mb-2 italic">"{ex.notes}"</p>}
                                    <div className="flex justify-end">
                                        <button className="text-[10px] text-zinc-500 hover:text-accent transition-colors">View Interaction →</button>
                                    </div>
                                </Card>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
