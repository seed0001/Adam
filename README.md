# Adam

**A self-hosted autonomous AI agent that lives on your machine.**

Adam is not a chatbot. It is a persistent digital entity with layered memory, full tool access, a structured reasoning loop, a web dashboard, and messaging adapters — running entirely on your hardware, under your control.

No cloud dependency by default. No subscription. No data leaving your machine unless you choose a cloud model provider.

---

## Project Overview

Most "AI agents" are thin wrappers around a single LLM call with a system prompt. Adam is an attempt to build something with more depth: a software entity that persists, remembers, reasons across multiple steps, and improves its understanding of the person it works with over time.

The architecture is organized around a few core ideas:

**Memory with a lifecycle.** Adam's profile memory is inspired by neural cellular automata — facts that get used in conversations are reinforced, facts that go unreferenced decay exponentially and eventually die. You control what's immortal. This isn't just a journal; it's a living model of who you are and how you work.

**A reasoning loop, not a single call.** Every message goes through `Classify → Plan → Execute → Observe`. Simple questions get fast direct answers. Complex requests get broken into a task DAG with dependency ordering. Tool calls happen within the execution phase, not as an afterthought.

**Security as a first-class constraint.** No credential ever touches a config file. API keys live in the OS keychain (Windows Credential Manager / macOS Keychain / Linux libsecret) with an AES-256-GCM encrypted file as automatic fallback. Every action goes into an append-only audit log.

**One agent, multiple surfaces.** The same agent instance handles terminal chat, Discord, Telegram, and the web dashboard simultaneously. What it learns in one context carries into the others.

---

## What's built

| Capability | Status |
|---|---|
| Interactive terminal chat (`adam chat`) | ✅ |
| Always-on daemon (`adam start` / `adam stop`) | ✅ |
| Web dashboard — chat, memory viewer, status, settings, providers | ✅ |
| 4-layer SQLite memory (episodic, semantic, profile, working) | ✅ |
| Memory decay + reinforcement (Neural CA-inspired lifecycle) | ✅ |
| Stochastic memory consolidation — old episodes → durable profile facts | ✅ |
| Cross-session context — past conversations seeded into each new session | ✅ |
| Personality profile — evolves through conversation, injected every turn | ✅ |
| Time awareness — live date, time of day, session duration in every prompt | ✅ |
| Tool use — web fetch, file R/W, shell, directory listing | ✅ |
| Multi-provider model router — cloud, local, HuggingFace | ✅ |
| Budget caps with local fallback | ✅ |
| OS keychain credential storage | ✅ |
| Append-only audit log | ✅ |
| Discord adapter — channel filtering, rate limiting, slash commands | ✅ |
| Telegram adapter | ✅ |
| Discord outbound tools — Adam can post to Discord on request | ✅ |
| Voice synthesis (LuxTTS) | ✅ |
| Provider management via web UI | ✅ |
| Semantic vector search (sqlite-vec) | 🔜 |
| Skill marketplace | 🔜 |
| MCP (Model Context Protocol) support | 🔜 |

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
adam status            — Show daemon status, active adapters, memory stats
adam voice             — Voice chat session (requires LuxTTS sidecar)
```

### In-session commands (`adam chat`)

```
/help                    — show commands
/memory                  — show profile memory with health bars and decay status
/remember <key> = <val>  — manually store a fact (protected, never decays)
/forget <key>            — delete a specific memory
/forget all              — clear all profile memory
/protect <key>           — lock a memory so it never decays
/unprotect <key>         — let a memory decay naturally again
/personality             — view Adam's personality profile
/personality reset       — reset to defaults
/clear                   — clear the screen
/exit                    — end the session
```

---

## Providers

`adam init` walks you through provider setup. You need at least one.

**Local (free, private)**
- [Ollama](https://ollama.com) — `ollama pull llama3.2` then enable in init
- [LM Studio](https://lmstudio.ai) — local model inference with an OpenAI-compatible endpoint
- [vLLM](https://github.com/vllm-project/vllm) — high-throughput local serving

**Cloud (API key required)**
- [Groq](https://console.groq.com) — fast inference, free tier (`gsk_...`)
- [Anthropic](https://console.anthropic.com) — Claude 3.5 / 3.7
- [OpenAI](https://platform.openai.com) — GPT-4o and later
- [Google](https://aistudio.google.com) — Gemini models
- [Mistral](https://console.mistral.ai) — Mistral and Codestral
- [DeepSeek](https://platform.deepseek.com) — cost-efficient reasoning models
- [OpenRouter](https://openrouter.ai) — unified gateway to 200+ models

API keys are stored in your OS keychain — never written to disk or any config file.

Provider configuration, model selection, and key management are all available in the **Providers** tab of the web dashboard.

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
- **Decay** — auto-extracted facts lose confidence exponentially over time (30-day half-life by default). Facts that drop below 25% confidence are pruned.
- **Protection** — facts you enter manually via `/remember` are always protected. Use `/protect <key>` to lock any fact permanently.
- **Consolidation** — a stochastic background process (no global clock — fires at random intervals) periodically runs an LLM pass over old episodic sessions and extracts durable facts into the profile. Old experience doesn't disappear; it condenses.

The `/memory` command shows this visually: health bars, confidence percentages, source badges, and how long ago each fact was last used.

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
| **Chat** | Full chat interface backed by the same agent as terminal |
| **Memory** | Browse and manage all profile facts, search episodic history |
| **Status** | Daemon health, active adapters, model pool, resource usage |
| **Settings** | Agent name, system prompt, Discord configuration, budget limits, personality editor |
| **Providers** | Enable/disable providers, set models, manage API keys and adapter tokens |

---

## Architecture

```
adam/
├── apps/
│   ├── daemon/          # Always-on process: REST API, adapter host, consolidator
│   └── web/             # React 18 dashboard (Vite + Tailwind)
└── packages/
    ├── cli/             # adam init · chat · start · stop · status · voice
    ├── core/            # Agent loop · Classifier · Planner · Executor · Consolidator
    ├── memory/          # EpisodicStore · ProfileStore · WorkingMemory · encryption
    ├── models/          # ProviderRegistry · ModelRouter · cost tracking
    ├── security/        # CredentialVault · AuditLog · PermissionRegistry
    ├── skills/          # Built-in tools · SkillSandbox · capability permissions
    ├── adapters/        # CLI · Telegram · Discord (with slash commands, channel filtering)
    ├── voice/           # LuxTTS sidecar · VoiceRegistry · character sandbox
    └── shared/          # Config schema · types · result utilities · constants
```

**Agent loop** — every message:

1. **Classify** — a fast model decides: trivial / simple / complex / multi-step
2. **Plan** — for complex tasks, a `TaskGraph` (DAG) is built with dependency ordering
3. **Execute** — tasks run with full tool access in dependency order
4. **Observe** — results feed back into episodic memory; response is synthesized
5. **Extract** — background pass extracts any new user facts into the profile
6. **Shape** — if the message contains personality direction, the profile is updated

**Consolidator** — runs concurrently with no global clock:
- Applies exponential confidence decay to unused profile facts
- Distills old episodic sessions into durable profile facts via LLM summarization
- Stochastic interval (8–18 min, randomly jittered) matches the CA paper's async cell update model

---

## Configuration

Config lives at `~/.adam/config.json`. Managed via `adam init` or the web dashboard Settings tab.

```json
{
  "version": "1",
  "providers": {
    "groq": {
      "enabled": true,
      "defaultModels": {
        "fast": "llama-3.1-8b-instant",
        "capable": "llama-3.3-70b-versatile"
      }
    },
    "ollama": { "enabled": false }
  },
  "daemon": {
    "port": 18800,
    "agentName": "Adam"
  },
  "budget": {
    "dailyLimitUsd": 1.00,
    "monthlyLimitUsd": 20.00,
    "fallbackToLocalOnExhaustion": true
  }
}
```

API keys are **never** stored in this file. They live in the OS keychain.

---

## Messaging adapters

**Discord**

Configure a bot token via `adam init` or the web dashboard Providers tab. The Discord adapter supports:
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
- The `CredentialVault` interface is stable — it is the trust boundary for the entire system

---

## Voice (LuxTTS)

Adam uses [LuxTTS](https://huggingface.co/YatharthS/LuxTTS) for voice synthesis via a Python sidecar.

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

## Contributing

This is a personal project but contributions are welcome.

- Monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces) and [Turborepo](https://turbo.build)
- Every package exports a clean public API — don't reach into another package's internals
- New tools need declared capabilities and security review
- The `CredentialVault` interface must stay stable

Open an issue before starting large changes.

---

## Roadmap

- [ ] Semantic vector search over memory (sqlite-vec embeddings)
- [ ] Skill marketplace — install community skills with capability approval UI
- [ ] MCP (Model Context Protocol) adapter
- [ ] Voice adapter for Discord (join VC, speak responses)
- [ ] Scheduled tasks — cron-style background jobs via the daemon
- [ ] Multi-user support with per-user memory isolation

---

## License

MIT
