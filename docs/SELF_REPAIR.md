# Self-Repair: The Failure Reflex Loop

Adam is designed to be resilient. When an execution step fails, the system doesn't just stop; it triggers an autonomous self-repair cycle known as the **Failure Reflex Loop**.

---

## 1. Robust File Handling
Before a repair can even be attempted, the system ensures that its basic tools are reliable.

### Read-after-Write Verification
Every time Adam writes or edits a file using `code_write_file` or `code_edit_file`, a mandatory verification step occurs:
1. **The Write**: Code is written to the target path.
2. **The Read**: The system immediately reads the file back from disk.
3. **The Verify**: It confirms that the content matches the expected buffer.

If verification fails, an error is thrown immediately, preventing the agent from proceeding based on a "hallucinated" file state.

---

## 2. The Reflex Loop Flow
The Failure Reflex Loop is integrated directly into the `Agent.planAndExecute` cycle.

### Phase 1: Capture
When the `Executor` encounters an error, it captures a high-fidelity `errorContext`:
- The exact tool call that failed.
- The error message and stack trace.
- The state of the workspace at the moment of failure.

### Phase 2: Diagnose
The `PatchService` is invoked with this context. It uses a "Capable" model tier to answer:
- *Why* did it fail? (e.g., Syntax error, missing dependency, incorrect path).
- *Where* is the root cause?
- *What* is the minimal fix?

### Phase 3: Propose
Adam generates a **Patch Proposal**:
- **Rationale**: A natural language explanation of the bug and the fix.
- **Unified Diff**: A standard diff format of the proposed change.
- **Target File**: The absolute path to the file being fixed.

---

## 3. Human-in-the-Loop Approval
Adam never self-modifies without permission.

### The Patch Queue
All proposals are sent to the **Patch Queue**, accessible via:
- **Web Dashboard**: The "Patches" tab under Diagnostics.
- **REST API**: `/api/patches` endpoints.

### Application via Git
Once you approve a patch:
1. The daemon uses `git apply --ignore-whitespace` to land the change.
2. Using `git` ensures that the patch is applied safely and cleanly, even if there are minor whitespace differences.
3. If the patch fails to apply (e.g., the file has drifted significantly), the status is updated to "failed" and you are notified.

---

## 4. Proactive Improvement (Review Loop)
The same `PatchService` used for failures also runs in a background **Review Loop**.
- **Stochastic Cycle**: Runs at random intervals (e.g., every 8-12 hours) to avoid repetitive polling.
- **Codebase Analysis**: Scans the current profile and recently edited files.
- **Optimization**: Proposes improvements for performance, edge cases, or documentation—even if no error occurred.

---

*Last updated: March 2026*
