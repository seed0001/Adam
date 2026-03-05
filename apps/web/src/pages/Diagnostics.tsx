import { useState, useEffect, useCallback } from "react";
import {
  api,
  type DiagnosticsAnalysis,
  type DiagnosticsPipeline,
  type DynamicTestDefinition,
  type DiagnosticRunResult,
  type PackageTestResult,
  type PipelineTestResult,
} from "../lib/api";

function Card({
  children,
  className = "",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div className={`bg-[#111111] border border-[#1e1e1e] rounded-xl p-4 ${className}`}>
      {title && (
        <p className="text-[11px] text-zinc-600 font-medium uppercase tracking-wider mb-3">{title}</p>
      )}
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    passed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
    failed: "bg-red-500/20 text-red-400 border-red-500/40",
    skipped: "bg-amber-500/20 text-amber-400 border-amber-500/40",
    error: "bg-red-500/20 text-red-400 border-red-500/40",
    timeout: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  };
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${colors[status] ?? "bg-zinc-500/20 text-zinc-400"}`}
    >
      {status}
    </span>
  );
}

export default function Diagnostics() {
  const [analysis, setAnalysis] = useState<DiagnosticsAnalysis | null>(null);
  const [pipeline, setPipeline] = useState<DiagnosticsPipeline | null>(null);
  const [dynamicTests, setDynamicTests] = useState<DynamicTestDefinition[]>([]);
  const [results, setResults] = useState<DiagnosticRunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"analysis" | "pipeline" | "pipeline-test" | "tests" | "results">("analysis");
  const [pipelineTestResult, setPipelineTestResult] = useState<PipelineTestResult | null>(null);
  const [pipelineTestRunning, setPipelineTestRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, p, t, r] = await Promise.all([
        api.getDiagnosticsAnalysis().catch(() => null),
        api.getDiagnosticsPipeline().catch(() => null),
        api.getDiagnosticsTests().catch(() => []),
        api.getDiagnosticsResults().catch(() => null),
      ]);
      setAnalysis(a ?? null);
      setPipeline(p ?? null);
      setDynamicTests(t ?? []);
      if (r && !("error" in r)) setResults(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load diagnostics");
    } finally {
      setLoading(false);
    }
  }, []);

  const runTests = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await api.runDiagnostics();
      setResults(r);
      setActiveTab("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run tests");
    } finally {
      setRunning(false);
    }
  }, []);

  const runPipelineTest = useCallback(async () => {
    setPipelineTestRunning(true);
    setPipelineTestResult(null);
    setError(null);
    try {
      const r = await api.runPipelineTest();
      setPipelineTestResult(r);
      setActiveTab("pipeline-test");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pipeline test failed");
    } finally {
      setPipelineTestRunning(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs text-zinc-600">Loading diagnostics…</p>
      </div>
    );
  }

  const tabs = [
    { id: "analysis" as const, label: "Codebase" },
    { id: "pipeline" as const, label: "Pipeline" },
    { id: "pipeline-test" as const, label: "Pipeline Test" },
    { id: "tests" as const, label: "Dynamic Tests" },
    { id: "results" as const, label: "Results" },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e1e] shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-200">System Diagnostics</h2>
          <button
            onClick={() => void runTests()}
            disabled={running}
            className="px-3 py-1.5 rounded text-xs font-medium bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {running ? "Running…" : "Run All Tests"}
          </button>
          <button
            onClick={() => void runPipelineTest()}
            disabled={pipelineTestRunning}
            className="px-3 py-1.5 rounded text-xs font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {pipelineTestRunning ? "Running…" : "Run Pipeline Test"}
          </button>
          <button
            onClick={() => void load()}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-2 text-red-400 text-xs bg-red-950/30 border border-red-900/40 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-[#1a1a1a] shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === t.id ? "bg-[#1a1a1a] text-accent" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        {activeTab === "analysis" && analysis && (
          <div className="space-y-4">
            <Card title="Overview">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-zinc-500 text-xs">Modules</p>
                  <p className="text-zinc-200 font-medium">{analysis.totalModules}</p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs">Exports</p>
                  <p className="text-zinc-200 font-medium">{analysis.totalExports}</p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs">Packages</p>
                  <p className="text-zinc-200 font-medium">{analysis.packages.length}</p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs">Analyzed</p>
                  <p className="text-zinc-200 font-medium text-[10px]">
                    {new Date(analysis.analyzedAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </Card>
            <Card title="Packages">
              <div className="flex flex-wrap gap-2">
                {analysis.packages.map((p) => (
                  <span
                    key={p.name}
                    className={`text-[10px] px-2 py-1 rounded border ${
                      p.hasTests ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                    }`}
                  >
                    {p.name} {p.hasTests ? "✓" : ""}
                  </span>
                ))}
              </div>
            </Card>
            <Card title="Modules & Exports">
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {analysis.modules.slice(0, 50).map((m) => (
                  <div key={m.path} className="text-xs border-b border-[#181818] pb-2 last:border-0">
                    <p className="text-zinc-400 font-mono truncate">{m.path}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {m.exports.slice(0, 8).map((e) => (
                        <span
                          key={e.name}
                          className="text-[10px] text-zinc-500 bg-zinc-900/60 px-1 rounded"
                        >
                          {e.kind} {e.name}
                        </span>
                      ))}
                      {m.exports.length > 8 && (
                        <span className="text-[10px] text-zinc-600">+{m.exports.length - 8}</span>
                      )}
                    </div>
                  </div>
                ))}
                {analysis.modules.length > 50 && (
                  <p className="text-zinc-600 text-xs">… and {analysis.modules.length - 50} more</p>
                )}
              </div>
            </Card>
          </div>
        )}

        {activeTab === "pipeline-test" && (
          <div className="space-y-4">
            <Card title="Pipeline Test (Ollama + Code Tools)">
              <p className="text-zinc-500 text-xs mb-3">
                Sends a fixed prompt through the agent to verify Ollama and code tools are wired. If applications
                aren&apos;t being created, check that Ollama is running and workspace points to your projects folder.
              </p>
              <div className="rounded bg-[#0d0d0d] border border-[#1a1a1a] px-3 py-2 mb-3">
                <p className="text-zinc-500 text-[10px] uppercase tracking-wider mb-1">Test prompt</p>
                <p className="text-zinc-300 text-xs font-mono">
                  &quot;Hi, dude. Can you create a discord in python and save it to our projects folder, please&quot;
                </p>
              </div>
              {pipelineTestResult ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={pipelineTestResult.ok ? "passed" : "failed"} />
                    <span className="text-xs text-zinc-400">
                      {pipelineTestResult.ok ? "Agent responded successfully" : pipelineTestResult.error ?? "Error"}
                    </span>
                  </div>
                  {pipelineTestResult.diagnostics && (
                    <div className="rounded bg-[#0d0d0d] border border-[#1a1a1a] px-3 py-2 text-xs space-y-1">
                      <p className="text-zinc-500 text-[10px] uppercase tracking-wider">Diagnostics</p>
                      <p className="text-zinc-400">
                        Workspace: <span className="font-mono text-zinc-300">{pipelineTestResult.diagnostics.workspace}</span>
                      </p>
                      {pipelineTestResult.diagnostics.backendMode && (
                        <p className="text-zinc-400">
                          Backend mode: <span className="font-mono text-zinc-300">{pipelineTestResult.diagnostics.backendMode}</span>
                          {pipelineTestResult.diagnostics.backendOrder && pipelineTestResult.diagnostics.backendOrder.length > 0 && (
                            <span className="text-zinc-500"> · order: {pipelineTestResult.diagnostics.backendOrder.join(" -> ")}</span>
                          )}
                        </p>
                      )}
                      {pipelineTestResult.diagnostics.targetProjectRoot && (
                        <p className="text-zinc-400">
                          Project root:{" "}
                          <span className="font-mono text-zinc-300">{pipelineTestResult.diagnostics.targetProjectRoot}</span>
                        </p>
                      )}
                      <p className="text-zinc-400">
                        Ollama in config: {pipelineTestResult.diagnostics.configOllamaEnabled ? "enabled" : "disabled"}
                      </p>
                      <p className="text-zinc-400">
                        Ollama in pool: {pipelineTestResult.diagnostics.pool.ollamaInPool ? "yes" : "no"}
                      </p>
                      {pipelineTestResult.diagnostics.ollamaProbe && (
                        <p className="text-zinc-400">
                          Ollama probe:{" "}
                          <span className={pipelineTestResult.diagnostics.ollamaProbe.reachable ? "text-emerald-400" : "text-red-400"}>
                            {pipelineTestResult.diagnostics.ollamaProbe.status}
                          </span>{" "}
                          · {pipelineTestResult.diagnostics.ollamaProbe.message}
                        </p>
                      )}
                      <p className="text-zinc-400">
                        Models: fast={pipelineTestResult.diagnostics.pool.fast ?? "—"} · capable=
                        {pipelineTestResult.diagnostics.pool.capable ?? "—"} · coder=
                        {pipelineTestResult.diagnostics.pool.coder ?? "—"}
                      </p>
                    </div>
                  )}
                  {pipelineTestResult.summary && (
                    <div className="rounded bg-[#0d0d0d] border border-[#1a1a1a] px-3 py-2 text-xs space-y-1">
                      <p className="text-zinc-500 text-[10px] uppercase tracking-wider">Verification Summary</p>
                      <p className="text-zinc-400">
                        Attempts: {pipelineTestResult.summary.attemptsRun} · Successful attempt:{" "}
                        {pipelineTestResult.summary.successfulAttempt ?? "none"}
                      </p>
                      <p className="text-zinc-400">
                        Files created: {pipelineTestResult.summary.filesCreated} · Python files:{" "}
                        {pipelineTestResult.summary.pythonFilesCreated}
                      </p>
                      <p className="text-zinc-400">
                        Verified root: <span className="font-mono text-zinc-300">{pipelineTestResult.summary.projectRoot}</span>
                      </p>
                    </div>
                  )}
                  {pipelineTestResult.attempts && pipelineTestResult.attempts.length > 0 && (
                    <div className="rounded bg-[#0d0d0d] border border-[#1a1a1a] px-3 py-2">
                      <p className="text-zinc-500 text-[10px] uppercase tracking-wider mb-2">Attempts</p>
                      <div className="space-y-3 max-h-72 overflow-y-auto">
                        {pipelineTestResult.attempts.map((attempt) => (
                          <div key={attempt.attempt} className="border border-[#1a1a1a] rounded px-2 py-2 text-xs">
                            <div className="flex items-center gap-2 mb-1">
                              <StatusBadge status={attempt.ok ? "passed" : "failed"} />
                              <span className="text-zinc-300">Attempt #{attempt.attempt}</span>
                              {attempt.backendUsed && <span className="text-[10px] text-zinc-500">via {attempt.backendUsed}</span>}
                              <span className="text-zinc-600">{attempt.durationMs}ms</span>
                            </div>
                            <p className="text-zinc-500">
                              JSON parse: {attempt.jsonParseOk ? "ok" : `failed (${attempt.jsonParseError ?? "unknown"})`}
                            </p>
                            <p className="text-zinc-500">
                              Files: {attempt.fsSnapshot.totalFiles} · Python: {attempt.fsSnapshot.pythonFiles.length}
                            </p>
                            {attempt.declaredPaths.length > 0 && (
                              <p className="text-zinc-500 truncate" title={attempt.declaredPaths.join(", ")}>
                                Declared paths: {attempt.declaredPaths.join(", ")}
                              </p>
                            )}
                            {attempt.failureReasons.length > 0 && (
                              <div className="mt-1 space-y-0.5">
                                {attempt.failureReasons.map((reason, i) => (
                                  <p key={i} className="text-red-400 text-[11px]">• {reason}</p>
                                ))}
                              </div>
                            )}
                            {attempt.backendTrace.length > 0 && (
                              <div className="mt-2 pt-2 border-t border-[#1a1a1a] space-y-1">
                                <p className="text-zinc-500 text-[10px] uppercase tracking-wider">Backend trace</p>
                                {attempt.backendTrace.map((t, i) => (
                                  <div key={i} className="text-[11px] text-zinc-500">
                                    <span className="text-zinc-300">{t.backend}</span>
                                    {typeof t.available === "boolean" && <span> · available={String(t.available)}</span>}
                                    {t.command && <span> · cmd={t.command}</span>}
                                    {typeof t.exitCode !== "undefined" && <span> · exit={String(t.exitCode)}</span>}
                                    {t.timedOut && <span className="text-red-400"> · timed out</span>}
                                    {t.error && <span className="text-red-400"> · {t.error}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {pipelineTestResult.nextActions && pipelineTestResult.nextActions.length > 0 && (
                    <div className="rounded bg-amber-950/20 border border-amber-900/40 px-3 py-2">
                      <p className="text-amber-300 text-[10px] uppercase tracking-wider mb-1">Next actions</p>
                      <div className="space-y-0.5">
                        {pipelineTestResult.nextActions.map((step, i) => (
                          <p key={i} className="text-amber-200 text-xs">- {step}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {pipelineTestResult.response && (
                    <div className="rounded bg-[#0d0d0d] border border-[#1a1a1a] px-3 py-2">
                      <p className="text-zinc-500 text-[10px] uppercase tracking-wider mb-1">Response</p>
                      <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-sans">
                        {pipelineTestResult.response}
                      </pre>
                    </div>
                  )}
                  {pipelineTestResult.error && !pipelineTestResult.ok && (
                    <div className="rounded bg-red-950/30 border border-red-900/40 px-3 py-2">
                      <p className="text-red-400 text-xs">{pipelineTestResult.error}</p>
                      {pipelineTestResult.errorCode && (
                        <p className="text-red-500/80 text-[10px] mt-1">Code: {pipelineTestResult.errorCode}</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-zinc-600 text-xs">Click &quot;Run Pipeline Test&quot; in the header to run.</p>
              )}
            </Card>
          </div>
        )}

        {activeTab === "pipeline" && pipeline && (
          <div className="space-y-4">
            <Card title="Pipeline Flow">
              <div className="flex flex-wrap gap-2 items-center">
                {pipeline.flow.map((stageId, i) => (
                  <span key={stageId} className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-1 rounded bg-accent/10 text-accent border border-accent/30">
                      {stageId}
                    </span>
                    {i < pipeline.flow.length - 1 && <span className="text-zinc-600">→</span>}
                  </span>
                ))}
              </div>
            </Card>
            <Card title="Stages">
              <div className="space-y-2">
                {pipeline.stages.map((s) => (
                  <div key={s.id} className="flex items-start gap-3 py-2 border-b border-[#181818] last:border-0">
                    <span className="text-accent font-mono text-xs shrink-0">{s.id}</span>
                    <div>
                      <p className="text-zinc-200 text-xs font-medium">{s.name}</p>
                      <p className="text-zinc-500 text-[10px]">{s.functionName}</p>
                      <p className="text-zinc-600 text-[10px] mt-0.5">{s.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {activeTab === "tests" && (
          <div className="space-y-4">
            <Card title="Dynamic Tests">
              <p className="text-zinc-500 text-xs mb-3">
                Define tests to run against pipeline functions. Add via JSON below or use the API.
              </p>
              {dynamicTests.length === 0 ? (
                <p className="text-zinc-600 text-xs">No dynamic tests defined.</p>
              ) : (
                <div className="space-y-2">
                  {dynamicTests.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between py-2 px-3 rounded bg-[#0d0d0d] border border-[#1a1a1a]"
                    >
                      <div>
                        <p className="text-zinc-200 text-xs font-medium">{t.name}</p>
                        <p className="text-zinc-500 text-[10px]">target: {t.target}</p>
                      </div>
                      <button
                        onClick={async () => {
                          await api.removeDiagnosticsTest(t.id);
                          setDynamicTests(await api.getDiagnosticsTests());
                        }}
                        className="text-[10px] text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card title="Add Test (JSON)">
              <DynamicTestEditor
                onAdd={async (test) => {
                  await api.addDiagnosticsTest(test);
                  setDynamicTests(await api.getDiagnosticsTests());
                }}
              />
            </Card>
          </div>
        )}

        {activeTab === "results" && (
          <div className="space-y-4">
            {results ? (
              <>
                <Card title="Summary">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
                    <div>
                      <p className="text-zinc-500 text-xs">Passed</p>
                      <p className="text-emerald-400 font-medium">{results.summary.totalPassed}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500 text-xs">Failed</p>
                      <p className="text-red-400 font-medium">{results.summary.totalFailed}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500 text-xs">Skipped</p>
                      <p className="text-amber-400 font-medium">{results.summary.totalSkipped}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500 text-xs">Total</p>
                      <p className="text-zinc-200 font-medium">{results.summary.totalTests}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500 text-xs">Duration</p>
                      <p className="text-zinc-200 font-medium">{results.summary.durationMs}ms</p>
                    </div>
                  </div>
                </Card>
                {results.packageResults.map((pkg: PackageTestResult) => (
                  <Card key={pkg.package} title={`@adam/${pkg.package}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <StatusBadge status={pkg.failed > 0 ? "failed" : "passed"} />
                      <span className="text-xs text-zinc-500">
                        {pkg.passed} passed, {pkg.failed} failed, {pkg.skipped} skipped · {pkg.durationMs}ms
                      </span>
                    </div>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {pkg.tests.map((t, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between py-1.5 px-2 rounded text-xs hover:bg-[#0d0d0d]"
                        >
                          <span className="text-zinc-300 truncate flex-1">{t.name}</span>
                          <StatusBadge status={t.status} />
                          {t.error && (
                            <span className="text-red-400 text-[10px] truncate max-w-[200px]" title={t.error}>
                              {t.error}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </>
            ) : (
              <Card>
                <p className="text-zinc-500 text-sm">No test results yet. Click &quot;Run All Tests&quot; to run the pipeline.</p>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DynamicTestEditor({ onAdd }: { onAdd: (test: DynamicTestDefinition) => Promise<void> }) {
  const [json, setJson] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const handleAdd = async () => {
    setErr(null);
    try {
      const parsed = JSON.parse(json) as DynamicTestDefinition;
      if (!parsed.id || !parsed.name || !parsed.target) {
        setErr("Test must have id, name, and target");
        return;
      }
      await onAdd(parsed);
      setJson("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  return (
    <div>
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        placeholder='{"id":"t1","name":"Classifier smoke","target":"classifier","input":{"text":"hello"}}'
        className="w-full h-24 px-3 py-2 rounded bg-[#0d0d0d] border border-[#1a1a1a] text-xs font-mono text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-accent/50"
      />
      {err && <p className="text-red-400 text-xs mt-1">{err}</p>}
      <button
        onClick={() => void handleAdd()}
        className="mt-2 px-3 py-1.5 rounded text-xs font-medium bg-accent/20 text-accent hover:bg-accent/30"
      >
        Add Test
      </button>
    </div>
  );
}
