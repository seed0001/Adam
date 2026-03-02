# Adam

**A self-hosted autonomous AI agent that lives on your machine.**

Adam is not a chatbot. It's a persistent digital entity with memory, tool access, and a reasoning loop — running entirely on your hardware, under your control. No cloud dependency. No subscription. No data leaving your machine unless you choose a cloud model.

---

## Why Adam instead of other agents?

Most open-source AI agents are fragile wrappers around a single LLM call. Adam is built differently:

| Problem with most agents | How Adam handles it |
|---|---|
| Single point of failure | Event-driven `Classify → Plan → Execute → Observe` loop with a persistent task queue |
| API keys in plaintext `.env` files | OS keychain (Credential Manager / Keychain / libsecret) with an AES-256-GCM encrypted file fallback |
| No memory between sessions | 4-layer SQLite memory: Episodic · Semantic · Profile · Working context window |
| Cloud-only | Cost-aware model router: cloud providers, Ollama, LM Studio, vLLM, HuggingFace — with budget caps and local fallback |
| Unvetted skill execution | Capability-based permission system, sandboxed child processes, append-only audit log |

---

## Features

- **`adam chat`** — interactive terminal session. No daemon required.
- **Persistent memory** — Adam builds context about you and your work over time
- **Tool use** — web fetch, file read/write, shell execution, directory listing
- **Multi-provider model router** — Anthropic, OpenAI, Google, Groq, Mistral, DeepSeek, OpenRouter, Ollama, LM Studio, vLLM, HuggingFace
- **Budget caps** — daily and monthly spend limits with local model fallback
- **Voice synthesis** — LuxTTS integration with custom voice profiles and character sandbox
- **Messaging adapters** — Telegram and Discord bots via the always-on daemon
- **Security-first** — every credential in the OS keychain, every action in the audit log

---

## Quick start

**Prerequisites:** Node.js ≥ 22, pnpm ≥ 10

```bash
git clone https://github.com/YOUR_USERNAME/adam.git
cd adam
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

Start chatting:

```bash
adam chat
```

---

## Providers

`adam init` walks you through provider setup. You need at least one.

**Local (free, private)**
- [Ollama](https://ollama.com) — run models locally. `ollama pull llama3.2` then enable in `adam init`

**Cloud (API key required)**
- [Groq](https://console.groq.com) — fast inference, free tier available (`gsk_...`)
- [Anthropic](https://console.anthropic.com) — Claude models
- [OpenAI](https://platform.openai.com) — GPT models
- [Google](https://aistudio.google.com) — Gemini models
- [OpenRouter](https://openrouter.ai) — unified gateway to 200+ models

API keys are stored in your OS keychain — never written to disk or config files.

---

## Talking to Adam

```
you › what files are in my Downloads folder?
you › fetch https://news.ycombinator.com and summarize the top 5 stories
you › read ~/Documents/notes.txt and find action items
you › write a Python script to rename all .jpeg files to .jpg in the current directory
```

Built-in commands:

```
/help    — show available commands
/clear   — clear the screen
/exit    — end the session
```

---

## Architecture

```
adam/
├── apps/
│   └── daemon/          # Always-on background process (Telegram, Discord, scheduled tasks)
└── packages/
    ├── cli/             # adam init · adam chat · adam status
    ├── core/            # IntentClassifier · Planner · Executor · Agent loop
    ├── memory/          # EpisodicStore · ProfileStore · WorkingMemory · AES-256-GCM encryption
    ├── models/          # ProviderRegistry · ModelRouter · cost tracking
    ├── security/        # CredentialVault · AuditLog · PermissionRegistry
    ├── skills/          # Built-in tools · SkillSandbox · capability permissions
    ├── adapters/        # CLI · Telegram · Discord
    ├── voice/           # LuxTTS sidecar · VoiceRegistry · character sandbox
    └── shared/          # Config schema · types · result utilities · constants
```

**Agent loop** for every message:

1. **Classify** — fast model decides: trivial / simple / complex / multi-step
2. **Plan** — for complex tasks, a `TaskGraph` (DAG) is built
3. **Execute** — tasks run with full tool access, respecting dependency order
4. **Observe** — results feed back into memory; final response is synthesized

---

## Configuration

Config lives at `~/.adam/config.json`. Edit it directly or re-run `adam init --reset`.

```json
{
  "version": "1",
  "providers": {
    "groq": { "enabled": true, "defaultModels": { "fast": "llama-3.1-8b-instant", "capable": "llama-3.3-70b-versatile" } },
    "ollama": { "enabled": false }
  },
  "daemon": {
    "port": 18800,
    "logLevel": "info",
    "agentName": "Adam"
  },
  "budget": {
    "dailyLimitUsd": 1.00,
    "monthlyLimitUsd": 20.00,
    "fallbackToLocalOnExhaustion": true
  }
}
```

API keys are **never** in this file. They live in the OS keychain.

---

## Always-on mode (daemon)

The daemon keeps Adam running as a background process — powering Telegram/Discord bots and scheduled tasks.

```bash
# Start the daemon
cd apps/daemon
pnpm dev

# Check status
adam status
```

Configure adapters via `adam init` before starting the daemon.

---

## Voice (LuxTTS)

Adam uses [LuxTTS](https://huggingface.co/YatharthS/LuxTTS) for voice synthesis.

**Requirements:** Python ≥ 3.10, pip

```bash
cd packages/voice/sidecar
pip install -r requirements.txt
python server.py
```

Once the sidecar is running, enable voice in your config:

```json
{ "voice": { "enabled": true, "autoStartSidecar": false } }
```

---

## Development

```bash
pnpm build          # build all packages
pnpm test           # run all tests (105 tests across 9 suites)
pnpm typecheck      # TypeScript strict check across the monorepo
pnpm lint           # ESLint
pnpm format         # Prettier
```

Tests use [Vitest](https://vitest.dev) with in-memory SQLite — no external dependencies needed to run the suite.

---

## Contributing

Contributions are welcome. A few things to know:

- This is a monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces) and [Turborepo](https://turbo.build)
- Every package exports a clean public API — don't reach into another package's internals
- New features need tests. New tools need security review (capabilities must be declared)
- The `CredentialVault` interface must stay stable — it's the trust boundary

Open an issue before starting large changes.

---

## Roadmap

- [ ] Cross-session memory (load past conversations into context)
- [ ] `adam start` — proper daemon process manager with PID file
- [ ] Semantic search over memory (sqlite-vec)
- [ ] Skill marketplace — install community skills with capability approval
- [ ] Web dashboard — chat UI, memory viewer, skill manager
- [ ] MCP (Model Context Protocol) support

---

## License

MIT
