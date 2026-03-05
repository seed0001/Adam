import { createLogger, generateId } from "@adam/shared";
import { type SkillSpec, type SkillStore } from "@adam/skills";
import type { ModelRouter } from "@adam/models";
import { z } from "zod";

const logger = createLogger("core:workshop");

// ── SkillWorkshop ─────────────────────────────────────────────────────────────
//
// Adam is the architect. The workshop is the drafting table.
// It produces specs — never code, never execution logic.

const WORKSHOP_TRIGGERS = [
  "let's design a skill",
  "design a new skill",
  "skill workshop",
  "enter workshop mode",
  "start skill workshop",
];

export function isWorkshopTrigger(message: string): boolean {
  const lower = message.toLowerCase();
  return WORKSHOP_TRIGGERS.some((t) => lower.includes(t));
}

// The shape we ask the LLM to fill in — strict, no freeform code fields
const LLMSkillDraftSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  triggers: z.array(z.string()).min(1).max(6),
  inputs: z.array(z.object({
    name: z.string(),
    type: z.enum(["string", "number", "boolean", "path", "url", "json"]),
    description: z.string(),
    required: z.boolean(),
    example: z.string().optional(),
  })),
  outputs: z.array(z.object({
    name: z.string(),
    type: z.enum(["string", "file", "directory", "json", "void"]),
    description: z.string(),
  })),
  allowedTools: z.array(z.enum([
    "web_fetch", "read_file", "write_file", "list_directory", "shell",
    "send_discord_message", "list_discord_channels",
  ])),
  steps: z.array(z.string()).min(1).max(12),
  artifacts: z.array(z.string()),
  successCriteria: z.array(z.string()).min(1),
  constraints: z.array(z.string()).min(1),
  notes: z.string().optional(),
});

export class SkillWorkshop {
  constructor(
    private router: ModelRouter,
    private store: SkillStore,
  ) {}

  /**
   * Given a user's description of what they want, generate a full skill spec.
   * Returns the saved draft and a human-readable summary for the conversation.
   */
  async draft(
    userIntent: string,
    sessionId: string,
  ): Promise<{ skill: SkillSpec; summary: string }> {
    logger.info("Drafting skill spec", { intent: userIntent.slice(0, 80) });

    const result = await this.router.generateObject({
      sessionId,
      tier: "capable",
      schemaName: "SkillDraft",
      schema: LLMSkillDraftSchema,
      system: `You are operating in Skill Workshop mode. Your job is to produce a structured skill specification — not code, not executable logic. You are the architect.

A skill spec is a contract that describes:
- What the skill does (precisely)
- What inputs it needs from the user
- What it produces (outputs/artifacts)
- Which existing tools it's allowed to use (only from the provided list)
- The logical steps (human-readable, not code)
- What success looks like
- What it must never do (hard constraints)

Available tools: web_fetch, read_file, write_file, list_directory, shell, send_discord_message, list_discord_channels

Rules:
- Steps must be human-readable descriptions, not code
- Constraints must be explicit and specific (e.g. "must never delete files outside the target directory")
- Only list tools that are genuinely needed
- Name must be lowercase-hyphenated (e.g. "init-node-project")
- Be precise and realistic — no magic, no invented capabilities
- If the intent is vague, make conservative, safe assumptions and note them`,
      prompt: `Design a skill spec for this intent:\n\n"${userIntent}"`,
    });

    if (result.isErr()) {
      throw new Error(`Workshop draft failed: ${result.error.message}`);
    }

    const draft = result.value;
    const now = new Date().toISOString();
    const id = `skill-${draft.name}-${Date.now().toString(36)}`;

    const skill: SkillSpec = {
      id,
      name: draft.name,
      displayName: draft.displayName,
      version: "0.1.0",
      description: draft.description,
      status: "draft",
      triggers: draft.triggers,
      inputs: draft.inputs,
      outputs: draft.outputs,
      allowedTools: draft.allowedTools,
      steps: draft.steps,
      artifacts: draft.artifacts,
      successCriteria: draft.successCriteria,
      constraints: draft.constraints,
      template: inferDefaultTemplate(draft),
      notes: draft.notes,
      createdAt: now,
      updatedAt: now,
    };

    this.store.save(skill);
    logger.info("Skill spec saved", { id, name: skill.name });

    const summary = formatSkillSummary(skill);
    return { skill, summary };
  }

  /**
   * Refine an existing draft based on follow-up feedback.
   * Returns updated skill and a summary of what changed.
   */
  async refine(
    skillId: string,
    feedback: string,
    sessionId: string,
  ): Promise<{ skill: SkillSpec; summary: string } | null> {
    const existing = this.store.get(skillId);
    if (!existing || existing.status !== "draft") return null;

    logger.info("Refining skill spec", { id: skillId, feedback: feedback.slice(0, 80) });

    const result = await this.router.generateObject({
      sessionId,
      tier: "capable",
      schemaName: "SkillDraft",
      schema: LLMSkillDraftSchema,
      system: `You are refining an existing skill spec based on user feedback. Return the full updated spec — only change what the feedback addresses. Keep everything else the same.`,
      prompt: `Current skill spec:\n${JSON.stringify(existing, null, 2)}\n\nUser feedback:\n"${feedback}"\n\nReturn the updated spec.`,
    });

    if (result.isErr()) return null;

    const updated: SkillSpec = {
      ...existing,
      ...result.value,
      id: existing.id,
      status: "draft",
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.store.save(updated);
    return { skill: updated, summary: formatSkillSummary(updated) };
  }
}

function inferDefaultTemplate(draft: z.infer<typeof LLMSkillDraftSchema>): SkillSpec["template"] {
  const lowerDesc = draft.description.toLowerCase();
  const stepText = draft.steps.join(" ").toLowerCase();
  const tools = new Set(draft.allowedTools);

  if (tools.has("shell")) return "shell-pipeline";
  if (tools.has("web_fetch")) return "web-fetch-chain";
  if (tools.has("write_file") || tools.has("read_file") || draft.artifacts.length > 0) return "file-scaffold";

  // Conversational skills can execute via constrained LLM template.
  if (!tools.size && (
    lowerDesc.includes("clarify") ||
    lowerDesc.includes("intent") ||
    lowerDesc.includes("respond") ||
    stepText.includes("formulate a response") ||
    stepText.includes("acknowledge") ||
    stepText.includes("prompt")
  )) {
    return "llm-response";
  }

  return "none";
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function formatSkillSummary(skill: SkillSpec): string {
  const statusEmoji: Record<string, string> = {
    draft: "📋",
    approved: "✅",
    latent: "💤",
    active: "⚡",
    deprecated: "🗃️",
  };

  const lines: string[] = [
    `${statusEmoji[skill.status] ?? "?"} **${skill.displayName}** \`${skill.id}\``,
    `*${skill.description}*`,
    ``,
    `**Triggers:** ${skill.triggers.slice(0, 3).map((t: string) => `"${t}"`).join(", ")}`,
    `**Tools allowed:** ${skill.allowedTools.length > 0 ? skill.allowedTools.join(", ") : "none"}`,
    ``,
    `**Inputs:**`,
    ...skill.inputs.map((inp) => `  - \`${inp.name}\` (${inp.type}${inp.required ? "" : ", optional"}) — ${inp.description}`),
    ``,
    `**Steps:**`,
    ...skill.steps.map((s: string, i: number) => `  ${i + 1}. ${s}`),
    ``,
    `**Artifacts:** ${skill.artifacts.length > 0 ? skill.artifacts.join(", ") : "none"}`,
    ``,
    `**Success when:** ${skill.successCriteria[0]}`,
    `**Must never:** ${skill.constraints[0]}`,
    ``,
    `Status: **${skill.status}** · ID: \`${skill.id}\``,
  ];

  if (skill.status === "draft") {
    lines.push(``, `To approve this spec, run \`/workshop approve ${skill.id}\``);
  }

  return lines.join("\n");
}
