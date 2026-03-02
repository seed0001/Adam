# Adam

**A self-hosted autonomous AI agent that lives on your machine.**

Adam is not a chatbot. It is a persistent digital entity with layered memory, full tool access, a structured reasoning loop, a web dashboard, and messaging adapters — running entirely on your hardware, under your control.

No cloud dependency by default. No subscription. No data leaving your machine unless you choose a cloud model provider.

---

## Project Overview

Most "AI agents" are thin wrappers around a single LLM call with a system prompt. Adam is built with more depth: a software entity that persists, remembers, reasons across multiple steps, designs capabilities, and improves its understanding of the person it works with over time.

The architecture is organized around a set of core ideas:

**Memory with a lifecycle.** Adam's profile memory is inspired by neural cellular automata — facts that get used in conversations are reinforced, facts that go unreferenced decay exponentially and eventually die. You control what's immortal. This isn't a journal; it's a living model of who you are and how you work.

**A reasoning loop, not a single call.** Every message goes through `Classify → Plan → Execute → Observe`. Simple questions get fast direct answers. Complex requests get broken into a task DAG with dependency ordering. Tool calls happen within the execution phase, not as an afterthought.

**Division of labor between models.** The cloud model (Grok, GPT-4o, Claude) acts as the senior engineer — it plans, decomposes, reviews, and directs. A local coder model (DeepSeek Coder V2, Qwen2.5-Coder) acts as the fast, tireless junior — it writes code, edits files, and executes implementation steps without reasoning about goals. The cloud model never touches the filesystem directly. The local model never decides architecture.

**A Skill Workshop, not a skill executor.** Adam can design new capabilities in collaboration with you, but it cannot execute them until you approve them. The workflow is: Adam drafts a structured skill spec (triggers, inputs, tools, steps, constraints, success criteria), you review it, then either wire it up or store it as a latent capability. No self-modifying agent loops. No unreviewed code execution.

**Security as a first-class constraint.** No credential ever touches a config file. API keys live in the OS keychain (Windows Credential Manager / macOS Keychain / Linux libsecret) with AES-256-GCM encrypted file fallback. Every action goes into an append-only audit log.

**One agent, multiple surfaces.** The same agent instance handles terminal chat, Discord, Telegram, and the web dashboard simultaneously. What it learns in one context carries into the others.

---

## What's built

| Capability | Status |
|---|---|
| Interactive terminal chat (`adam chat`) | ✅ |
| Always-on daemon (`adam start` / `adam stop`) | ✅ |
| Web dashboard — chat, memory, status, settings, providers, scratchpad, skills | ✅ |
| 4-layer SQLite memory (episodic, semantic, profile, working) | ✅ |
| Memory decay + reinforcement (Neural CA-inspired lifecycle) | ✅ |
| Stochastic memory consolidation — old episodes → durable profile facts | ✅ |
| Cross-session context — past conversations seeded into each new session | ✅ |
| Personality profile — evolves through conversation, injected every turn | ✅ |
| Time awareness — live date, time of day, session duration in every prompt | ✅ |
| Configurable decay rate (half-life, min confidence) | ✅ |
| Autonomous scratchpad — Adam notes current topic, ideas, open questions | ✅ |
| Skill Workshop — design skills collaboratively, review before execution | ✅ |
| Skill lifecycle — draft → approved → latent → active → deprecated | ✅ |
| Division-of-labor code tools — cloud model plans, local coder implements | ✅ |
| Tool use — web fetch, file R/W, shell, directory listing | ✅ |
| Model-backed code tools — code_write_file, code_edit_file, code_scaffold, code_review | ✅ |
| Multi-provider model router — cloud, local, HuggingFace | ✅ |
| Dedicated coder model tier (DeepSeek Coder, Qwen2.5-Coder via Ollama) | ✅ |
| Budget caps with local fallback | ✅ |
| OS keychain credential storage | ✅ |
| Append-only audit log | ✅ |
| Discord adapter — channel filtering, rate limiting, slash commands | ✅ |
| Telegram adapter | ✅ |
| Discord outbound tools — Adam can post to Discord on request | ✅ |
| Provider management via web UI | ✅ |
| xAI (Grok-3, Grok-3-fast) integration | ✅ |
| Voice synthesis (LuxTTS) | ✅ |
| Automated voice sidecar setup | ✅ |
| Semantic vector search (sqlite-vec) | 🔜 |
| MCP (Model Context Protocol) support | 🔜 |
| Scheduled tasks | 🔜 |

---

## Quick start

**Prerequisites:** Node.js ≥ 22, pnpm ≥ 10

```bash
git clone https://github.com/seed0001/Adam.git
cd Adam
pnpm install
pnpm build
```

Link the CLI globally:

```bash
cd packages/cli
pnpm link --global
cd ../..
```

Configure Adam (interactive wizard):

```bash
adam init
```

Start chatting immediately — no daemon required:

```bash
adam chat
```

Or start the always-on daemon with the web dashboard:

```bash
adam start
```

Then open **http://localhost:18800** in your browser.

---

## CLI commands

```
adam init              — Interactive setup wizard (providers, adapters, budget)
adam chat              — Start a terminal chat session
adam start             — Start the daemon in the background
adam stop              — Stop the running daemon
adam status            — Show daemon status, active adapters, model pool, memory stats
adam voice             — Voice chat session (requires LuxTTS sidecar)
```

### In-session commands (`adam chat`)

```
/help                      — show commands
/memory                    — show profile memory with health bars and decay status
/memory decay <days>       — set memory decay half-life (e.g. /memory decay 14)
/memory min <pct>          — set minimum confidence before pruning (e.g. /memory min 10)
/remember <key> = <val>    — manually store a fact (protected, never decays)
/forget <key>              — delete a specific memory
/forget all                — clear all profile memory
/protect <key>             — lock a memory so it never decays
/unprotect <key>           — let a memory decay naturally again
/personality               — view Adam's personality profile
/personality reset         — reset to defaults
/pad                       — view Adam's current scratchpad (topic, ideas, questions)
/pad clear                 — clear the scratchpad
/workshop                  — list all skill specs by status
/workshop show <id>        — view a skill spec in full
/workshop approve <id>     — approve a draft skill spec
/workshop latent <id>      — mark a skill as latent (stored, not yet wired)
/workshop deprecate <id>   — deprecate a skill
/clear                     — clear the screen
/exit                      — end the session
```

---

## Providers

`adam init` walks you through provider setup. You need at least one.

**Local (free, private)**
- [Ollama](https://ollama.com) — `ollama pull llama3.2` then enable in init
- [LM Studio](https://lmstudio.ai) — local model inference with OpenAI-compatible endpoint
- [vLLM](https://github.com/vllm-project/vllm) — high-throughput local serving

**Cloud (API key required)**
- [xAI](https://console.x.ai) — Grok-3, Grok-3-fast
- [Anthropic](https://console.anthropic.com) — Claude 3.5 / 3.7
- [OpenAI](https://platform.openai.com) — GPT-4o and later
- [Google](https://aistudio.google.com) — Gemini models
- [Mistral](https://console.mistral.ai) — Mistral and Codestral
- [DeepSeek](https://platform.deepseek.com) — cost-efficient reasoning models
- [Groq](https://console.groq.com) — fast inference for open-source models
- [OpenRouter](https://openrouter.ai) — unified gateway to 200+ models

API keys are stored in your OS keychain — never written to disk or any config file.

Provider configuration, model selection, and key management are all available in the **Providers** tab of the web dashboard.

---

## Division of labor: cloud planner + local coder

When you ask Adam to build something, two models work in sequence — each doing only what it's good at.

```
You ask Adam to build something
         ↓
Cloud model (Grok / GPT-4o / Claude) — senior engineer
  - writes the objective
  - breaks it into steps
  - decides file structure
  - calls code tools with structured instructions
         ↓
Local coder model (DeepSeek Coder V2 / Qwen2.5-Coder) — fast junior with root access
  - reads existing files if needed
  - implements exactly what it's told
  - writes the file, returns diff / preview
         ↓
Cloud model reviews the output
  - evaluates correctness via code_review
  - adjusts plan
  - issues the next instruction
```

The cloud model never touches the filesystem directly. The local model never decides architecture. This is how serious autonomous systems are built.

**Code tools available to Adam:**

| Tool | What it does |
|---|---|
| `code_write_file` | You describe what a file should do → local coder writes it |
| `code_edit_file` | You describe the change → local coder edits it, returns diff |
| `code_scaffold` | You provide a project spec and file list → local coder generates all files |
| `code_review` | Ask a targeted question about a file → local coder answers it |

**Setting up the coder model:**

```bash
ollama pull deepseek-coder-v2
```

Then in the web dashboard → Providers → Ollama → set the **Coder** field to `deepseek-coder-v2` and save.

If no coder model is configured, these tools fall back to your capable model automatically.

---

## Memory

Adam's memory has four layers:

| Layer | What it stores | Persistence |
|---|---|---|
| **Episodic** | Timestamped conversation turns, sourced by session | SQLite, retained per config |
| **Semantic** | Vector embeddings for similarity search | SQLite + sqlite-vec |
| **Profile** | Facts about you — name, tools, preferences, goals | SQLite, versioned with full history |
| **Working** | Current context window contents | In-process, per session |

### Memory lifecycle (Neural CA-inspired)

Profile memory isn't static. It behaves more like a living system:

- **Reinforcement** — every fact Adam injects into a prompt gets a confidence boost. Facts that actively shape responses stay healthy.
- **Decay** — auto-extracted facts lose confidence exponentially over time. Half-life is 30 days by default, configurable per session (`/memory decay <days>`).
- **Protection** — facts you enter manually via `/remember` are always protected. Use `/protect <key>` to lock any fact permanently.
- **Consolidation** — a stochastic background process (no global clock — fires at random intervals) periodically runs an LLM pass over old episodic sessions and extracts durable facts into the profile. Old experience doesn't disappear; it condenses.

The `/memory` command shows this visually: health bars, confidence percentages, source badges, and how long ago each fact was last used.

---

## Scratchpad

Adam maintains an autonomous scratchpad at `~/.adam/scratchpad.md`. After conversations, Adam updates it with:

- **Current topic** — what you're working on right now
- **Ideas** — things Adam is thinking about, not necessarily related to the current topic
- **Questions** — open questions Adam has

View it any time with `/pad` in terminal chat, or in the **Scratch Pad** tab of the web dashboard. You can also edit it manually from the web UI.

The scratchpad is Adam's working memory at a higher abstraction level than per-session episodic storage. It persists across sessions and isn't part of the prompt — it's Adam's own space.

---

## Skill Workshop

Adam can design new capabilities in collaboration with you, but it cannot execute them until you explicitly approve them.

**The conversation looks like this:**

> You: "Let's design a skill to initialize a coding project."
>
> Adam switches into skill-design mode, not execution mode.
>
> Adam drafts a structured spec — what triggers it, what inputs it expects, what tools it's allowed to use, what files it creates, what success looks like, what it must never do.
>
> You review the spec and approve it, mark it latent, or send it back for revision.

**Skill status lifecycle:**

```
draft → approved → latent → active → deprecated
```

- `draft` — Adam generated this spec, not yet reviewed
- `approved` — you've confirmed the spec is correct
- `latent` — stored as a capability Adam can describe but not execute
- `active` — wired up and executable
- `deprecated` — no longer used

**What Adam cannot do in the Skill Workshop:**
- Write raw executable code directly into the skill registry
- Register skills without review
- Modify core agent logic
- Change tool permissions dynamically

Skill specs are stored as JSON files in `~/.adam/skills/` and are fully editable. The **Skills** tab in the web dashboard shows all specs with lifecycle controls.

---

## Personality

Adam has a personality profile stored at `~/.adam/personality.md`. It's injected into every prompt.

The profile evolves through conversation. If you tell Adam to be more direct, less formal, or to stop doing something — it detects the intent and updates the file. You can also edit it directly. `/personality` shows the current profile. `/personality reset` restores defaults.

This isn't a static system prompt. It's a living document that drifts toward what you actually want.

---

## Web dashboard

Start the daemon (`adam start`) and open **http://localhost:18800**.

| Tab | What's there |
|---|---|
| **Chat** | Full chat interface backed by the same agent as terminal, shows active model |
| **Memory** | Browse and manage all profile facts, confidence levels, protection status |
| **Status** | Daemon health, active adapters, model pool, resource usage |
| **Settings** | Agent name, system prompt, Discord configuration, budget limits, personality editor, memory decay config |
| **Providers** | Enable/disable providers, set fast/capable/coder models, manage API keys and adapter tokens |
| **Scratch Pad** | View and edit Adam's autonomous scratchpad in real time |
| **Skills** | View all skill specs, filter by status, manage lifecycle transitions |

---

## Architecture

```
adam/
├── apps/
│   ├── daemon/          # Always-on process: REST API, adapter host, consolidator
│   └── web/             # React 18 dashboard (Vite + Tailwind)
└── packages/
    ├── cli/             # adam init · chat · start · stop · status · voice
    ├── core/            # Agent loop · Classifier · Planner · Executor · SkillWorkshop · ScratchpadStore
    ├── memory/          # EpisodicStore · ProfileStore · WorkingMemory · encryption
    ├── models/          # ProviderRegistry (fast/capable/coder/embedding tiers) · ModelRouter · cost tracking
    ├── security/        # CredentialVault · AuditLog · PermissionRegistry
    ├── skills/          # Built-in tools · model-backed code tools · SkillSchema · SkillStore
    ├── adapters/        # CLI · Telegram · Discord (slash commands, channel filtering)
    ├── voice/           # LuxTTS sidecar · VoiceRegistry · character sandbox
    └── shared/          # Config schema · types · result utilities · constants
```

**Agent loop** — every message:

1. **Classify** — a fast model decides: trivial / simple / complex / multi-step
2. **Workshop check** — if the message signals skill design intent, route to `SkillWorkshop.draft()`
3. **Plan** — for complex tasks, a `TaskGraph` (DAG) is built with dependency ordering
4. **Execute** — tasks run with full tool access in dependency order
5. **Observe** — results feed back into episodic memory; response is synthesized
6. **Extract** — background pass extracts any new user facts into the profile
7. **Shape** — if the message contains personality direction, the profile is updated
8. **Pad** — background pass checks if the scratchpad needs updating

**Consolidator** — runs concurrently with no global clock:
- Applies exponential confidence decay to unused profile facts
- Distills old episodic sessions into durable profile facts via LLM summarization
- Stochastic interval (8–18 min, randomly jittered) matches the CA paper's async cell update model

**Model tiers:**

| Tier | Used for | Default source |
|---|---|---|
| `fast` | Classification, quick responses | Cloud fast model / Ollama fast |
| `capable` | Planning, complex reasoning, skill workshop | Cloud capable model |
| `coder` | code_write_file, code_edit_file, code_scaffold | Ollama coder model (falls back to capable) |
| `embedding` | Memory similarity search | HuggingFace Transformers (local) |

---

## Configuration

Config lives at `~/.adam/config.json`. Managed via `adam init` or the web dashboard.

```json
{
  "version": "1",
  "providers": {
    "xai": {
      "enabled": true,
      "defaultModels": {
        "fast": "grok-3-fast",
        "capable": "grok-3"
      }
    },
    "ollama": {
      "enabled": true,
      "baseUrl": "http://localhost:11434",
      "models": {
        "fast": "llama3.2:1b",
        "capable": "llama3.2",
        "coder": "deepseek-coder-v2"
      }
    }
  },
  "daemon": {
    "port": 18800,
    "agentName": "Adam"
  },
  "budget": {
    "dailyLimitUsd": 1.00,
    "monthlyLimitUsd": 20.00,
    "fallbackToLocalOnExhaustion": true
  },
  "memory": {
    "decayHalfLifeDays": 30,
    "decayMinConfidence": 0.25
  }
}
```

API keys are **never** stored in this file. They live in the OS keychain.

---

## Messaging adapters

**Discord**

Configure a bot token via `adam init` or the web dashboard. The Discord adapter supports:
- Channel allowlisting / blocklisting
- Per-user filtering
- Per-channel rate limiting
- Slash command registration (`/ask`, `/remember`, `/memory`, `/status`)
- Mention-only mode

Adam can also post to Discord on request from any interface — "post a notification in #general" and it will use the `send_discord_message` tool to do it.

**Telegram**

Configure a bot token via `adam init`. The adapter supports private chats and group mentions.

---

## Security

- All credentials stored in OS keychain (`keytar`) with AES-256-GCM encrypted file fallback at `~/.adam/vault.enc`
- Every model call, tool execution, and skill invocation logged to an append-only audit log (`~/.adam/data/audit.db`)
- Tool execution happens in sandboxed child processes with declared capability permissions
- No network calls made without explicit tool invocation
- Skill specs are reviewed before execution — Adam cannot register or run skills without user approval
- The `CredentialVault` interface is stable — it is the trust boundary for the entire system

---

## Voice (LuxTTS)

Adam uses [LuxTTS](https://huggingface.co/YatharthS/LuxTTS) for voice synthesis via a Python sidecar.

`adam init` can automate the installation and optionally start the sidecar automatically when voice is enabled.

**Manual setup:**

**Requirements:** Python ≥ 3.10, pip

```bash
cd packages/voice/sidecar
pip install -r requirements.txt
python server.py
```

Then run `adam voice` for a voice-enabled chat session, or enable it in config:

```json
{ "voice": { "enabled": true } }
```

---

## Development

```bash
pnpm build          # build all packages (Turborepo, cached)
pnpm test           # run all tests
pnpm typecheck      # TypeScript strict check across the monorepo
pnpm lint           # ESLint
pnpm format         # Prettier
```

**Tech stack:** Node.js 22+, TypeScript 5 (`strict: true`, `exactOptionalPropertyTypes: true`), Vercel AI SDK, Drizzle ORM, better-sqlite3, React 18, Vite, Tailwind CSS, Commander.js, Vitest.

Tests use Vitest with in-memory SQLite — no external dependencies needed to run the suite.

---

## Files on disk

Adam's persistent data lives in `~/.adam/`:

```
~/.adam/
├── config.json          # Agent configuration (no secrets)
├── vault.enc            # Encrypted credential fallback (keys live in OS keychain)
├── personality.md       # Adam's personality profile — evolves through conversation
├── scratchpad.md        # Adam's autonomous notes — topic, ideas, open questions
├── skills/              # Skill specs as JSON files (draft, latent, active, etc.)
└── data/
    ├── memory.db        # SQLite — episodic, profile, working memory (encrypted at rest)
    └── audit.db         # Append-only audit log of all agent actions
```

---

## Contributing

This is a personal project but contributions are welcome.

- Monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces) and [Turborepo](https://turbo.build)
- Every package exports a clean public API — don't reach into another package's internals
- New tools need declared capabilities and security review
- Skill specs are the correct way to extend agent behavior — don't add raw tool calls to the agent core
- The `CredentialVault` interface must stay stable

Open an issue before starting large changes.

---

## Roadmap

- [ ] Semantic vector search over memory (sqlite-vec embeddings active)
- [ ] Skill activation — translate approved specs into real executable skills via trusted templates
- [ ] MCP (Model Context Protocol) adapter
- [ ] Voice adapter for Discord (join VC, speak responses)
- [ ] Scheduled tasks — cron-style background jobs via the daemon
- [ ] Multi-user support with per-user memory isolation
- [ ] Docker image for one-command deployment

---

## License

MIT
