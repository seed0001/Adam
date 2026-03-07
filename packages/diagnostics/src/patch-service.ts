import { type Result, type AdamError, ok, err, adamError } from "@adam/shared";

export interface DiagnosticRouter {
    generate(opts: {
        sessionId: string;
        tier: "fast" | "capable" | "coder";
        system: string;
        prompt: string;
    }): Promise<Result<string, AdamError>>;
}

export interface PatchProposal {
    rationale: string;
    patch: {
        filePath: string;
        diff: string;
    };
}

export class PatchService {
    constructor(private router: DiagnosticRouter) { }

    /**
     * Diagnoses a task failure and proposes a code patch to fix it.
     */
    async diagnoseFailure(
        sessionId: string,
        errorMsg: string,
        context: {
            taskId: string;
            description: string;
            input: any;
            logs?: string | undefined;
            codeSnippet?: string | undefined;
        }
    ): Promise<Result<PatchProposal, AdamError>> {
        const prompt = `
Analyzing failure for Task ID: ${context.taskId}
Task Description: ${context.description}
Input Context: ${JSON.stringify(context.input)}
Error Message: ${errorMsg}

${context.logs ? `Recent Logs:\n${context.logs}\n` : ""}
${context.codeSnippet ? `Suspected Code Path:\n${context.codeSnippet}\n` : ""}

1. Identify where in the code the failure occurred.
2. Determine what condition caused it.
3. Propose a precise patch to resolve it.

Return ONLY a JSON response in this format:
{
  "rationale": "Brief explanation of the bug and the fix",
  "patch": {
    "filePath": "relative/path/to/file.ts",
    "diff": "unified diff content"
  }
}
`;

        const result = await this.router.generate({
            sessionId,
            tier: "capable",
            system: "You are a senior systems engineer and expert debugger. You specialize in identifying root causes and proposing minimal, robust patches.",
            prompt,
        });

        if (result.isErr()) return err(result.error);

        try {
            const jsonMatch = result.value.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON found in response");
            const proposal = JSON.parse(jsonMatch[0]) as PatchProposal;
            return ok(proposal);
        } catch (e) {
            return err(adamError("diagnostics:parse-failed", "Failed to parse failure diagnosis", e));
        }
    }

    /**
     * Scans history and diagnostics for proactive improvements.
     */
    async runReviewCycle(
        sessionId: string,
        history: string,
        diagnostics: any
    ): Promise<Result<PatchProposal[], AdamError>> {
        const prompt = `
Recent Conversation History:
${history}

System Diagnostics:
${JSON.stringify(diagnostics)}

Analyze the above data for:
- Performance bottlenecks
- Common patterns of user frustration
- Potential edge cases in current implementations
- Opportunities for code cleanup or optimization

Return a JSON array of patch proposals:
[
  {
    "rationale": "...",
    "patch": { "filePath": "...", "diff": "..." }
  }
]
`;

        const result = await this.router.generate({
            sessionId,
            tier: "capable",
            system: "You are a continuous improvement agent for the Adam system. You look for ways to make the system more robust, efficient, and helpful.",
            prompt,
        });

        if (result.isErr()) return err(result.error);

        try {
            const jsonMatch = result.value.match(/\[[\s\S]*\]/);
            if (!jsonMatch) throw new Error("No JSON array found in response");
            const proposals = JSON.parse(jsonMatch[0]) as PatchProposal[];
            return ok(proposals);
        } catch (e) {
            return err(adamError("diagnostics:review-parse-failed", "Failed to parse system review", e));
        }
    }
}
