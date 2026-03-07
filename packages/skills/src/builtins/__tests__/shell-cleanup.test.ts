import { describe, it, expect } from "vitest";
import { shellTool, stopAllShellProcesses } from "../shell-tool.js";
import { execSync } from "node:child_process";

describe("Shell Process Cleanup", () => {
    it("should kill active processes on stopAllShellProcesses", async () => {
        // Start a long-running process
        // On Windows, 'ping -t localhost' or 'timeout /t 60'
        const command = process.platform === "win32" ? "ping -t localhost" : "sleep 60";

        const promise = (shellTool as any).execute({ command, timeoutMs: 5000 });

        // Give it a moment to start
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify it exists in task list (Windows)
        if (process.platform === "win32") {
            const tasks = execSync("tasklist").toString();
            expect(tasks.toLowerCase()).toContain("ping.exe");
        }

        // Trigger cleanup
        if (typeof stopAllShellProcesses === "function") {
            stopAllShellProcesses();
        }

        // Give it a moment to die
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify it's gone
        if (process.platform === "win32") {
            const tasks = execSync("tasklist").toString();
            expect(tasks.toLowerCase()).not.toContain("ping.exe");
        }
    });
});
