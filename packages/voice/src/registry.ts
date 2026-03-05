import Database from "better-sqlite3";
import {
  type VoiceProfile,
  type VoiceProvider,
  type EdgeVoiceConfig,
  type LuxVoiceConfig,
  type XTTSVoiceConfig,
  type VoiceSamplingParams,
  type AdamError,
  type Result,
  ok,
  err,
  adamError,
  trySync,
  generateId,
} from "@adam/shared";

const LUX_PARAMS_DEFAULTS: VoiceSamplingParams = {
  rms: 0.01,
  tShift: 0.9,
  numSteps: 4,
  speed: 1.0,
  returnSmooth: false,
  refDuration: 5,
};

/**
 * VoiceRegistry — stores and manages voice profiles across Edge, Lux, and XTTS.
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
        reference_audio_path TEXT,
        persona              TEXT NOT NULL DEFAULT '',
        params               TEXT NOT NULL DEFAULT '{}',
        is_default           INTEGER NOT NULL DEFAULT 0,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL,
        provider             TEXT NOT NULL DEFAULT 'lux',
        provider_config      TEXT NOT NULL DEFAULT '{}'
      );
    `);

    // Migration: add provider/provider_config if table existed from before
    const cols = this.db.prepare("PRAGMA table_info(voice_profiles)").all() as { name: string }[];
    const hasProviderConfig = cols.some((c) => c.name === "provider_config");

    if (!hasProviderConfig) {
      this.db.exec(`ALTER TABLE voice_profiles ADD COLUMN provider TEXT NOT NULL DEFAULT 'lux'`);
      this.db.exec(`ALTER TABLE voice_profiles ADD COLUMN provider_config TEXT NOT NULL DEFAULT '{}'`);
      const rows = this.db.prepare("SELECT id, reference_audio_path, params FROM voice_profiles").all() as { id: string; reference_audio_path: string; params: string }[];
      const upd = this.db.prepare("UPDATE voice_profiles SET provider = 'lux', provider_config = ? WHERE id = ?");
      for (const r of rows) {
        const config: LuxVoiceConfig = {
          referenceAudioPath: r.reference_audio_path ?? "",
          params: (JSON.parse(r.params || "{}") || {}) as VoiceSamplingParams,
        };
        upd.run(JSON.stringify(config), r.id);
      }
    }
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

      const refPath = getRefPath(input);
      const paramsJson = getParamsJson(input);

      this.db
        .prepare(
          `INSERT INTO voice_profiles
           (id, name, description, reference_audio_path, persona, params, is_default, created_at, updated_at, provider, provider_config)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          input.description,
          refPath,
          input.persona,
          paramsJson,
          input.isDefault ? 1 : 0,
          now,
          now,
          input.provider,
          JSON.stringify(input.providerConfig),
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
      if (patch.persona !== undefined) { fields.push("persona = ?"); values.push(patch.persona); }
      if (patch.isDefault !== undefined) { fields.push("is_default = ?"); values.push(patch.isDefault ? 1 : 0); }
      if (patch.provider !== undefined) { fields.push("provider = ?"); values.push(patch.provider); }
      if (patch.providerConfig !== undefined) {
        fields.push("provider_config = ?");
        values.push(JSON.stringify(patch.providerConfig));
        const merged = { ...existing.value, providerConfig: patch.providerConfig };
        fields.push("reference_audio_path = ?");
        values.push(getRefPath(merged));
        fields.push("params = ?");
        values.push(getParamsJson(merged));
      }

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
  reference_audio_path: string | null;
  persona: string;
  params: string;
  is_default: number;
  created_at: string;
  updated_at: string;
  provider: string;
  provider_config: string;
};

function rowToProfile(row: VoiceProfileRow): VoiceProfile {
  const provider = (row.provider || "lux") as VoiceProvider;
  let providerConfig: EdgeVoiceConfig | LuxVoiceConfig | XTTSVoiceConfig;

  try {
    const parsed = JSON.parse(row.provider_config || "{}");
    if (provider === "edge") {
      providerConfig = parsed as EdgeVoiceConfig;
    } else if (provider === "xtts") {
      providerConfig = parsed as XTTSVoiceConfig;
    } else {
      const rawParams = parsed.params ?? JSON.parse(row.params || "{}") ?? {};
      providerConfig = {
        referenceAudioPath: parsed.referenceAudioPath ?? row.reference_audio_path ?? "",
        params: { ...LUX_PARAMS_DEFAULTS, ...rawParams } as VoiceSamplingParams,
      } as LuxVoiceConfig;
    }
  } catch {
    const rawParams = JSON.parse(row.params || "{}") ?? {};
    providerConfig = {
      referenceAudioPath: row.reference_audio_path ?? "",
      params: { ...LUX_PARAMS_DEFAULTS, ...rawParams } as VoiceSamplingParams,
    } as LuxVoiceConfig;
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    provider,
    providerConfig,
    persona: row.persona,
    isDefault: row.is_default === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function getRefPath(input: { provider: VoiceProvider; providerConfig: EdgeVoiceConfig | LuxVoiceConfig | XTTSVoiceConfig }): string | null {
  const c = input.providerConfig as LuxVoiceConfig | XTTSVoiceConfig;
  return c && "referenceAudioPath" in c ? c.referenceAudioPath : null;
}

function getParamsJson(input: { provider: VoiceProvider; providerConfig: EdgeVoiceConfig | LuxVoiceConfig | XTTSVoiceConfig }): string {
  const c = input.providerConfig as LuxVoiceConfig;
  return c && "params" in c ? JSON.stringify(c.params ?? {}) : "{}";
}
