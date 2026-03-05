# System Diagnostics Dashboard

The diagnostics dashboard provides end-to-end visibility into the Adam codebase: module analysis, pipeline stages, and dynamic test execution across all packages.

---

## Overview

| Feature | Description |
|---------|-------------|
| **Codebase analysis** | Scans `packages/` and `apps/`, extracts exports (function, class, const, type, interface) and imports |
| **Pipeline registry** | Maps Agent and BuildSupervisor stages to modules and functions |
| **Test runner** | Runs Vitest across all packages with tests, parses JSON output |
| **Dynamic tests** | User-defined tests (JSON) that can target classifier, planner, executor, build-supervisor, or custom paths |

---

## Web dashboard

Open the **Diagnostics** tab in the web dashboard (http://localhost:18800).

**Tabs within Diagnostics:**

| Tab | What it shows |
|-----|---------------|
| **Codebase** | Module count, export count, packages with tests, modules & exports list |
| **Pipeline** | Flow diagram (classify → plan → execute → observe + BuildSupervisor stages), stage details |
| **Pipeline Test** | Runs a fixed prompt through the agent; shows workspace, pool, Ollama status, and response |
| **Dynamic Tests** | List of user-defined tests, JSON editor to add new tests |
| **Results** | Summary (passed/failed/skipped), per-package results with individual test status |

**Actions:**
- **Run All Tests** — Runs Vitest across core, shared, memory, security, adapters, models, skills, voice, cli
- **Run Pipeline Test** — Sends *"Hi, dude. Can you create a discord in python and save it to our projects folder, please"* through the agent; verifies Ollama and code tools are wired
- **Refresh** — Reloads analysis, pipeline, tests, and last results

---

## API endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/diagnostics/analysis` | GET | Codebase analysis (modules, exports, packages) |
| `/api/diagnostics/pipeline` | GET | Pipeline stages and flow |
| `/api/diagnostics/tests` | GET | List dynamic tests |
| `/api/diagnostics/tests` | POST | Add or replace dynamic tests (`{ test }` or `{ tests }`) |
| `/api/diagnostics/tests/:id` | DELETE | Remove a dynamic test |
| `/api/diagnostics/run` | POST | Run all Vitest tests across packages |
| `/api/diagnostics/results` | GET | Last run results (or error if none yet) |
| `/api/diagnostics/pipeline-test` | POST | Run a fixed test prompt through the agent (Ollama + code tools verification) |

---

## Pipeline test (Ollama + code tools)

If applications aren't being created, the pipeline test helps verify:

1. **Ollama is enabled** — `config.providers.ollama.enabled` must be `true`
2. **Ollama is running** — Start with `ollama serve`; default URL is `http://127.0.0.1:11434`
3. **Ollama is in the pool** — The model pool must include Ollama models (fast, capable, coder)
4. **Workspace points to projects** — Set `config.daemon.workspace` to your projects folder (e.g. `~/projects` or `C:\Users\you\projects`). Code tools write files relative to this path.

The test prompt is: *"Hi, dude. Can you create a discord in python and save it to our projects folder, please"*. A successful run means the agent received the message, called the model (Ollama or cloud), and returned a response. Check the Diagnostics tab for workspace path, pool models, and any errors.

### Backend hook: Codex or Claude Code

`POST /api/diagnostics/pipeline-test` supports backend routing:

```json
{
  "backend": "auto",
  "maxAttempts": 2,
  "requireOllama": true
}
```

`backend` options:
- `auto` — try `codex`, then `claude`, then internal `agent`
- `codex` — Codex CLI only
- `claude` — Claude Code CLI only
- `agent` — internal Adam agent only

You can override CLI command wiring with environment variables:
- `ADAM_CODEX_BIN` (default: `codex`)
- `ADAM_CODEX_ARGS_JSON` (JSON array of args, supports `{{PROMPT}}`)
- `ADAM_CLAUDE_BIN` (default: `claude`)
- `ADAM_CLAUDE_ARGS_JSON` (JSON array of args, supports `{{PROMPT}}`)

The endpoint now returns per-backend traces (`available`, `command`, `exitCode`, `timedOut`, `stderrPreview`) plus strict filesystem verification details so false-positive "success" claims are rejected.

---

## Package: `@adam/diagnostics`

**Location:** `packages/diagnostics/`

**Exports:**
- `analyzeCodebase(rootDir)` — Returns `CodebaseAnalysis`
- `PIPELINE_REGISTRY` — `{ stages, flow }`
- `runAllTests(rootDir)` — Returns `DiagnosticRunResult`
- `getDynamicTests()`, `addDynamicTest()`, `removeDynamicTest()`, `setDynamicTests()`, `clearDynamicTests()`
- `runDynamicTest()`, `runAllDynamicTests()` — Placeholder; full execution requires daemon context

**Types:**
- `CodebaseAnalysis` — modules, packages, totalExports, totalModules, analyzedAt
- `ModuleInfo` — path, packageName, exports, imports
- `PipelineStage` — id, name, module, functionName, description
- `DynamicTestDefinition` — id, name, target, targetPath?, input, expected?, timeoutMs?
- `DiagnosticRunResult` — runId, startedAt, completedAt, packageResults, summary
- `PackageTestResult` — package, passed, failed, skipped, total, durationMs, tests
- `SingleTestResult` — name, file, status, durationMs?, error?

---

## Pipeline stages

The pipeline registry maps the Agent and BuildSupervisor flow:

**Agent pipeline:**
- `classify` — IntentClassifier.classify
- `plan` — Planner.plan
- `execute` — Executor.execute
- `observe` — Agent.observe

**BuildSupervisor pipeline:**
- `checkout` — runGitCheckout
- `dependency_install` — runShellCommand
- `analyze` — BuildSupervisor.analyze (LLM)
- `patch` — BuildSupervisor.patch (code tools)
- `lint` — runShellCommand
- `build` — runShellCommand
- `test` — runShellCommand
- `coverage` — runShellCommand
- `review` — BuildSupervisor.review

---

## Dynamic test format

```json
{
  "id": "t1",
  "name": "Classifier smoke",
  "target": "classifier",
  "input": { "text": "hello" },
  "expected": { "requiresPlanning": false },
  "timeoutMs": 5000
}
```

**Targets:** `classifier` | `planner` | `executor` | `build-supervisor` | `skill` | `custom`

**Note:** Dynamic test execution currently returns a placeholder. Full execution requires daemon context (router, tools, etc.). The test store and API are in place for future implementation.

---

## Test runner

`runAllTests(rootDir)`:
1. Creates `.diagnostics/` directory (gitignored)
2. For each package (core, shared, memory, security, adapters, models, skills, voice, cli):
   - Runs `pnpm exec vitest run --reporter=json --outputFile=.diagnostics/vitest-<pkg>-<runId>.json`
   - Parses JSON output (Jest-compatible format from Vitest)
   - Aggregates passed/failed/skipped
3. Returns `DiagnosticRunResult` with package-level and summary stats

---

## Codebase analyzer

`analyzeCodebase(rootDir)`:
- Walks `packages/` and `apps/` (excludes node_modules, dist, .git, coverage, __tests__)
- Extracts exports via regex: `export function`, `export class`, `export const`, `export type`, `export interface`
- Extracts imports (external packages only)
- Detects packages with test files (`.test.ts`, `.test.tsx` under src or package root)
- Returns `CodebaseAnalysis` with modules, packages, totals

---

## Files

```
packages/diagnostics/
├── src/
│   ├── index.ts           # Exports
│   ├── types.ts           # Type definitions
│   ├── codebase-analyzer.ts
│   ├── pipeline-registry.ts
│   ├── test-runner.ts
│   └── dynamic-test.ts
├── package.json
└── tsconfig.json
```

---

*Last updated: March 2026*
