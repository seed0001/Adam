import { type Result, type AdamError, ok, err, adamError } from "@adam/shared";
import type { DiagnosticRouter, PatchProposal } from "./patch-service.js";

export interface ReinforcementProposal {
    type: "trait_reinforcement" | "behavior_replication" | "regression_warning";
    trait?: string;
    rationale: string;
    actionablePatch?: PatchProposal;
}

export class ReinforcementService {
    constructor(private router: DiagnosticRouter) { }

    /**
     * Analyzes recent history to detect emerging strengths or regressions.
     */
    async analyzeBehavior(
        sessionId: string,
        history: string,
        currentTraits: Array<{ name: string; score: number }>
    ): Promise<Result<ReinforcementProposal[], AdamError>> {
        const prompt = `
Recent Conversation History:
${history}

Current Trait reinforcement scores:
${JSON.stringify(currentTraits)}

Analyze the interaction for:
1. **Emerging Strengths**: Traits Adam is demonstrating effectively.
2. **Regressions**: Previously strong traits that are slipping.
3. **Replication Opportunities**: Good behaviors that should be adopted as defaults (propose a patch for system prompt or logic if applicable).

Return ONLY a JSON array of reinforcement proposals:
[
  {
    "type": "trait_reinforcement" | "behavior_replication" | "regression_warning",
    "trait": "Initiative",
    "rationale": "...",
    "actionablePatch": { "rationale": "...", "patch": { "filePath": "...", "diff": "..." } } (optional)
  }
]
`;

        const result = await this.router.generate({
            sessionId,
            tier: "capable",
            system: "You are a behavior analyst for an AI agent. You identify successful behavior patterns and suggest how to reinforce or replicate them.",
            prompt,
        });

        if (result.isErr()) return err(result.error);

        try {
            const jsonMatch = result.value.match(/\[[\s\S]*\]/);
            if (!jsonMatch) throw new Error("No JSON array found in response");
            const proposals = JSON.parse(jsonMatch[0]) as ReinforcementProposal[];
            return ok(proposals);
        } catch (e) {
            return err(adamError("diagnostics:reinforcement-parse-failed", "Failed to parse behavior analysis", e));
        }
    }

    /**
     * Evaluates if a session contains a "Golden Example" of AI interaction.
     */
    async detectGoldenExample(
        sessionId: string,
        transcript: string
    ): Promise<Result<{ isGolden: boolean; rationale: string; category: string }, AdamError>> {
        const prompt = `
Evaluate the following interaction for "Golden Example" status.
A Golden Example is an interaction where the agent shows exceptional:
- Technical reliability
- Proactive problem solving
- Concise and helpful communication
- Perfect tool usage

Transcript:
${transcript}

Return ONLY JSON:
{
  "isGolden": boolean,
  "rationale": "...",
  "category": "autonomy" | "reliability" | "communication" | "architecture"
}
`;

        const result = await this.router.generate({
            sessionId,
            tier: "fast",
            system: "You evaluate AI interactions for high quality benchmarks.",
            prompt,
        });

        if (result.isErr()) return err(result.error);

        try {
            const jsonMatch = result.value.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON found in response");
            return ok(JSON.parse(jsonMatch[0]));
        } catch (e) {
            return err(adamError("diagnostics:golden-parse-failed", "Failed to parse golden evaluation", e));
        }
    }
}
