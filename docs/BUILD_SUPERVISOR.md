# BuildSupervisor — Engineering Pipeline Design

A design document for the BuildSupervisor: a supervised CI-style engineering engine that runs long-running build jobs in the background, emits structured telemetry, and integrates with Adam's conversational layer via live narrative updates.

**Status:** Design. Not yet implemented.

---

## Job Status — Explicit Terminal States

| Status | Meaning |
|--------|---------|
| `pending` | Queued, not started |
| `running` | Active build |
| `cancelling` | User requested stop, draining |
| `awaiting_review` | Build/test passed; diff ready; **waiting on human** |
| `completed` | Merged, done |
| `cancelled` | User rejected or cancelled |
| `failed` | Exceeded retries or unrecoverable error |

**`awaiting_review` is not `completed`.** A job can succeed build/test but still require manual merge approval. That's "waiting on human" — make it explicit.

---

## What This Is

Not Gambit. Not LangChain. Not AutoGPT.

This is:

- **A persistent conversational agent** (Adam) with identity and memory
- **A supervised CI-style engineering engine** (BuildSupervisor) with strict stage transitions
- **Live narrative telemetry** — event-driven updates that Adam converts into conversational messages

Cursor gives you streaming execution without identity or memory. Adam will have both.

---

## Architecture Overview

### Two Engines, Shared Primitives

```
packages/core/
  Executor.ts         ← conversational task DAG (existing)
  BuildSupervisor.ts  ← engineering pipeline engine (new)
  ErrorClassifier.ts  ← parse TS/Jest/ESLint output → structured ERROR_DETECTED (new)
```

**Do not reuse Executor orchestration.** The Executor is built for "run tasks until graph complete." BuildSupervisor is built for "run long job, emit events, allow interruption, allow inspection."

**Do reuse primitives:**

- `PermissionRegistry`
- Sandbox model
- `AuditLog`
- `CredentialVault` boundary
- Shell base implementation

The Engineering Pipeline should feel like a **sibling subsystem**, not a mutated version of Executor.

---

## BuildEvent Schema

BuildSupervisor classifies signals, extracts structure, and emits structured events. Adam converts events into conversational messages. **Do not let narration be generated from raw logs.**

```typescript
type BuildEvent =
  | { type: "JOB_STARTED"; branch: string }
  | { type: "STAGE_START"; stage: string }
  | { type: "STAGE_END"; stage: string; durationMs: number }
  | { type: "TOOL_CALL"; tool: string; summary: string }
  | { type: "LOG_CHUNK"; stream: "stdout" | "stderr"; chunk: string }
  | { type: "ERROR_DETECTED"; summary: string; file?: string; line?: number }
  | { type: "PATCH_APPLIED"; summary: string; files: string[] }
  | { type: "RETRY_SCHEDULED"; attempt: number }
  | { type: "AWAITING_REVIEW"; diffSummary: string }
  | { type: "JOB_COMPLETED"; success: boolean }
  | { type: "JOB_FAILED"; reason: string }
  | { type: "JOB_CANCELLED" };
```

---

## Stage List

**Coarse for narration. Fine-grained internally.**

User-facing stages (what Adam reports) stay simple. Internal stages support debugging and mid-stage cancellation:

| Stage | Purpose |
|-------|---------|
| `checkout` | Git checkout / branch setup |
| `analyze` | Understand request, plan changes |
| `dependency_install` | npm/pnpm install, etc. |
| `patch` | Apply edits |
| `lint` | ESLint, Prettier, etc. |
| `build` | Compile / typecheck |
| `test` | Run tests |
| `coverage` | Optional coverage run |
| `review` | Diff ready, awaiting approval |

Not all stages need to be exposed to users. Internal granularity helps debugging and structured error extraction.

Cancellation checks happen at **stage boundaries**. For long-running stages (e.g. `test`), mid-stage kill is supported — see Cancellation Flow.

---

## Job Registry

SQLite-backed persistent state. Adam queries this to answer "what's going on?"

```sql
CREATE TABLE jobs (
  id                TEXT PRIMARY KEY,
  branch            TEXT NOT NULL,
  status            TEXT NOT NULL,  -- pending | running | cancelling | awaiting_review | completed | cancelled | failed
  current_stage     TEXT,
  retries           INTEGER NOT NULL DEFAULT 0,
  last_update       TEXT NOT NULL,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  completed_at      TEXT
);

-- Append-only event log. Do NOT store raw logs in a single TEXT blob — it explodes for long builds.
CREATE TABLE job_logs (
  job_id     TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (job_id, seq),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX job_logs_job_id ON job_logs(job_id);
```

**Why `job_logs` instead of `logs TEXT`:**

- Append-only — no rewriting giant blobs
- Indexed by `job_id` — streamable queries
- Structured events — replayability, not raw text
- Bounded growth — one row per event

---

## Dev Mode — Hard Gate

Dev Mode is a strict isolation boundary. Engineering Mode must be deterministic. Conversation Mode can be organic. **Do not blur them.**

| Disabled in Dev Mode | Reason |
|----------------------|--------|
| Personality injection | No character drift in engineering context |
| Scratchpad updates | No organic note-taking during builds |
| Memory reinforcement | No profile updates from build events |
| Background consolidator | No episodic consolidation for that sandbox |
| Variable system prompt | Fixed engineering prompt only |

Engineering Mode = deterministic, bounded, repeatable.  
Conversation Mode = organic, adaptive, memory-augmented.

---

## Cancellation Flow

1. User requests cancellation → `job.status = "cancelling"`
2. BuildSupervisor checks cancellation flag **between stages** (primary check)
3. For long-running stages (e.g. `test`): **mid-stage kill** supported
4. **Each stage owns its child PIDs** — track handles, avoid orphaned processes
5. Graceful child termination: `SIGTERM` → timeout → `SIGKILL`
6. Branch cleanup (optional, configurable)
7. Emit `JOB_CANCELLED` event

If you skip this, you’ll regret it later.

---

## Concurrency

**Start simple: one job per repo at a time.**

If you allow multiple concurrent jobs in the same repo, you must:

- Create separate worktrees or clones
- Isolate branches properly
- Isolate build artifacts

That adds significant complexity. Start with one job per repo.

---

## Shell Tools

**Do not mutate the existing shell tool.**

| Tool | Behavior |
|------|----------|
| `shell_exec` | Existing, buffered. Returns stdout/stderr after completion. |
| `shell_stream` | New, event-based. Emits `LOG_CHUNK` events for stdout/stderr, `EXIT_CODE` when done. Does not interpret anything. Interpretation belongs in the pipeline layer. |

---

## Event Flow

```
BuildSupervisor (classifies, extracts, emits)
        │
        ▼
   BuildEvent (structured)
        │
        ├──► JobRegistry (persist state)
        │
        └──► Adapter subscribers
                  │
                  ├──► SSE (web UI)
                  ├──► Discord message (when severity matches)
                  └──► CLI stdout (live stream)
```

The daemon becomes an **event emitter → adapter subscribers** model. REST alone won't cut it for live updates.

---

## User Flow

1. User: "Adam, update the codebase to add tool X."
2. Adam creates Git branch, enters Dev Mode.
3. Adam spawns BuildSupervisor job.
4. Adam returns immediately to conversation.
5. Two loops exist:
   - **Conversation**: Responds to user, status queries, cancel, inspect diffs.
   - **Build**: Analyze → Patch → Build → Test → Capture errors → Retry → Emit events.
6. When meaningful events occur, Adam pushes conversational updates:
   - "Quick update — TypeScript failed in registry.ts. I'm adjusting the ProviderConfig union to fix narrowing."
   - "Tests failed. I'm patching. Running again. Green. Ready to merge."

---

## ErrorClassifier

BuildSupervisor parses logs and extracts structured signals. That parsing must be **explicit**, not ad-hoc.

Introduce a dedicated module: **`ErrorClassifier.ts`**

Responsibilities:

- Parse TypeScript compiler errors
- Parse Jest / Vitest failures
- Parse ESLint output
- Extract file paths, line numbers
- Produce structured `ERROR_DETECTED` events

**If you let the LLM interpret raw output every time, retries become unstable.** Structured error extraction makes retry loops deterministic.

---

## Retry Boundaries

`RETRY_SCHEDULED` is defined, but retry policy must be explicit:

| Stage | maxRetries | Notes |
|-------|------------|-------|
| `patch` | 5 | Most iterative; allow more attempts |
| `build` | 3 | Type errors, config fixes |
| `test` | 3 | Flaky tests, assertion fixes |

**Retry per stage**, not per job. If a stage exceeds `maxRetries` → emit `JOB_FAILED`.

Consider exponential backoff between retries for network-dependent stages (e.g. `dependency_install`). For `patch`/`build`/`test`, immediate retry is usually fine.

Bounded retries prevent infinite loops.

---

## Merge Flow

`AWAITING_REVIEW` is emitted when diff is ready. What happens next must be formalized.

**Explicit commands:**

| Command | Action |
|---------|--------|
| `approve` | Merge branch → emit `JOB_COMPLETED` |
| `reject` | Delete branch → emit `JOB_CANCELLED` |
| `amend` | Re-enter `patch` stage with feedback |

Otherwise the flow becomes ad-hoc and inconsistent.

---

## Where BuildSupervisor Runs

**Critical design decision.**

| Option | Pros | Cons |
|--------|------|------|
| Same process as daemon | Simpler deployment | Blocks event loop; no crash isolation |
| Separate worker process | Crash isolation; restart independently; clean fault boundary | IPC overhead; process management |
| Worker thread | Shared memory; lighter than process | Still blocks on CPU-heavy work; Node worker threads have limits |
| Child Node process | Isolated | Same as separate worker |

**Recommendation: Run BuildSupervisor as a separate worker process managed by the daemon.**

- Daemon owns `JobRegistry`
- Daemon owns adapter push (SSE, Discord, etc.)
- Daemon spawns supervisor worker
- Daemon restarts worker on crash
- Worker recovers job state from `JobRegistry` on startup

Cleaner fault boundary. CPU-heavy build work doesn't block the conversation loop.

---

## Controlled Narration

BuildSupervisor (via ErrorClassifier) parses logs and extracts structured signals. Adam converts signals into conversational updates.

**Do not** let the model narrate raw logs. Otherwise you get noisy garbage.

---

## Big Picture

You have now designed:

- **Persistent identity layer** — Adam remembers, adapts, has a profile
- **Deterministic CI engine** — BuildSupervisor with strict stages, bounded retries
- **Structured event telemetry** — Replayable, queryable, streamable
- **Human-gated merge workflow** — approve / reject / amend
- **Git-native branching discipline** — checkout, branch, merge

This is not "LLM agent stuff."

**This is a developer operating system.**

| | Cursor | Adam + BuildSupervisor |
|---|--------|------------------------|
| Identity | Ephemeral | Persistent |
| Memory | None | Episodic, profile, scratchpad |
| Build execution | In-session, blocks | Background, streamed |
| Merge flow | Ad-hoc | Formalized |

Cursor: ephemeral coding assistant.  
Adam + BuildSupervisor: persistent self-extending dev runtime.

---

## References

- `OVERVIEW.md` — Adam architecture
- `packages/core/src/executor.ts` — Current executor (do not reuse orchestration)
- `packages/skills/src/builtins/shell-tool.ts` — Current shell (do not mutate; add `shell_stream`)
- `packages/core/src/ErrorClassifier.ts` — To be created; parse TS/Jest/ESLint → structured events

---

---

## Implementation Phases

| Phase | Focus | Status |
|-------|-------|--------|
| **1** | Wire real git + build + test. No LLM patching. Pipeline is real. | Done |
| **2** | Add patch stage with controlled LLM call. Fixed engineering prompt. No memory injection. | Done |
| **3** | Agent integration: spawnJob(), getActiveJob(), cancelJob(), summarizeJob() | Done |
| **4** | SSE streaming. Adapters subscribe. Adam narrates meaningful events only. | Pending |

**Stage order (when real):**

1. `git checkout -b <branch>`
2. Install deps (if needed)
3. Run analyze LLM call
4. Apply patch
5. Run build
6. Run test
7. Classify errors (ErrorClassifier)
8. Schedule retry or move stage

**Critical:** Stages must be deterministic even without LLM. Supervisor controls progression. LLM supplies patch content only. Do not let LLM control stage progression logic.

---

## Sacred Separation

BuildSupervisor must **never** depend on:

- Agent personality
- Scratchpad
- Profile memory
- Conversation state

It should **only** depend on:

- Job config
- Repo path
- Deterministic prompt template

That separation is sacred.

---

*Last updated: March 2026*
