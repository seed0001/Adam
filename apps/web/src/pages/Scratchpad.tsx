import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";

function parseSection(content: string, heading: string): string[] {
  const regex = new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##|\\n---\\s*\\n\\*Updated|$)`, "i");
  const match = content.match(regex);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function parseTopic(content: string): string {
  const regex = /##\s+Topic\s*\n([\s\S]*?)(?=\n##|$)/i;
  const match = content.match(regex);
  if (!match) return "";
  return match[1].trim();
}

function parseLastUpdated(content: string): string | null {
  const match = content.match(/\*Updated (.+?)\*/);
  return match ? match[1] : null;
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 select-none text-center px-8">
      <div className="w-12 h-12 rounded-xl bg-[#111] border border-[#222] flex items-center justify-center">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="3" y="2" width="14" height="16" rx="2" stroke="#3a3a3a" strokeWidth="1.5"/>
          <path d="M6 7h8M6 10h8M6 13h5" stroke="#3a3a3a" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
      <p className="text-zinc-500 text-sm">Nothing here yet.</p>
      <p className="text-zinc-700 text-xs max-w-[280px]">
        After a few exchanges, Adam will start jotting down the current topic, stray ideas, and open questions.
      </p>
    </div>
  );
}

export default function Scratchpad() {
  const [content, setContent] = useState<string | null>(null);
  const [lastModified, setLastModified] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getScratchpad();
      setContent(data.content);
      setLastModified(data.lastModified);
    } catch {
      // daemon not running — stay empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Poll every 12 seconds — scratchpad updates are fire-and-forget after responses
    pollRef.current = setInterval(() => { void load(); }, 12000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  const startEdit = () => {
    setDraft(content ?? "");
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.patchScratchpad(draft);
      setContent(draft);
      setEditing(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!confirm("Clear the scratchpad? Adam will start fresh.")) return;
    setClearing(true);
    try {
      await api.clearScratchpad();
      setContent(null);
      setLastModified(null);
    } finally {
      setClearing(false);
    }
  };

  const topic = content ? parseTopic(content) : null;
  const ideas = content ? parseSection(content, "Ideas") : [];
  const questions = content ? parseSection(content, "Questions") : [];
  const updatedAt = lastModified
    ? new Date(lastModified).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : content ? parseLastUpdated(content) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-zinc-600 text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#1a1a1a] shrink-0">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Scratchpad</h2>
          {updatedAt && (
            <p className="text-[10px] text-zinc-600 mt-0.5">Last updated {updatedAt}</p>
          )}
        </div>
        <div className="flex gap-2">
          {content && !editing && (
            <>
              <button
                onClick={startEdit}
                className="px-3 py-1 text-xs text-zinc-400 border border-[#242424] rounded hover:border-[#333] hover:text-zinc-200 transition-colors"
              >
                Edit
              </button>
              <button
                onClick={clear}
                disabled={clearing}
                className="px-3 py-1 text-xs text-zinc-600 border border-[#1e1e1e] rounded hover:border-red-900/40 hover:text-red-400 transition-colors disabled:opacity-40"
              >
                Clear
              </button>
            </>
          )}
          {editing && (
            <>
              <button
                onClick={save}
                disabled={saving}
                className="px-3 py-1 text-xs bg-accent text-black rounded hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1 text-xs text-zinc-500 border border-[#242424] rounded hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {editing ? (
          <div className="p-5 h-full">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full h-full min-h-[300px] bg-[#0d0d0d] border border-[#242424] rounded-lg p-4 text-sm text-zinc-200 font-mono resize-none outline-none focus:border-[#333] transition-colors leading-relaxed"
              placeholder="## Topic&#10;&#10;## Ideas&#10;-&#10;&#10;## Questions&#10;-"
              spellCheck={false}
            />
          </div>
        ) : !content ? (
          <EmptyState />
        ) : (
          <div className="p-5 space-y-6">
            {/* Topic */}
            {topic && (
              <section>
                <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-medium mb-2">Current Topic</p>
                <p className="text-zinc-200 text-sm leading-relaxed pl-3 border-l border-accent/30">
                  {topic}
                </p>
              </section>
            )}

            {/* Ideas */}
            {ideas.length > 0 && (
              <section>
                <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-medium mb-2">Ideas</p>
                <ul className="space-y-1.5">
                  {ideas.map((idea, i) => (
                    <li key={i} className="flex gap-2 text-sm text-zinc-300">
                      <span className="text-zinc-700 shrink-0 mt-0.5">◇</span>
                      <span className="leading-relaxed">{idea}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Questions */}
            {questions.length > 0 && (
              <section>
                <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-medium mb-2">Questions</p>
                <ul className="space-y-1.5">
                  {questions.map((q, i) => (
                    <li key={i} className="flex gap-2 text-sm text-zinc-300">
                      <span className="text-zinc-700 shrink-0 mt-0.5">?</span>
                      <span className="leading-relaxed">{q}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Raw fallback — if parsing finds nothing structured, show raw */}
            {!topic && ideas.length === 0 && questions.length === 0 && (
              <pre className="text-zinc-400 text-xs font-mono whitespace-pre-wrap leading-relaxed">
                {content}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
