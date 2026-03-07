# Adam — Project Overview

A complete technical overview of the Adam codebase: what each component does, how they connect, and why they were built this way.

---

## What Adam is

Adam is a self-hosted autonomous agent that runs as a persistent process on your local machine. It is not a wrapper around a chat API. It has:

- A multi-step reasoning loop with intent classification, hierarchical planning, and structured execution
- **Self-Repair Loop**: Automatic error diagnosis and patch proposals when tool execution fails (see [SELF_REPAIR.md](SELF_REPAIR.md))
- **Continuous Improvement**: Background Review Loop for proactive system growth and trait tracking (see [REINFORCEMENT.md](REINFORCEMENT.md))
- Four-layer persistent memory (episodic, semantic, profile, working) with a neural-CA-inspired lifecycle
- Full filesystem, shell, and web tool access via sandboxed child processes
- A division-of-labor architecture where a cloud model plans and a local coder model implements
- A Skill Workshop for designing new capabilities collaboratively, with human-in-the-loop approval before execution
- Multiple interfaces: terminal chat, web dashboard, Discord, Telegram — all backed by the same agent instance
- Credential security via the OS keychain — no secrets ever touch config files

---

## Repository layout

```
adam/
├── apps/
│   ├── daemon/        # Background process: HTTP API, adapter host, memory consolidator
│   └── web/           # React 18 dashboard (Vite + Tailwind CSS)
└── packages/
    ├── cli/           # adam init · chat · start · stop · status · voice
    ├── core/          # Agent reasoning loop, Skill Workshop, Scratchpad, Personality, BuildSupervisor
    ├── memory/        # SQLite stores: EpisodicStore, ProfileStore, WorkingMemory
    ├── models/        # ProviderRegistry, ModelRouter, budget tracking
    ├── security/     # CredentialVault, AuditLog, PermissionRegistry
    ├── skills/       # Tool definitions, model-backed code tools, SkillSchema, SkillStore
    ├── adapters/     # Adapter implementations: CLI, Telegram, Discord
    ├── voice/        # LuxTTS Python sidecar, Edge/XTTS providers
    ├── diagnostics/  # Codebase analyzer, pipeline registry, test runner, PatchService, ReinforcementService
    └── shared/       # Config schemas (Zod), shared types, Result utilities, logger
```

Managed with pnpm workspaces and Turborepo. Every package is `"type": "module"`, exports ESM, and ships its own type declarations.

---

## Package: `@adam/shared`

The foundation. Contains everything every other package imports.

**Config schemas (Zod):**
- `AdamConfigSchema` — the single source of truth for `~/.adam/config.json`
- `OllamaConfigSchema` — includes `models.fast`, `models.capable`, `models.coder` (optional)
- `CloudProviderConfigSchema`, `HuggingFaceConfigSchema`, `OpenAICompatibleConfigSchema`
- `MemoryConfigSchema` — `decayHalfLifeDays`, `decayMinConfidence`, `consolidateAfterDays`
- `BudgetConfigSchema`, `DaemonConfigSchema`, `AdapterConfigSchema`
- `VoiceConfigSchema` — `enabled`, `autoStartSidecar`, `providers` (edge, lux, xtts)

**Types:**
- `ModelTier` — `"fast" | "capable" | "coder" | "embedding"`
- `ModelUsage` — per-call tracking for cost accounting
- `InboundMessage`, `OutboundMessage` — the message envelope that flows through the agent
- `RequestIntent` — `"brainstorming" | "build" | "research" | "skill-development" | "general"`
- `Result<T, E>` — `neverthrow` based error types used everywhere in the codebase
- `AdamError` — typed error with a code and message
- `VoiceProvider`, `VoiceProfile`, `EdgeVoiceConfig`, `LuxVoiceConfig`, `XTTSVoiceConfig`, `VoiceOption`

**Utilities:**
- `generateId()`, `generateSessionId()` — UUID generation
- `createLogger(namespace)` — structured logger

---

## Package: `@adam/security`

**`CredentialVault`**

The trust boundary for all credentials. Two implementations, same interface:

1. **KeytarVault** — reads/writes from the OS keychain (Windows Credential Manager, macOS Keychain, Linux libsecret via `keytar`)
2. **FileVault** — AES-256-GCM encrypted file at `~/.adam/vault.enc` — automatic fallback when `keytar` is unavailable

Key naming convention: `provider:xai:api-key`, `adapter:discord:bot-token`, etc.

**`AuditLog`**

Append-only SQLite log at `~/.adam/data/audit.db`. Every model call, tool execution, and skill invocation is recorded with timestamp, session ID, actor, action, and outcome. Nothing is ever deleted from this log.

**`PermissionRegistry`**

Declares what capabilities each built-in tool is allowed to use (network, filesystem, shell). Used by the sandbox during tool execution.

---

## Package: `@adam/memory`

Four stores backed by SQLite (`better-sqlite3`) with Drizzle ORM for migrations.

**`EpisodicStore`**
- Stores every conversation turn: role, content, session ID, timestamp, source
- Cross-session queries: loads the last N turns from previous sessions into the current context window
- Used during system prompt enrichment to seed Adam with relevant history before each response

**`ProfileStore`**
- Stores facts about the user: key, value, confidence (0–1), source, `lastReferencedAt`, `protected` flag
- `insert(key, value, source)` — upserts a fact, merging if key exists
- `reinforce(key)` — called when a fact is injected into a prompt; boosts confidence
- `decay(halfLifeDays, minConfidence)` — exponential decay pass; prunes facts below minimum
- `protect(key)` / `unprotect(key)` — permanent immunity toggle
- Full version history: every write creates a new row; queries return the latest per key

**`WorkingMemory`**
- In-process per-session message buffer
- Manages the context window slice sent to the model
- Handles token budget estimation and sliding window truncation

**`MemoryConsolidator`**
- Background process, no global clock
- Stochastic interval: 8–18 minutes, randomly jittered (matches the Neural CA paper's async update model)
- Two passes per tick:
  1. `decay()` — applies exponential confidence decay to unused profile facts
  2. `consolidate()` — selects old episodic sessions, runs an LLM pass to extract durable facts, inserts them into `ProfileStore`

Inspired by: [Growing Neural Cellular Automata](https://distill.pub/2020/growing-ca/) — specifically the idea that local state persists and evolves through repeated interaction, not through explicit rewriting.

---

## Package: `@adam/models`

**`ModelPoolConfig`**

```typescript
type ModelPoolConfig = {
  fast: ProviderConfig[];
  capable: ProviderConfig[];
  coder: ProviderConfig[];       // dedicated code-editing tier
  embedding: ProviderConfig[];
};
```

Populated by `buildModelPool()` at startup. Cloud entries require a vault-verified API key. Local entries require no key. Ordered cloud-first.

**`ProviderRegistry`**

Wraps the pool. `resolveLanguageModel(tier)` walks the array for the requested tier and returns the first model that builds successfully.

Tier resolution rules:
- `"fast"` → `pool.fast[0]`
- `"capable"` → `pool.capable[0]`
- `"coder"` → `pool.coder[0]` if non-empty, else `pool.capable[0]` (automatic fallback)
- `"embedding"` → falls through to `pool.capable[0]` for language tasks

All models are instantiated via the Vercel AI SDK (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/xai`, custom Ollama/OpenAI-compatible setup). Qwen uses the DashScope OpenAI-compatible endpoint (`dashscope-intl.aliyuncs.com/compatible-mode/v1`) via `@ai-sdk/openai`.

**`ModelRouter`**

Wraps `ProviderRegistry` with:
- Budget enforcement — checks daily/monthly spend before each call; falls back to local if exhausted
- Usage logging — emits `ModelUsage` events after each call for cost tracking
- `generateText(opts)`, `generateObject(opts)`, `generateWithTools(opts)` — the three call types
- `replaceRegistry(registry)` — hot-swaps the provider pool without restarting the daemon
- `getPool()` — exposes the currently loaded pool (used by the daemon status API and active model display)

---

## Package: `@adam/skills`

**Built-in tools** (each is a `CoreTool` from the Vercel AI SDK):

| Tool | What it does |
|---|---|
| `web_fetch` | Fetches a URL, returns text content |
| `read_file` | Reads a file by absolute path |
| `write_file` | Writes content to a path (creates dirs as needed) |
| `list_directory` | Lists files and subdirectories at a path |
| `shell` | Runs a shell command, returns stdout/stderr/exit code |
| `shellStream` | Streaming shell execution with LOG_CHUNK events (used by BuildSupervisor) |

**Model-backed code tools** (via `createCodeTools(router, sessionId)`):

These implement the cloud-planner / local-coder division of labor. The cloud model provides structured intent; the `"coder"` tier model implements:

| Tool | Cloud model provides | Coder model does |
|---|---|---|
| `code_write_file` | Path + description of what the file should do | Generates complete file content, writes it |
| `code_edit_file` | Path + instruction describing the change | Reads file, applies change, writes back, returns diff summary |
| `code_scaffold` | Directory + spec + explicit file list with descriptions | Generates each file in sequence |
| `code_review` | Path + specific question | Reads file, answers the question directly |

`CoderRouter` — a minimal interface type that `ModelRouter` satisfies structurally. Used instead of importing `@adam/models` directly (avoids circular dependency).

**`SkillSchema`** (`packages/skills/src/schema.ts`)

Zod schemas defining the contract for a skill spec:
- `SkillStatus` — `"draft" | "approved" | "latent" | "active" | "deprecated"`
- `SkillSpecSchema` — id, name, description, triggers, inputs, outputs, `allowedTools` (constrained to trusted list), steps, artifacts, successCriteria, constraints, template, notes
- `SkillInputSchema`, `SkillOutputSchema` — typed I/O definitions

**`SkillStore`** (`packages/skills/src/store.ts`)

File-based persistence in `~/.adam/skills/` as JSON files. CRUD operations plus lifecycle methods:
- `approve(id)` — `draft → approved`
- `makeLatent(id)` — `approved → latent`
- `activate(id, template)` — `latent → active`
- `deprecate(id)` — any → `deprecated`

Each method enforces valid transitions. Invalid transitions throw.

---

## Package: `@adam/core`

The agent brain.

**`IntentClassifier`**

Uses the `"fast"` model tier to classify each incoming message into:
- `trivial` — answer directly, no tools needed
- `simple` — answer with possible tool use
- `complex` — requires planning

**Intent** (what the user wants from this exchange):
- `brainstorming` — ideation, exploration; do not jump to implementation
- `build` — ready for tools, code, execution
- `research` — gather and synthesize information
- `skill-development` — design a new capability; focus on spec, not execution
- `general` — conversational or mixed
- `multi-step` — requires a full task DAG

Returns `{ requiresPlanning: boolean, tier: ModelTier }`.

**`Planner`**

For complex and multi-step messages, produces a `TaskGraph` — a DAG where each node is a `Task` with:
- A description
- A list of prerequisite task IDs
- An assigned model tier

Dependency ordering is resolved before execution begins.

**`Executor`**

Runs tasks from the `TaskGraph` in dependency order. Each task can make tool calls via the Vercel AI SDK `generateWithTools`. Tool results feed into subsequent tasks.

**`TaskQueue`**

SQLite-backed queue for persisting in-flight tasks across daemon restarts.

**`Agent`**

The outer loop. For each `InboundMessage`:

1. Enriches the system prompt: injects personality, profile facts, scratchpad content, recent episodic history, live timestamp
2. Checks for skill workshop intent → routes to `SkillWorkshop.draft()` if detected
3. Classifies the message
4. Plans if needed
5. Executes
6. **Self-Repair** (Reflex Loop) — if execution fails, trigger `PatchService` to propose a fix
7. Writes the turn to episodic memory
8. **Reinforce** — updates trait scores based on interaction quality
9. Fire-and-forgets: fact extraction, personality shaping, scratchpad update

**`PersonalityStore`**

Manages `~/.adam/personality.md`. `maybeUpdatePersonality(conversation)` uses the LLM to detect when the user is giving personality direction and rewrites the file accordingly.

**`ScratchpadStore`**

Manages `~/.adam/scratchpad.md`. `maybeUpdateScratchpad(conversation)` uses the LLM to decide if the scratchpad needs updating after a conversation turn, then saves structured notes: current topic, ideas, open questions.

**`SkillWorkshop`**

LLM-driven component for skill design. Takes a user intent string and uses `router.generateObject` with a constrained Zod schema to produce a structured skill spec — not code. The spec is saved as a `"draft"` in `SkillStore`. The user then reviews it in the web dashboard or CLI before it advances through the lifecycle.

`isWorkshopTrigger(message)` detects phrases like "let's design a skill", "build a capability", "create a workflow" to automatically route into workshop mode.

**`BuildSupervisor`** (see [BUILD_SUPERVISOR.md](BUILD_SUPERVISOR.md))

Background build pipeline: checkout → dependency_install → analyze → patch → lint → build → test → coverage → review. Runs in a separate worker process. Agent tools: `spawn_build_job`, `get_build_job_status`, `cancel_build_job`, `summarize_build_job`.

---

## Package: `@adam/diagnostics`

System diagnostics for codebase analysis and pipeline testing.

**`analyzeCodebase(rootDir)`** — Scans `packages/` and `apps/`, extracts exports (function, class, const, type, interface) and imports, detects packages with tests.

**`PIPELINE_REGISTRY`** — Registry of pipeline stages (classify, plan, execute, observe, plus BuildSupervisor stages).

**`runAllTests(rootDir)`** — Runs Vitest with JSON reporter across core, shared, memory, security, adapters, models, skills, voice, cli; parses results.

**Dynamic tests** — User-defined tests (JSON schema: id, name, target, input, expected) stored and runnable via API.

---

## Package: `@adam/adapters`

Each adapter is a loop that: receives a message from its surface → wraps it as `InboundMessage` → calls `agent.process()` → sends the `OutboundMessage` response.

**`CliAdapter`** — reads from stdin, writes to stdout. Used by `adam chat`.

**`TelegramAdapter`** — uses `grammy`. Supports private chats and group mentions. Reconnects automatically.

**`DiscordAdapter`** — uses `discord.js`. Features:
- Channel allowlist / blocklist
- Per-user filter list
- Per-channel rate limiting (configurable cooldown)
- Mention-only mode
- Slash command registration: `/ask`, `/remember`, `/memory`, `/status`
- Outbound tools: `send_discord_message`, `list_discord_channels` — registered into the agent's tool registry when the adapter is active

---

## App: `apps/daemon`

The always-on background process. Started with `adam start`, stopped with `adam stop`.

Responsibilities:
- Instantiates the agent, all memory stores, all adapters
- Hosts a REST API on port 18800 (configurable)
- Serves the built web UI as static files
- Runs the `MemoryConsolidator` concurrently
- Spawns BuildSupervisor worker for build jobs

**REST API surface** (`/api/*`):

| Endpoint | Description |
|----------|-------------|
| `GET /api/status` | Daemon health, active adapters, vault-verified model pool |
| `POST /api/chat` | Send a message to the agent, get a response |
| `GET /api/memory` | List profile facts |
| `DELETE /api/memory/:key` | Delete a profile fact |
| `GET /api/config/*` | Read config sections (daemon, discord, budget, providers, memory, personality) |
| `PATCH /api/config/*` | Update config sections (providers patch hot-reloads the model pool) |
| `GET/PATCH/DELETE /api/scratchpad` | Read, update, or clear the scratchpad |
| `GET /api/skills` | List all skill specs |
| `GET /api/skills/:id` | Get a single spec |
| `PATCH /api/skills/:id` | Edit a draft spec (notes, steps, constraints, successCriteria) |
| `DELETE /api/skills/:id` | Delete a spec |
| `POST /api/skills/:id/action/:action` | Lifecycle transition (approve, latent, activate, deprecate) |
| `GET /api/jobs` | List build jobs |
| `POST /api/jobs` | Spawn a build job |
| `GET /api/jobs/:id` | Get job status and events |
| `POST /api/jobs/:id/cancel` | Request job cancellation |
| `GET /api/diagnostics/analysis` | Codebase analysis |
| `GET /api/diagnostics/pipeline` | Pipeline stages |
| `GET /api/diagnostics/tests` | Dynamic tests |
| `POST /api/diagnostics/run` | Run all Vitest tests |
| `GET /api/diagnostics/results` | Last test run results |
| `GET /api/vault/status` | Which vault slots have keys set (never returns key values) |
| `POST /api/vault/:slot` | Set a key in the vault |
| `DELETE /api/vault/:slot` | Remove a key from the vault |

Provider config `PATCH` rebuilds the model pool and calls `router.replaceRegistry()` — no daemon restart required.

---

## App: `apps/web`

React 18 + Vite + Tailwind CSS single-page app. All state is server-derived (no local storage, no client-side persistence). Built output is served by the daemon.

**Tabs:**

| Tab | Component | What it does |
|-----|------------|--------------|
| Chat | `Chat.tsx` | Full chat UI, shows active model, polls for responses |
| Memory | `Memory.tsx` | Profile fact browser, health bars, delete controls |
| Status | `Status.tsx` | Daemon health, adapter status, model pool display |
| Settings | `Settings.tsx` | Agent, Discord, budget, personality, memory decay config |
| Providers | `Providers.tsx` | Cloud providers (API keys), local providers (fast/capable/coder models), adapter tokens |
| Scratch Pad | `Scratchpad.tsx` | View/edit the scratchpad, auto-polls every 12s |
| Skills | `Skills.tsx` | Skill spec list, detail view, lifecycle action buttons |
| Voices | `Voices.tsx` | Voice profiles (Edge, Lux, XTTS) |
| Diagnostics | `Diagnostics.tsx` | Codebase analysis, pipeline view, run tests, dynamic test editor |

**API client** (`apps/web/src/lib/api.ts`):

Typed wrapper around `fetch`. All API types are defined here — `StatusData`, `ProvidersConfig`, `LocalProviderConfig` (with `models.coder`), `SkillSpec`, `VaultStatus`, `DiagnosticsAnalysis`, `DiagnosticRunResult`, etc.

---

## Package: `@seed0001/adam` (CLI)

Commander.js-based CLI. Commands:

| Command | What it does |
|---------|--------------|
| `adam init` | Interactive wizard using `inquirer` — sets provider keys (stored to vault), adapter tokens, budget limits, voice providers |
| `adam chat` | Loads config, builds model pool, instantiates agent, starts REPL loop |
| `adam start` | Spawns the daemon as a background process, writes PID to `~/.adam/daemon.pid` |
| `adam stop` | Reads PID file, sends `SIGTERM` |
| `adam status` | Calls daemon API, pretty-prints health info |
| `adam voice` | Like `chat` but pipes responses through LuxTTS sidecar |

The CLI builds its own model pool (same logic as the daemon) and its own agent instance — it does not talk to the daemon. The daemon and CLI can run simultaneously; they share the same SQLite files and config.

**In-session REPL commands** are handled before the message reaches the agent: `/memory`, `/remember`, `/forget`, `/protect`, `/unprotect`, `/personality`, `/pad`, `/workshop`, `/workshop show/approve/latent/deprecate`, `/clear`, `/exit`.

---

## Data flow: from message to response

```
User input (CLI / Discord / Telegram / Web dashboard)
         │
         ▼
   Adapter wraps → InboundMessage { id, sessionId, content, source }
         │
         ▼
   Agent.process(message)
         │
         ├─ Enrich system prompt
         │    ├─ PersonalityStore.load()
         │    ├─ ProfileStore.getTop() → inject facts + call reinforce() for each used
         │    ├─ ScratchpadStore.load()
         │    ├─ EpisodicStore.getRecent() + EpisodicStore.getPreviousSessions()
         │    └─ Live timestamp (date, time-of-day label, session duration)
         │
         ├─ isWorkshopTrigger? → SkillWorkshop.draft() → return spec summary
         │
         ├─ IntentClassifier.classify() → { requiresPlanning, tier }
         │
         ├─ requiresPlanning?
         │    ├─ Yes → Planner.buildGraph() → TaskGraph
         │    │         └─ Executor.run(graph, tools) → responseText
         │    └─ No  → ModelRouter.generateWithTools(tier, tools) → responseText
         │
         ├─ EpisodicStore.insert(turn)
         │
         └─ Fire-and-forget (async, non-blocking):
             ├─ ProfileStore.extractFacts(conversation)
             ├─ PersonalityStore.maybeUpdate(conversation)
             ├─ ReinforcementService.recordFeedback(conversation)
             └─ ScratchpadStore.maybeUpdate(conversation)
         │
         ▼
   OutboundMessage { content, sessionId, metadata }
         │
         ▼
   Adapter sends response to surface
```

---

## Security model

**Credentials:** Never in config files. Always in the OS keychain. File vault (`~/.adam/vault.enc`) is AES-256-GCM encrypted and is a fallback only — it's not the primary store.

**Tool execution:** Each tool runs in a sandboxed child process with a declared capability set. The `PermissionRegistry` maps tool names to allowed capabilities. Tools cannot escalate beyond their declared scope.

**Skill execution:** Skills cannot execute until they have passed through the `approved → active` transition. The transition requires explicit user action. Adam can draft and describe skills but cannot run them unilaterally.

**Audit log:** Every model invocation, tool call, and skill execution is recorded in the append-only audit log. Nothing is ever deleted from it.

**No ambient network access:** The agent makes no outbound connections except through explicit tool invocations (`web_fetch`, model API calls). There are no background telemetry calls.

---

## Key design decisions

**Why SQLite for everything?** Zero operational overhead, encrypted at rest, works on every platform, ships as a single file. The alternative (Postgres + Redis) would require infrastructure Adam is explicitly designed to avoid.

**Why the coder tier fallback instead of requiring it?** A strict coder-only setup would break for users without a local model. The fallback to `capable` means code tools work on day one, and improve when you add a coder model.

**Why file-based skill storage?** Skills are documents, not database records. JSON files in `~/.adam/skills/` are human-readable, version-controllable, and require no migration logic when the schema evolves.

**Why the scratchpad isn't part of the prompt?** Because the scratchpad is Adam's working space, not a directive to the model. Injecting it every turn would pollute the context with internal notes. It's a separate artifact that Adam writes to, not a system prompt extension.

**Why `neverthrow` instead of `try/catch`?** Explicit error propagation. Every function that can fail returns `Result<T, AdamError>`. No silent swallowing of errors. The type system enforces error handling.

**Why a stochastic consolidator interval?** The Neural CA paper's key insight is that persistent state emerges from local, asynchronous updates without a global clock. A fixed-interval consolidator would create a predictable "heartbeat" that doesn't match how memory actually works. Random jitter keeps the system honest.

---

## Adding a new tool

1. Create a `CoreTool` in `packages/skills/src/builtins/`
2. Export it from `packages/skills/src/index.ts`
3. Add it to the tools Map in `apps/daemon/src/index.ts` and `packages/cli/src/commands/chat.ts`
4. Declare its capabilities in `packages/security/src/permissions.ts`
5. Document it in the system prompt in `buildSystemPrompt()`

If the tool is model-backed (uses the coder tier), follow the `createCodeTools` pattern: accept a `CoderRouter` (not `ModelRouter`) to avoid circular imports, and use `router.generate({ tier: "coder", ... })` for all LLM calls.

---

## Adding a new provider

1. Add config schema to `packages/shared/src/config.ts` (extend `ProvidersConfigSchema`)
2. Add vault slot naming convention: `provider:<name>:api-key`
3. Add to the `cloudProviders` array in `buildModelPool()` in both daemon and CLI
4. Register the AI SDK provider in `packages/models/src/registry.ts` → `buildLanguageModel()` switch
5. Add it to the `adam init` wizard in `packages/cli/src/commands/init.ts`
6. Add it to the Providers tab in the web dashboard

---

*Last updated: March 2026*
