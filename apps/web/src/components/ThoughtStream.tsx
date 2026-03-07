import { useRef, useEffect } from "react";

export type AgentEventType = "thought" | "tool-call" | "tool-result" | "status" | "error" | "memory" | "context";

export interface AgentEvent {
    sessionId: string;
    type: AgentEventType;
    message: string;
    data?: any;
    timestamp: string;
}

interface ThoughtStreamProps {
    events: AgentEvent[];
}

export default function ThoughtStream({ events }: ThoughtStreamProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const thoughts = events.filter(ev =>
        ev.type === "thought" ||
        ev.type === "status" ||
        ev.type === "tool-call" ||
        ev.type === "tool-result" ||
        ev.type === "error"
    );

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [thoughts]);

    const handleExport = () => {
        const text = thoughts
            .map(t => `[${new Date(t.timestamp).toLocaleTimeString()}] ${t.type.toUpperCase()}: ${t.message}`)
            .join("\n");
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `thoughts-${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="flex flex-col h-64 bg-[#0a0a0a] border-b border-[#1e1e1e]">
            <div className="px-4 py-2 border-b border-[#1e1e1e] flex items-center justify-between bg-[#0f0f0f]">
                <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                    </span>
                    <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Live Thought Stream</h3>
                </div>
                <button
                    onClick={handleExport}
                    className="text-[9px] text-zinc-500 hover:text-zinc-300 transition-colors uppercase font-bold"
                >
                    Export
                </button>
            </div>
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed space-y-2 scroll-smooth"
            >
                {thoughts.length === 0 ? (
                    <div className="h-full flex items-center justify-center opacity-20 italic text-[10px]">
                        Waiting for thoughts...
                    </div>
                ) : (
                    thoughts.map((t, i) => (
                        <div key={i} className="text-zinc-400">
                            <span className="text-purple-500/60 mr-2">»</span>
                            {t.message}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
