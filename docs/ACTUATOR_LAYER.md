# Actuator Layer: Structured Tool Execution

The Actuator Layer (implemented in `executor.py`) is the bridge between the agent's cognitive "Thought Pipeline" and the physical filesystem and network. It translates high-level creative intents into safe, structured technical actions.

## Key Capabilities

The Actuator provides a suite of atomic actions designed for project development and maintenance:

-   **`write_file(path, content)`**: Creates or overwrites files. Automatically handles directory creation.
-   **`read_file(path)`**: Safely retrieves file contents for context.
-   **`list_directory(path)`**: Provides visual mapping of the workspace.
-   **`run_python(path)`**: Executes a Python script in a subprocess. Used to verify logic, run tests, or generate data.
-   **`delete_file(path)`**: Permanently removes files (requires user confirmation).
-   **`publish_to_suno(lyrics, style, title)`**: Offloads browser automation to the Adam Daemon.

## Security & Path Isolation

The Actuator enforces strict security boundaries to prevent unauthorized filesystem access:

### Safe Path Guard
Every file operation is passed through a `_get_safe_path` resolver. This ensures:
-   All operations are strictly contained within the designated `base_dir` (e.g., `output/`).
-   Any attempt to use `..` or absolute paths to escape the directory is caught and raises an `Access denied` error.

### Sandboxed Execution
-   `run_python` calls are executed within the `base_dir` context.
-   Subprocesses are capped with timeouts (default 30s) to prevent hanging the engine.
-   Stdout and Stderr are captured and fed back to the agent for "self-correction" if the script fails.

## Intent-Action Loop

The Actuator supports a multi-iteration loop:
1.  **AI decides action**: Generates a JSON block.
2.  **Actuator executes**: Performs the task and captures the output.
3.  **Observation**: The result is fed back into the AI’s context.
4.  **Recalibration**: The AI adjusts its next response based on the tool's success or failure.

---

## Safety Intercepts

Destructive actions (like `delete_file`) are never executed blindly. The Actuator integrates with the **Safety System** to trigger manual user confirmation popups before proceeding.
