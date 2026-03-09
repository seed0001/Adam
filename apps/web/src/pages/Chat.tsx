import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";
import ContextWindow from "../components/ContextWindow";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: Date;
  /** Base64 audio for assistant voice responses */
  audioBase64?: string;
  audioMimeType?: string;
};


function getSessionId(): string {
  const KEY = "adam_session_id";
  const stored = sessionStorage.getItem(KEY);
  if (stored) return stored;
  const id = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  sessionStorage.setItem(KEY, id);
  return id;
}

function formatContent(text: string): React.ReactNode[] {
  // Split on code fences (```...```)
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith("```")) {
      const lines = part.slice(3).trimStart();
      const firstNewline = lines.indexOf("\n");
      const lang = firstNewline > 0 ? lines.slice(0, firstNewline).trim() : "";
      const code = firstNewline > 0 ? lines.slice(firstNewline + 1) : lines;
      const cleaned = code.endsWith("```") ? code.slice(0, -3) : code;
      return (
        <pre key={i}>
          {lang && <span className="text-[#64748b] text-xs block mb-1">{lang}</span>}
          <code>{cleaned.trimEnd()}</code>
        </pre>
      );
    }
    // Inline code
    const inlineParts = part.split(/(`[^`]+`)/g);
    return (
      <span key={i}>
        {inlineParts.map((p, j) =>
          p.startsWith("`") && p.endsWith("`") ? (
            <code key={j}>{p.slice(1, -1)}</code>
          ) : (
            <span key={j} style={{ whiteSpace: "pre-wrap" }}>{p}</span>
          ),
        )}
      </span>
    );
  });
}

function MsgBubble({ msg, agentName, avatarBase64 }: { msg: Message; agentName: string; avatarBase64: string | null }) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%]">
          <div className="bg-[#0f2a2a]/90 backdrop-blur-md border border-[#1a3a3a]/80 rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm text-zinc-200 leading-relaxed shadow-lg">
            {msg.content}
          </div>
          <p className="text-right text-[10px] text-zinc-600 mt-1 pr-1">
            {msg.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-6 h-6 rounded-full overflow-hidden border border-[#2a2a2a] shadow-inner mt-1">
        <img src={avatarBase64 ? `data:image/png;base64,${avatarBase64}` : "/avatar.png"} alt="Adam" className="w-full h-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-accent font-medium mb-1">{agentName}</p>
        <div className="bg-[#111111]/90 backdrop-blur-md border border-[#1e1e1e]/80 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-zinc-200 leading-relaxed msg-content shadow-lg">
          {formatContent(msg.content)}
        </div>
        {msg.audioBase64 && (
          <div className="mt-2 pl-1">
            <audio
              controls
              autoPlay
              src={`data:${msg.audioMimeType || "audio/mpeg"};base64,${msg.audioBase64}`}
              className="w-full max-w-sm h-8"
            />
          </div>
        )}
        <p className="text-[10px] text-zinc-600 mt-1 pl-1">
          {msg.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

function TypingIndicator({ agentName, avatarBase64 }: { agentName: string; avatarBase64: string | null }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-6 h-6 rounded-full overflow-hidden border border-[#2a2a2a] shadow-inner mt-1">
        <img src={avatarBase64 ? `data:image/png;base64,${avatarBase64}` : "/avatar.png"} alt="Adam" className="w-full h-full object-cover" />
      </div>
      <div>
        <p className="text-[11px] text-accent font-medium mb-1">{agentName}</p>
        <div className="bg-[#111111]/90 backdrop-blur-md border border-[#1e1e1e]/80 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1.5 items-center shadow-lg">
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-zinc-500 block" />
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-zinc-500 block" />
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-zinc-500 block" />
        </div>
      </div>
    </div>
  );
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [agentName, setAgentName] = useState("Adam");
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backgroundBase64, setBackgroundBase64] = useState<string | null>(null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const sessionId = useRef(getSessionId());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.getStatus().then((s) => {
      setAgentName(s.agentName);
      const model = s.activeModels?.capable ?? s.activeModels?.fast ?? null;
      setActiveModel(model);
    }).catch(() => { });
  }, []);

  useEffect(() => {
    api.getChatBackground(sessionId.current).then((r) => {
      if (r?.backgroundBase64) setBackgroundBase64(r.backgroundBase64);
    });
    api.getAvatar().then((r) => {
      if (r?.avatarBase64) setAvatarBase64(r.avatarBase64);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setError(null);
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role: "user", content: text, ts: new Date() },
    ]);
    setLoading(true);

    try {
      const res = await api.chat(text, sessionId.current);
      sessionId.current = res.sessionId;
      if (res.backgroundBase64) setBackgroundBase64(res.backgroundBase64);

      // Re-fetch avatar in case generate_avatar tool was called
      api.getAvatar().then(r => {
        if (r?.avatarBase64) setAvatarBase64(r.avatarBase64);
      });

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: res.response,
          ts: new Date(),
          audioBase64: res.audioBase64,
          audioMimeType: res.audioMimeType,
        },

      ]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, loading]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  };

  const bgStyle = backgroundBase64
    ? { backgroundImage: `url(data:image/png;base64,${backgroundBase64})` }
    : undefined;

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col h-full relative border-r border-[#1e1e1e]">
        {/* Background layer */}
        {backgroundBase64 && (
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-30"
            style={bgStyle}
            aria-hidden
          />
        )}
        {backgroundBase64 && (
          <div
            className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/70"
            aria-hidden
          />
        )}
        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 relative z-10">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full gap-2 select-none">
              <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-accent/30 shadow-2xl mb-2">
                <img src={avatarBase64 ? `data:image/png;base64,${avatarBase64}` : "/avatar.png"} alt="Adam" className="w-full h-full object-cover" />
              </div>
              <p className="text-zinc-500 text-sm">{agentName} is ready.</p>
              {activeModel && (
                <p className="text-zinc-700 text-xs font-mono">{activeModel}</p>
              )}
              <p className="text-zinc-700 text-xs mt-1">Shift+Enter for new line</p>
              <p className="text-zinc-600 text-[10px] mt-0.5">
                Ask Adam to change the background (e.g. &quot;set a cozy café background&quot;)
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <MsgBubble key={msg.id} msg={msg} agentName={agentName} avatarBase64={avatarBase64} />
          ))}

          {loading && <TypingIndicator agentName={agentName} avatarBase64={avatarBase64} />}

          {error && (
            <div className="flex justify-center">
              <p className="text-red-400 text-xs bg-red-950/30 border border-red-900/40 rounded px-3 py-1.5">
                {error}
              </p>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="shrink-0 px-4 pb-4">
          <div className="flex items-end gap-2 bg-[#111111]/90 backdrop-blur-md border border-[#242424]/80 rounded-2xl px-4 py-3 focus-within:border-[#333333] transition-colors shadow-lg relative z-10">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKey}
              placeholder="Message Adam…"
              rows={1}
              disabled={loading}
              className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 resize-none outline-none leading-relaxed min-h-[22px] max-h-[160px] disabled:opacity-50"
            />
            <button
              onClick={() => void send()}
              disabled={!input.trim() || loading}
              className="shrink-0 w-7 h-7 rounded-lg bg-accent disabled:bg-[#1e1e1e] flex items-center justify-center transition-colors mb-0.5"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2 11L11 2M11 2H4.5M11 2V8.5" stroke={!input.trim() || loading ? "#3a3a3a" : "#0a0a0a"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <div className="flex items-center justify-between mt-2 px-1">
            <p className="text-[10px] text-zinc-700">
              File system · shell access. Confirm before destructive actions.
            </p>
            {activeModel && (
              <p className="text-[10px] text-zinc-600 font-mono">{activeModel}</p>
            )}
          </div>
        </div>
      </div>
      <ContextWindow sessionId={sessionId.current} />
    </div>
  );
}
