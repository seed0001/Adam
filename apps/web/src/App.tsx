import { useState } from "react";
import Chat from "./pages/Chat";
import Memory from "./pages/Memory";
import Status from "./pages/Status";
import Settings from "./pages/Settings";
import Providers from "./pages/Providers";
import Scratchpad from "./pages/Scratchpad";
import Skills from "./pages/Skills";
import Voices from "./pages/Voices";
import Diagnostics from "./pages/Diagnostics";
import Patches from "./pages/Patches";
import Reinforcement from "./pages/Reinforcement";

type Tab = "chat" | "memory" | "scratchpad" | "skills" | "voices" | "providers" | "settings" | "status" | "diagnostics" | "patches" | "reinforcement";

const TABS: { id: Tab; label: string; icon?: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "patches", label: "Patch Queue" },
  { id: "reinforcement", label: "Reinforcement" },
  { id: "memory", label: "Memory" },
  { id: "scratchpad", label: "Scratch Pad" },
  { id: "skills", label: "Skills" },
  { id: "voices", label: "Voices" },
  { id: "providers", label: "Providers" },
  { id: "settings", label: "Settings" },
  { id: "status", label: "Status" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("chat");

  return (
    <div className="flex h-full bg-[#0a0a0a] overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex flex-col bg-[#0d0d0d] border-r border-[#1e1e1e] shrink-0 z-10">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center border border-accent/20">
              <span className="text-accent font-bold text-xs">A</span>
            </div>
            <span className="text-zinc-100 font-bold tracking-widest text-sm">ADAM</span>
          </div>

          <nav className="flex flex-col gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={[
                  "w-full text-left px-4 py-2.5 rounded-lg text-xs font-semibold transition-all duration-200 group flex items-center gap-3",
                  tab === t.id
                    ? "bg-accent/10 text-accent border border-accent/20"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-[#141414] border border-transparent",
                ].join(" ")}
              >
                <div className={[
                  "w-1 h-1 rounded-full transition-all duration-300",
                  tab === t.id ? "bg-accent scale-100" : "bg-transparent scale-0 group-hover:scale-100 group-hover:bg-zinc-600"
                ].join(" ")} />
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-auto px-6 py-6 border-t border-[#1e1e1e]/50">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">System Active</span>
          </div>
        </div>
      </aside>

      {/* Page content */}
      <main className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-gradient-to-br from-[#0a0a0a] to-[#0d0d0d]">
        <div className="flex-1 overflow-hidden">
          {tab === "chat" && <Chat />}
          {tab === "memory" && <Memory />}
          {tab === "scratchpad" && <Scratchpad />}
          {tab === "skills" && <Skills />}
          {tab === "voices" && <Voices />}
          {tab === "providers" && <Providers />}
          {tab === "settings" && <Settings />}
          {tab === "status" && <Status />}
          {tab === "diagnostics" && <Diagnostics />}
          {tab === "patches" && <Patches />}
          {tab === "reinforcement" && <Reinforcement />}
        </div>
      </main>
    </div>
  );
}
