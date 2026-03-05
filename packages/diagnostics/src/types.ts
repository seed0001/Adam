/**
 * System diagnostics types — codebase analysis, pipeline tests, dynamic tests.
 */

export type ModuleExport = {
  kind: "function" | "class" | "const" | "type" | "interface";
  name: string;
  line: number;
};

export type ModuleInfo = {
  path: string;
  packageName: string;
  exports: ModuleExport[];
  imports: string[];
};

export type CodebaseAnalysis = {
  modules: ModuleInfo[];
  packages: { name: string; path: string; hasTests: boolean }[];
  totalExports: number;
  totalModules: number;
  analyzedAt: string;
};

export type PipelineStage = {
  id: string;
  name: string;
  module: string;
  functionName: string;
  description: string;
};

export type PipelineRegistry = {
  stages: PipelineStage[];
  flow: string[];
};

export type DynamicTestDefinition = {
  id: string;
  name: string;
  target: "classifier" | "planner" | "executor" | "build-supervisor" | "skill" | "custom";
  targetPath?: string;
  input: unknown;
  expected?: unknown;
  timeoutMs?: number;
};

export type TestResultStatus = "passed" | "failed" | "skipped" | "timeout" | "error";

export type SingleTestResult = {
  name: string;
  file: string;
  status: TestResultStatus;
  durationMs?: number;
  error?: string;
};

export type PackageTestResult = {
  package: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  durationMs: number;
  tests: SingleTestResult[];
};

export type DiagnosticRunResult = {
  runId: string;
  startedAt: string;
  completedAt: string;
  packageResults: PackageTestResult[];
  dynamicResults?: DynamicTestResult[];
  summary: {
    totalPassed: number;
    totalFailed: number;
    totalSkipped: number;
    totalTests: number;
    durationMs: number;
  };
};

export type DynamicTestResult = {
  testId: string;
  testName: string;
  status: TestResultStatus;
  durationMs?: number;
  error?: string;
  actual?: unknown;
};
