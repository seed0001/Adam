import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ADAM_HOME_DIR } from "@adam/shared";
import { type SkillSpec, type SkillStatus, SkillSpecSchema } from "./schema.js";

// ── SkillStore ────────────────────────────────────────────────────────────────

/**
 * File-based skill registry.
 * Skills live at ~/.adam/skills/<id>.json
 *
 * Each file is the full SkillSpec JSON — human-readable, diffable, versionable.
 * The store never executes anything. It is purely a contract vault.
 */
export class SkillStore {
  readonly dir: string;

  constructor() {
    this.dir = join(homedir(), ADAM_HOME_DIR, "skills");
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  list(): SkillSpec[] {
    const files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    const skills: SkillSpec[] = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(this.dir, file), "utf-8"));
        const parsed = SkillSpecSchema.safeParse(raw);
        if (parsed.success) skills.push(parsed.data);
      } catch {
        // corrupt file — skip
      }
    }
    return skills.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): SkillSpec | null {
    const path = this.skillPath(id);
    if (!existsSync(path)) return null;
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      const parsed = SkillSpecSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  save(skill: SkillSpec): void {
    skill.updatedAt = new Date().toISOString();
    writeFileSync(this.skillPath(skill.id), JSON.stringify(skill, null, 2), "utf-8");
  }

  delete(id: string): boolean {
    const path = this.skillPath(id);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  }

  // ── Lifecycle transitions ─────────────────────────────────────────────────
  //
  // These are the only gates. Status moves forward, never back (except deprecate).
  // The system enforces the lifecycle — Adam cannot call these directly.

  /** draft → approved: user has reviewed the spec and signed off. */
  approve(id: string): SkillSpec | null {
    const skill = this.get(id);
    if (!skill || skill.status !== "draft") return null;
    skill.status = "approved";
    skill.approvedAt = new Date().toISOString();
    this.save(skill);
    return skill;
  }

  /** approved → latent: spec is stored; Adam can simulate but not execute. */
  makeLatent(id: string): SkillSpec | null {
    const skill = this.get(id);
    if (!skill || !["draft", "approved"].includes(skill.status)) return null;
    skill.status = "latent";
    if (!skill.approvedAt) skill.approvedAt = new Date().toISOString();
    this.save(skill);
    return skill;
  }

  /**
   * latent/approved → active: wires the skill to a trusted execution template.
   * Only possible if the skill has a template other than "none".
   */
  activate(id: string, template: SkillSpec["template"]): SkillSpec | null {
    const skill = this.get(id);
    if (!skill || !["approved", "latent"].includes(skill.status)) return null;
    if (template === "none") return null; // can't activate a templateless skill
    skill.status = "active";
    skill.template = template;
    skill.activatedAt = new Date().toISOString();
    this.save(skill);
    return skill;
  }

  /** Any status → deprecated. */
  deprecate(id: string): SkillSpec | null {
    const skill = this.get(id);
    if (!skill) return null;
    skill.status = "deprecated";
    this.save(skill);
    return skill;
  }

  /** Update notes on an existing skill. */
  addNote(id: string, note: string): SkillSpec | null {
    const skill = this.get(id);
    if (!skill) return null;
    const existing = skill.notes ? skill.notes.trimEnd() + "\n\n" : "";
    skill.notes = existing + note;
    this.save(skill);
    return skill;
  }

  byStatus(status: SkillStatus): SkillSpec[] {
    return this.list().filter((s) => s.status === status);
  }

  private skillPath(id: string): string {
    return join(this.dir, `${id}.json`);
  }
}
