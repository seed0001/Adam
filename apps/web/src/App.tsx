import { useState } from "react";
import Chat from "./pages/Chat";
import Memory from "./pages/Memory";
import Status from "./pages/Status";
import Settings from "./pages/Settings";
import Providers from "./pages/Providers";

type Tab = "chat" | "memory" | "providers" | "settings" | "status";

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "memory", label: "Memory" },
  { id: "providers", label: "Providers" },
  { id: "settings", label: "Settings" },
  { id: "status", label: "Status" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("chat");

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-[#1e1e1e] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-accent font-semibold tracking-wide text-sm">ADAM</span>
          <span className="text-[#3a3a3a] text-xs select-none">●</span>
        </div>

        {/* Tabs */}
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={[
                "px-3 py-1.5 rounded text-xs font-medium transition-colors",
                tab === t.id
                  ? "bg-[#1a1a1a] text-accent"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-[#141414]",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="w-16" /> {/* balance */}
      </header>

      {/* Page content */}
      <main className="flex-1 min-h-0">
        {tab === "chat" && <Chat />}
        {tab === "memory" && <Memory />}
        {tab === "providers" && <Providers />}
        {tab === "settings" && <Settings />}
        {tab === "status" && <Status />}
      </main>
    </div>
  );
}
