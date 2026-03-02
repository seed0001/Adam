import { useState, useEffect, useCallback } from "react";
import { api, type SkillSpec } from "../lib/api";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:      { label: "Draft",      color: "text-yellow-400", bg: "bg-yellow-400/10 border-yellow-400/20" },
  approved:   { label: "Approved",   color: "text-blue-400",   bg: "bg-blue-400/10 border-blue-400/20" },
  latent:     { label: "Latent",     color: "text-zinc-400",   bg: "bg-zinc-400/10 border-zinc-400/20" },
  active:     { label: "Active",     color: "text-accent",     bg: "bg-accent/10 border-accent/20" },
  deprecated: { label: "Deprecated", color: "text-zinc-600",   bg: "bg-zinc-800/30 border-zinc-700/20" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${cfg.color} ${cfg.bg}`}>
      {cfg.label}
    </span>
  );
}

function SkillDetail({ skill, onAction, onDelete, onClose }: {
  skill: SkillSpec;
  onAction: (id: string, action: "approve" | "latent" | "activate" | "deprecate") => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [acting, setActing] = useState<string | null>(null);

  const act = async (action: "approve" | "latent" | "activate" | "deprecate") => {
    setActing(action);
    try { await onAction(skill.id, action); }
    finally { setActing(null); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 pt-16 px-4 pb-8 overflow-y-auto">
      <div className="w-full max-w-2xl bg-[#0f0f0f] border border-[#242424] rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-[#1a1a1a]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-sm font-semibold text-zinc-100">{skill.displayName}</h2>
              <StatusBadge status={skill.status} />
            </div>
            <p className="text-[11px] text-zinc-500 font-mono">{skill.id}</p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg leading-none mt-0.5">×</button>
        </div>

        <div className="p-5 space-y-5 text-sm">
          {/* Description */}
          <p className="text-zinc-300 leading-relaxed">{skill.description}</p>

          {/* Triggers */}
          <section>
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium mb-2">Triggers</p>
            <div className="flex flex-wrap gap-1.5">
              {skill.triggers.map((t, i) => (
                <span key={i} className="text-xs text-zinc-400 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-0.5">"{t}"</span>
              ))}
            </div>
          </section>

          {/* Inputs */}
          {skill.inputs.length > 0 && (
            <section>
              <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium mb-2">Inputs</p>
              <div className="space-y-1.5">
                {skill.inputs.map((inp, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <code className="text-accent shrink-0">{inp.name}</code>
                    <span className="text-zinc-600">({inp.type}{inp.required ? "" : ", optional"})</span>
                    <span className="text-zinc-400">— {inp.description}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Steps */}
          <section>
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium mb-2">Steps</p>
            <ol className="space-y-1.5 list-none">
              {skill.steps.map((step, i) => (
                <li key={i} className="flex gap-2.5 text-xs text-zinc-300">
                  <span className="text-zinc-600 shrink-0 font-mono w-4 text-right">{i + 1}.</span>
                  <span className="leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* Tools allowed */}
          {skill.allowedTools.length > 0 && (
            <section>
              <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium mb-2">Allowed Tools</p>
              <div className="flex flex-wrap gap-1.5">
                {skill.allowedTools.map((t, i) => (
                  <code key={i} className="text-xs text-zinc-400 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-0.5">{t}</code>
                ))}
              </div>
            </section>
          )}

          {/* Success + Constraints */}
          <div className="grid grid-cols-2 gap-4">
            <section>
              <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium mb-2">Success When</p>
              <ul className="space-y-1">
                {skill.successCriteria.map((c, i) => (
                  <li key={i} className="text-xs text-zinc-300 flex gap-1.5"><span className="text-green-600 shrink-0">✓</span>{c}</li>
                ))}
              </ul>
            </section>
            <section>
              <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium mb-2">Must Never</p>
              <ul className="space-y-1">
                {skill.constraints.map((c, i) => (
                  <li key={i} className="text-xs text-zinc-300 flex gap-1.5"><span className="text-red-600 shrink-0">✗</span>{c}</li>
                ))}
              </ul>
            </section>
          </div>

          {/* Artifacts */}
          {skill.artifacts.length > 0 && (
            <section>
              <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium mb-2">Artifacts Produced</p>
              <div className="flex flex-wrap gap-1.5">
                {skill.artifacts.map((a, i) => (
                  <code key={i} className="text-xs text-zinc-400 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-0.5">{a}</code>
                ))}
              </div>
            </section>
          )}

          {/* Notes */}
          {skill.notes && (
            <section>
              <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium mb-2">Notes</p>
              <p className="text-xs text-zinc-400 leading-relaxed">{skill.notes}</p>
            </section>
          )}

          {/* Timestamps */}
          <p className="text-[10px] text-zinc-700">
            Created {new Date(skill.createdAt).toLocaleString()}
            {skill.approvedAt && ` · Approved ${new Date(skill.approvedAt).toLocaleString()}`}
            {skill.activatedAt && ` · Activated ${new Date(skill.activatedAt).toLocaleString()}`}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-[#1a1a1a]">
          {skill.status === "draft" && (
            <>
              <button
                onClick={() => act("approve")}
                disabled={!!acting}
                className="px-3 py-1.5 text-xs bg-blue-600/20 text-blue-400 border border-blue-600/30 rounded hover:bg-blue-600/30 transition-colors disabled:opacity-40"
              >
                {acting === "approve" ? "Approving…" : "Approve Spec"}
              </button>
              <button
                onClick={() => act("latent")}
                disabled={!!acting}
                className="px-3 py-1.5 text-xs bg-[#1a1a1a] text-zinc-400 border border-[#2a2a2a] rounded hover:text-zinc-200 transition-colors disabled:opacity-40"
              >
                {acting === "latent" ? "…" : "Mark Latent"}
              </button>
            </>
          )}
          {(skill.status === "approved" || skill.status === "latent") && (
            <button
              onClick={() => act("activate")}
              disabled={!!acting || skill.template === "none"}
              title={skill.template === "none" ? "No execution template assigned — wire one up first" : "Activate skill"}
              className="px-3 py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 rounded hover:bg-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {acting === "activate" ? "Activating…" : "Activate"}
            </button>
          )}
          {skill.status !== "deprecated" && (
            <button
              onClick={() => act("deprecate")}
              disabled={!!acting}
              className="ml-auto px-3 py-1.5 text-xs text-zinc-600 border border-[#1e1e1e] rounded hover:border-red-900/40 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              Deprecate
            </button>
          )}
          <button
            onClick={() => void onDelete(skill.id)}
            disabled={!!acting}
            className="px-3 py-1.5 text-xs text-zinc-700 hover:text-red-500 transition-colors disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function SkillCard({ skill, onClick }: { skill: SkillSpec; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-[#0d0d0d] border border-[#1e1e1e] rounded-xl p-4 hover:border-[#2a2a2a] hover:bg-[#111] transition-colors group"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">{skill.displayName}</p>
        <StatusBadge status={skill.status} />
      </div>
      <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2 mb-3">{skill.description}</p>
      <div className="flex items-center gap-3 text-[10px] text-zinc-700">
        <span>{skill.allowedTools.length} tool{skill.allowedTools.length !== 1 ? "s" : ""}</span>
        <span>·</span>
        <span>{skill.steps.length} step{skill.steps.length !== 1 ? "s" : ""}</span>
        <span>·</span>
        <span>{new Date(skill.updatedAt).toLocaleDateString()}</span>
      </div>
    </button>
  );
}

const STATUS_ORDER = ["draft", "approved", "active", "latent", "deprecated"] as const;

export default function Skills() {
  const [skills, setSkills] = useState<SkillSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SkillSpec | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    try {
      const data = await api.listSkills();
      setSkills(data);
    } catch {
      // daemon not running
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleAction = async (id: string, action: "approve" | "latent" | "activate" | "deprecate") => {
    const updated = await api.skillAction(id, action);
    setSkills((prev) => prev.map((s) => s.id === id ? updated.skill : s));
    setSelected(updated.skill);
  };

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Delete this skill spec? This cannot be undone.")) return;
    await api.deleteSkill(id);
    setSkills((prev) => prev.filter((s) => s.id !== id));
    setSelected(null);
  }, []);

  const statusCounts = skills.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});

  const visible = filter === "all" ? skills : skills.filter((s) => s.status === filter);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#1a1a1a] shrink-0">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Skill Workshop</h2>
          <p className="text-[10px] text-zinc-600 mt-0.5">
            {skills.length === 0 ? "No skills yet" : `${skills.length} skill${skills.length !== 1 ? "s" : ""}`}
            {skills.filter((s) => s.status === "draft").length > 0 && (
              <span className="text-yellow-500 ml-1">· {skills.filter((s) => s.status === "draft").length} awaiting review</span>
            )}
          </p>
        </div>
        <p className="text-[10px] text-zinc-600 max-w-[220px] text-right leading-relaxed">
          Tell Adam "let's design a skill" in chat to start a workshop session.
        </p>
      </div>

      {/* Filter bar */}
      {skills.length > 0 && (
        <div className="flex gap-1 px-5 py-2.5 border-b border-[#141414] shrink-0">
          {(["all", ...STATUS_ORDER] as const).map((s) => {
            const count = s === "all" ? skills.length : (statusCounts[s] ?? 0);
            if (s !== "all" && count === 0) return null;
            return (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={[
                  "px-2.5 py-1 rounded text-[11px] font-medium transition-colors",
                  filter === s
                    ? "bg-[#1a1a1a] text-zinc-200"
                    : "text-zinc-600 hover:text-zinc-400",
                ].join(" ")}
              >
                {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                <span className="ml-1 text-zinc-700">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-600 text-sm">Loading…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 select-none text-center px-8">
            <div className="w-12 h-12 rounded-xl bg-[#111] border border-[#222] flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 3v14M3 10h14" stroke="#3a3a3a" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <p className="text-zinc-500 text-sm">No skills here yet.</p>
            <p className="text-zinc-700 text-xs max-w-[280px]">
              In Chat, say something like "let's design a skill — I want it to scaffold a new Node project."
              Adam will draft the spec. You review and approve it here.
            </p>
          </div>
        ) : (
          <div className="p-5 grid grid-cols-1 gap-3">
            {visible.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onClick={() => setSelected(skill)} />
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <SkillDetail
          skill={selected}
          onAction={handleAction}
          onDelete={handleDelete}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
