import { useState, useEffect, useRef } from "react";
import ThoughtStream, { type AgentEvent, type AgentEventType } from "./ThoughtStream";

export default function ContextWindow({ sessionId }: { sessionId: string }) {
    const [events, setEvents] = useState<AgentEvent[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!sessionId) return;

        setEvents([]); // Clear events on session change

        const eventSource = new EventSource(`/api/chat/events/${sessionId}`);

        eventSource.onmessage = (e) => {
            try {
                const event = JSON.parse(e.data) as AgentEvent;
                setEvents((prev) => [...prev, event]);
            } catch (err) {
                console.error("Failed to parse agent event", err);
            }
        };

        eventSource.onerror = (err) => {
            console.error("EventSource failed", err);
            eventSource.close();
        };

        return () => {
            eventSource.close();
        };
    }, [sessionId]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, [events]);

    const getEventIcon = (type: AgentEventType) => {
        switch (type) {
            case "thought": return "🧠";
            case "tool-call": return "🛠️";
            case "tool-result": return "✅";
            case "status": return "📡";
            case "error": return "❌";
            case "memory": return "💾";
            case "context": return "🧩";
            default: return "●";
        }
    };

    const getEventColor = (type: AgentEventType) => {
        switch (type) {
            case "thought": return "text-purple-400";
            case "tool-call": return "text-blue-400";
            case "tool-result": return "text-green-400";
            case "status": return "text-zinc-400";
            case "error": return "text-red-400";
            case "memory": return "text-amber-400";
            case "context": return "text-cyan-400";
            default: return "text-zinc-600";
        }
    };

    const contextEvents = events.filter(ev =>
        ev.type === "memory" ||
        ev.type === "context" ||
        ev.type === "status"
    );

    return (
        <div className="flex flex-col h-full bg-[#0d0d0d] border-l border-[#1e1e1e] w-80 shrink-0">
            <ThoughtStream events={events} />

            <div className="px-4 py-3 border-b border-[#1e1e1e] flex items-center justify-between bg-[#0f0f0f]">
                <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Cognitive Context</h3>
                <span className="text-[10px] text-zinc-600 font-mono">{sessionId.slice(0, 8)}</span>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                {contextEvents.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full opacity-20 select-none">
                        <span className="text-4xl mb-2">🧠</span>
                        <p className="text-xs text-center">Waiting for cognitive updates...</p>
                    </div>
                )}

                {contextEvents.map((ev, i) => (
                    <div key={i} className="space-y-1">
                        <div className="flex items-center gap-2">
                            <span className="text-xs">{getEventIcon(ev.type)}</span>
                            <span className={`text-[10px] font-bold uppercase ${getEventColor(ev.type)}`}>
                                {ev.type}
                            </span>
                            <span className="text-[9px] text-zinc-700 ml-auto">
                                {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                            </span>
                        </div>
                        <div className="bg-[#141414] border border-[#1e1e1e] rounded p-2 text-[11px] text-zinc-300 leading-relaxed font-mono break-words">
                            {ev.message}
                            {ev.data && ev.type === "memory" && (
                                <div className="mt-1 pt-1 border-t border-[#1e1e1e] text-[9px] text-zinc-500 overflow-hidden">
                                    {ev.data.key}: {ev.data.value}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
