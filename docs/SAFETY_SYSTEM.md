# Safety System: Deletion & Resource Protection

Adam's Safety System ensures that the agent's autonomy does not lead to accidental data loss or system instability. It implements a layered approach to validation, using both automated guards and human-in-the-loop intercepts.

## Deletion Confirmation (Human Intercept)

The primary safety feature for destructive actions is the **Manual Confirmation Popup**. 

### How it works:
1.  **AI Request**: The Agent decides to delete a file and generates a `delete_file` action.
2.  **Intercept**: The Actuator (`executor.py`) detects the destructive nature of the tool.
3.  **Popup Trigger**: Before calling any internal deletion logic, the Actuator spawns a system-level popup using `tkinter`.
    -   The popup is forced to the front of the screen (`-topmost`).
    -   Execution is **paused** until the user provides a response.
4.  **Outcome**:
    -   **Yes**: The Actuator proceeds with `safe_path.unlink()`.
    -   **No**: The Actuator aborts the action and returns a `"User cancelled deletion"` error to the AI.

---

## Filesystem Protection

### Path Sanitization
The Actuator uses a strict `_get_safe_path` resolver for every file-related tool. It prevents:
-   **Directory Traversal**: Blocks `..` and `../../` patterns.
-   **Absolute Path Escapes**: Forces any absolute path provided by the AI to be re-rooted within the project's `base_dir` (e.g., `output/`).
-   **Drive Jumping**: On Windows systems, it prevents the agent from referencing different drive letters (e.g., `C:` vs `D:`).

### Non-Recursive Deletion
The current `delete_file` tool is restricted to **files only**. It explicitly checks if a path is a directory and returns an error if the agent attempts to delete a folder structure, preventing accidental mass-purges of project subdirectories.

---

## Process Safety

### Execution Timeouts
Tools that spawn external processes (like `run_python` or `shell`) are capped with a **30-second timeout**. If a script hangs or enters an infinite loop, the Safety System kills the process and returns an error to the engine, maintaining the integrity of the agent's reasoning loop.

## Process Monitoring and Stall Detection

To prevent the agent from "stalling" without explanation, the engine incorporates a real-time monitor for all tool executions:

-   **Parallel Execution**: Tools are executed in a separate thread, allowing the main engine loop to remain responsive.
-   **5-Second Alert**: If a tool operation (like a large file write or a network request) exceeds 5 seconds, the engine automatically triggers a "Stall Notification."
-   **User Feedback**: The agent sends a status update (e.g., *"Tool execution is taking longer than expected..."*) via the progress callback, ensuring the user is aware the agent is still active and investigating the delay.
-   **Diagnostic Timing**: Every tool execution result includes a `duration` field (in seconds), recorded at millisecond precision, allowing for detailed performance profiling.

### Sandboxed Automation
Browser automation (via the Suno tool) runs in a isolated `BrowserSession`. It does not have access to the user's main browser profile or cookies, protecting primary personal accounts.
