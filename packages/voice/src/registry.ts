import Database from "better-sqlite3";
import {
  type VoiceProfile,
  type VoiceSamplingParams,
  type AdamError,
  type Result,
  ok,
  err,
  adamError,
  trySync,
  generateId,
} from "@adam/shared";

/**
 * VoiceRegistry — stores and manages voice profiles (characters).
 * Each profile is a zero-shot voice clone identity: reference audio + persona + sampling params.
 */
export class VoiceRegistry {
  constructor(private db: Database.Database) {
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS voice_profiles (
        id                   TEXT PRIMARY KEY,
        name                 TEXT NOT NULL,
        description          TEXT NOT NULL DEFAULT '',
        reference_audio_path TEXT NOT NULL,
        persona              TEXT NOT NULL DEFAULT '',
        params               TEXT NOT NULL DEFAULT '{}',
        is_default           INTEGER NOT NULL DEFAULT 0,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL
      );
    `);
  }

  create(
    input: Omit<VoiceProfile, "id" | "createdAt" | "updatedAt">,
  ): Result<VoiceProfile, AdamError> {
    return trySync(() => {
      const id = generateId();
      const now = new Date().toISOString();

      if (input.isDefault) {
        this.db.prepare(`UPDATE voice_profiles SET is_default = 0`).run();
      }

      this.db
        .prepare(
          `INSERT INTO voice_profiles
           (id, name, description, reference_audio_path, persona, params, is_default, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          input.description,
          input.referenceAudioPath,
          input.persona,
          JSON.stringify(input.params),
          input.isDefault ? 1 : 0,
          now,
          now,
        );

      const fetched = this.getOrThrow(id);
      if (fetched.isErr()) throw new Error(fetched.error.message);
      return fetched.value;
    }, "voice-registry:create-failed");
  }

  update(
    id: string,
    patch: Partial<Omit<VoiceProfile, "id" | "createdAt" | "updatedAt">>,
  ): Result<VoiceProfile, AdamError> {
    return trySync(() => {
      const existing = this.getOrThrow(id);
      if (existing.isErr()) throw new Error(existing.error.message);

      const now = new Date().toISOString();

      if (patch.isDefault) {
        this.db.prepare(`UPDATE voice_profiles SET is_default = 0`).run();
      }

      const fields: string[] = [];
      const values: unknown[] = [];

      if (patch.name !== undefined) { fields.push("name = ?"); values.push(patch.name); }
      if (patch.description !== undefined) { fields.push("description = ?"); values.push(patch.description); }
      if (patch.referenceAudioPath !== undefined) { fields.push("reference_audio_path = ?"); values.push(patch.referenceAudioPath); }
      if (patch.persona !== undefined) { fields.push("persona = ?"); values.push(patch.persona); }
      if (patch.params !== undefined) { fields.push("params = ?"); values.push(JSON.stringify(patch.params)); }
      if (patch.isDefault !== undefined) { fields.push("is_default = ?"); values.push(patch.isDefault ? 1 : 0); }

      fields.push("updated_at = ?");
      values.push(now);
      values.push(id);

      this.db
        .prepare(`UPDATE voice_profiles SET ${fields.join(", ")} WHERE id = ?`)
        .run(...values);

      const fetched = this.getOrThrow(id);
      if (fetched.isErr()) throw new Error(fetched.error.message);
      return fetched.value;
    }, "voice-registry:update-failed");
  }

  delete(id: string): Result<void, AdamError> {
    return trySync(() => {
      this.db.prepare(`DELETE FROM voice_profiles WHERE id = ?`).run(id);
    }, "voice-registry:delete-failed");
  }

  get(id: string): VoiceProfile | null {
    const row = this.db
      .prepare(`SELECT * FROM voice_profiles WHERE id = ?`)
      .get(id) as VoiceProfileRow | undefined;
    return row ? rowToProfile(row) : null;
  }

  getOrThrow(id: string): Result<VoiceProfile, AdamError> {
    const profile = this.get(id);
    if (!profile) return err(adamError("voice-registry:not-found", `Voice profile '${id}' not found`));
    return ok(profile);
  }

  getDefault(): VoiceProfile | null {
    const row = this.db
      .prepare(`SELECT * FROM voice_profiles WHERE is_default = 1 LIMIT 1`)
      .get() as VoiceProfileRow | undefined;
    return row ? rowToProfile(row) : null;
  }

  list(): VoiceProfile[] {
    const rows = this.db
      .prepare(`SELECT * FROM voice_profiles ORDER BY created_at DESC`)
      .all() as VoiceProfileRow[];
    return rows.map(rowToProfile);
  }
}

type VoiceProfileRow = {
  id: string;
  name: string;
  description: string;
  reference_audio_path: string;
  persona: string;
  params: string;
  is_default: number;
  created_at: string;
  updated_at: string;
};

function rowToProfile(row: VoiceProfileRow): VoiceProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    referenceAudioPath: row.reference_audio_path,
    persona: row.persona,
    params: JSON.parse(row.params) as VoiceSamplingParams,
    isDefault: row.is_default === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
