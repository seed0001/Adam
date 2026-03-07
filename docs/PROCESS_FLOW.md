# Adam Process Flow: Intent to Execution

This document outlines the end-to-end flow of information and decision-making in Adam, from the moment an input is received to the final synthesis of the response and background self-improvement loops.

---

## 1. Input Receiving
All interactions begin with an inbound message from an **Adapter** (CLI, Web, Discord, Telegram). This message contains the user's content, session metadata, any attachments, and authentication context.

## 2. Intent Classification (Deciding "What to Do")
The **Classifier** is the entry point for decision-making.
- **Analysis**: It uses a "fast" model tier to categorize the user's intent (e.g., `chat`, `task`, `help`, `personality`).
- **Complexity Detection**: Adam determines if the request is trivial, simple, complex, or multi-step.
- **Intent Mapping**: Based on the classification, the system determines the response strategy—direct response for simple queries, or transition to a multi-step action plan for tasks.

## 3. Planning (Deciding "How to Do It")
If a "task" intent is identified, the **Planner** takes over.
- **Goal Decomposition**: It breaks down high-level goals into a structured **TaskGraph** (DAG).
- **Task Dependencies**: Each task specifies its prerequisites, ensuring logical order (e.g., "read file" must precede "edit file").
- **Tool Assignment**: The planner selects appropriate tools (e.g., `code_edit_file`, `shell_command`) and assigns them to specific tasks.

## 4. Execution (Action & Orchestration)
The **Executor** processes the **TaskQueue** concurrently where possible.
- **Worker Loop**: It pulls tasks whose dependencies are satisfied.
- **Tool Execution**: Invokes the tool functions with validated inputs.
- **Write Verification**: Every file operation undergoes mandatory **read-after-write verification** to ensure local filesystem integrity.
- **Real-time Events**: The `AgentEventBus` emits status updates (Thinking, Executing, Success, Failure) to all connected adapters and the web dashboard.

## 5. Self-Repair (The Reflex Loop)
If a task fail during execution, Adam doesn't just give up.
- **Automatic Diagnosis**: The **PatchService** analyzes the error logs, stack traces, and local code context.
- **Patch Proposal**: It generates a unified diff designed to fix the underlying issue.
- **Human-in-the-Loop**: The patch is stored in the **Patch Queue**. It is only applied using `git apply` after explicit user approval via the web dashboard or CLI.

## 6. Continuous Improvement (The Review Loop)
The system "metabolizes" its history periodically in a stochastic background cycle:
- **Proactive Review**: Periodically scans conversation history and system diagnostics for performance optimizations or quality enhancements.
- **Behavior Reinforcement**: Tracks positive/negative feedback signals to shape Adam's persistent traits (e.g., Initiative, Concise Communication).
- **Golden Examples**: Curates exemplary interactions to serve as future technical and personality benchmarks.

## 7. Result Synthesis
After execution completes (or fails), the **Agent** gathers all tool outputs, observations, and plan results to craft a final, user-facing response. This synthesis provides context on what was accomplished and any recommendations for next steps.

---

*Last updated: March 2026*
