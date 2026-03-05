/**
 * @adam/diagnostics — System diagnostic dashboard backend.
 *
 * - Codebase analysis (modules, exports, pipeline stages)
 * - Pipeline test runner (Vitest across packages)
 * - Dynamic test definitions (user-compiled tests)
 */

export { analyzeCodebase } from "./codebase-analyzer.js";
export { PIPELINE_REGISTRY } from "./pipeline-registry.js";
export { runAllTests } from "./test-runner.js";
export {
  getDynamicTests,
  addDynamicTest,
  removeDynamicTest,
  clearDynamicTests,
  setDynamicTests,
  runDynamicTest,
  runAllDynamicTests,
} from "./dynamic-test.js";
export type { DynamicTestStore } from "./dynamic-test.js";
export type {
  CodebaseAnalysis,
  ModuleInfo,
  ModuleExport,
  PipelineRegistry,
  PipelineStage,
  DynamicTestDefinition,
  DiagnosticRunResult,
  PackageTestResult,
  SingleTestResult,
  DynamicTestResult,
  TestResultStatus,
} from "./types.js";
