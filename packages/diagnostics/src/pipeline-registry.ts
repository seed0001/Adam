/**
 * Registry of pipeline stages — maps the Agent/BuildSupervisor flow to modules and functions.
 * Used by the diagnostic dashboard to show pipeline coverage and run per-stage tests.
 */

import type { PipelineRegistry, PipelineStage } from "./types.js";

export const PIPELINE_REGISTRY: PipelineRegistry = {
  flow: [
    "classify",
    "plan",
    "execute",
    "observe",
    // BuildSupervisor stages
    "checkout",
    "dependency_install",
    "analyze",
    "patch",
    "lint",
    "build",
    "test",
    "coverage",
    "review",
  ],
  stages: [
    // Agent pipeline
    {
      id: "classify",
      name: "Intent Classification",
      module: "@adam/core",
      functionName: "IntentClassifier.classify",
      description: "Classifies user intent, complexity, and whether planning is needed",
    },
    {
      id: "plan",
      name: "Task Planning",
      module: "@adam/core",
      functionName: "Planner.plan",
      description: "Builds a TaskGraph (DAG) from the goal",
    },
    {
      id: "execute",
      name: "Task Execution",
      module: "@adam/core",
      functionName: "Executor.execute",
      description: "Runs tasks via TaskQueue using tools from ToolRegistry",
    },
    {
      id: "observe",
      name: "Observation",
      module: "@adam/core",
      functionName: "Agent.observe",
      description: "Processes tool results and decides next step",
    },
    // BuildSupervisor pipeline
    {
      id: "checkout",
      name: "Git Checkout",
      module: "@adam/core",
      functionName: "runGitCheckout",
      description: "Checks out the target branch",
    },
    {
      id: "dependency_install",
      name: "Dependency Install",
      module: "@adam/core",
      functionName: "runShellCommand",
      description: "Installs dependencies (npm/pnpm/yarn)",
    },
    {
      id: "analyze",
      name: "LLM Analyze",
      module: "@adam/core",
      functionName: "BuildSupervisor.analyze",
      description: "LLM analyzes goal and produces patch plan",
    },
    {
      id: "patch",
      name: "Code Patch",
      module: "@adam/core",
      functionName: "BuildSupervisor.patch",
      description: "Applies patches via code tools",
    },
    {
      id: "lint",
      name: "Lint",
      module: "@adam/core",
      functionName: "runShellCommand",
      description: "Runs linter",
    },
    {
      id: "build",
      name: "Build",
      module: "@adam/core",
      functionName: "runShellCommand",
      description: "Runs build command",
    },
    {
      id: "test",
      name: "Test",
      module: "@adam/core",
      functionName: "runShellCommand",
      description: "Runs test suite",
    },
    {
      id: "coverage",
      name: "Coverage",
      module: "@adam/core",
      functionName: "runShellCommand",
      description: "Runs coverage",
    },
    {
      id: "review",
      name: "Review",
      module: "@adam/core",
      functionName: "BuildSupervisor.review",
      description: "Generates diff summary for approval",
    },
  ],
};
