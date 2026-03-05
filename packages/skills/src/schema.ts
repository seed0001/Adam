import { z } from "zod";

// ── Skill status lifecycle ─────────────────────────────────────────────────────
//
//   draft   → Adam generated the spec, not yet reviewed
//   approved → user reviewed and signed off on the contract
//   latent  → approved; Adam can simulate/describe it but not execute
//   active  → wired to a trusted execution template, actually runs
//   deprecated → retired, kept for history

export const SkillStatus = z.enum(["draft", "approved", "latent", "active", "deprecated"]);
export type SkillStatus = z.infer<typeof SkillStatus>;

// ── Skill input/output descriptors ────────────────────────────────────────────

export const SkillInputSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "path", "url", "json"]),
  description: z.string(),
  required: z.boolean().default(true),
  example: z.string().optional(),
});
export type SkillInput = z.infer<typeof SkillInputSchema>;

export const SkillOutputSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "file", "directory", "json", "void"]),
  description: z.string(),
});
export type SkillOutput = z.infer<typeof SkillOutputSchema>;

// ── The Skill Spec — the contract, not the code ───────────────────────────────

export const SkillSpecSchema = z.object({
  id: z.string(),
  name: z.string().describe("Short, lowercase-hyphenated skill name"),
  displayName: z.string().describe("Human-readable name"),
  version: z.string().default("0.1.0"),
  description: z.string().describe("What this skill does, in one paragraph"),
  status: SkillStatus.default("draft"),

  /** Phrases or patterns that would trigger this skill naturally in conversation. */
  triggers: z.array(z.string()).min(1),

  /** What the user (or agent) must provide. */
  inputs: z.array(SkillInputSchema),

  /** What the skill produces. */
  outputs: z.array(SkillOutputSchema),

  /**
   * Subset of tools this skill is allowed to use.
   * Must be a subset of the registered tool registry — no freeform additions.
   */
  allowedTools: z.array(z.enum([
    "web_fetch",
    "read_file",
    "write_file",
    "list_directory",
    "shell",
    "send_discord_message",
    "list_discord_channels",
  ])),

  /**
   * Ordered, human-readable steps. This is the logic contract.
   * Adam proposes these. The user approves them. The template executes them.
   */
  steps: z.array(z.string()).min(1),

  /** Files or directories this skill will create or modify. */
  artifacts: z.array(z.string()),

  /** Conditions that define a successful run. */
  successCriteria: z.array(z.string()).min(1),

  /**
   * Hard constraints — what this skill must NEVER do.
   * Explicit safety surface, not optional.
   */
  constraints: z.array(z.string()).min(1),

  /**
   * If active, which execution template handles this skill.
   * Templates are pre-audited code — never generated on the fly.
   */
  template: z.enum([
    "file-scaffold",     // creates a directory/file structure
    "shell-pipeline",    // runs a sequence of shell commands
    "web-fetch-chain",   // fetches URLs, processes results
    "llm-response",      // executes as a constrained prompt-chain response
    "none",              // latent only — simulate but don't execute
  ]).default("none"),

  /** Notes from the workshop conversation — design rationale, open questions. */
  notes: z.string().optional(),

  createdAt: z.string(),
  updatedAt: z.string(),
  approvedAt: z.string().optional(),
  activatedAt: z.string().optional(),
});

export type SkillSpec = z.infer<typeof SkillSpecSchema>;

/** What Adam generates before the spec is formalized — minimal required fields. */
export const SkillDraftSchema = SkillSpecSchema.omit({
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  template: true,
}).partial({
  version: true,
  notes: true,
  approvedAt: true,
  activatedAt: true,
});

export type SkillDraft = z.infer<typeof SkillDraftSchema>;
