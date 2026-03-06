import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tryAsync, adamError, type AdamError, type Result, err, ok } from "@adam/shared";

const SERVICE_NAME = "adam-agent";

// ── Backend interface ─────────────────────────────────────────────────────────

interface VaultBackend {
  set(service: string, account: string, value: string): Promise<void>;
  get(service: string, account: string): Promise<string | null>;
  delete(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

// ── OS keychain backend (keytar) ──────────────────────────────────────────────

async function loadKeytarBackend(): Promise<VaultBackend | null> {
  try {
    // Dynamic import so a load failure doesn't crash the process
    const mod = await import("keytar");
    const kt = (mod.default ?? mod) as {
      setPassword(service: string, account: string, password: string): Promise<void>;
      getPassword(service: string, account: string): Promise<string | null>;
      deletePassword(service: string, account: string): Promise<boolean>;
      findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
    };
    // Verify the functions are actually there (native build might be missing)
    if (typeof kt.setPassword !== "function") return null;
    return {
      set: (svc, acc, val) => kt.setPassword(svc, acc, val),
      get: (svc, acc) => kt.getPassword(svc, acc),
      delete: (svc, acc) => kt.deletePassword(svc, acc),
      findCredentials: (svc) => kt.findCredentials(svc),
    };
  } catch {
    return null;
  }
}

// ── Encrypted file backend (fallback) ────────────────────────────────────────
//
// Credentials are stored as AES-256-GCM encrypted JSON in ~/.adam/vault.enc.
// The encryption key is derived from the absolute path of the home directory
// salted with a fixed string — machine-specific without an extra key file.

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function fileVaultKey(): Buffer {
  const material = homedir() + ":adam-vault-v1";
  return createHash("sha256").update(material).digest();
}

function encryptJson(data: unknown, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const plain = JSON.stringify(data);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decryptJson(b64: string, key: Buffer): unknown {
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as unknown;
}

type VaultStore = Record<string, Record<string, string>>;

class FileVaultBackend implements VaultBackend {
  private readonly path: string;
  private readonly key: Buffer;

  constructor() {
    const dir = join(homedir(), ".adam");
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, "vault.enc");
    this.key = fileVaultKey();
  }

  private read(): VaultStore {
    if (!existsSync(this.path)) return {};
    try {
      return decryptJson(readFileSync(this.path, "utf-8"), this.key) as VaultStore;
    } catch {
      return {};
    }
  }

  private write(store: VaultStore): void {
    writeFileSync(this.path, encryptJson(store, this.key), "utf-8");
  }

  set(svc: string, account: string, value: string): Promise<void> {
    const store = this.read();
    if (!store[svc]) store[svc] = {};
    const serviceStore = store[svc];
    if (serviceStore) serviceStore[account] = value;
    this.write(store);
    return Promise.resolve();
  }

  get(svc: string, account: string): Promise<string | null> {
    return Promise.resolve(this.read()[svc]?.[account] ?? null);
  }

  delete(svc: string, account: string): Promise<boolean> {
    const store = this.read();
    const serviceStore = store[svc];
    if (!serviceStore || !serviceStore[account]) return Promise.resolve(false);
    delete serviceStore[account];
    this.write(store);
    return Promise.resolve(true);
  }

  findCredentials(svc: string): Promise<Array<{ account: string; password: string }>> {
    const accounts = this.read()[svc] ?? {};
    return Promise.resolve(Object.entries(accounts).map(([account, password]) => ({ account, password })));
  }
}

// ── CredentialVault ───────────────────────────────────────────────────────────

/**
 * Credential vault with OS keychain as primary backend and an AES-256-GCM
 * encrypted file as automatic fallback. The interface is identical either way.
 *
 * Primary:  keytar → Windows Credential Manager / macOS Keychain / libsecret
 * Fallback: ~/.adam/vault.enc (encrypted with a machine-derived key)
 */
export class CredentialVault {
  private backend: VaultBackend | null = null;
  private usingKeytar = false;

  private async getBackend(): Promise<VaultBackend> {
    if (!this.backend) {
      const kt = await loadKeytarBackend();
      if (kt) {
        this.backend = kt;
        this.usingKeytar = true;
      } else {
        this.backend = new FileVaultBackend();
        this.usingKeytar = false;
      }
    }
    return this.backend;
  }

  /** True when the OS keychain is active, false when using the file fallback. */
  get isUsingKeychain(): boolean {
    return this.usingKeytar;
  }

  async set(key: string, value: string): Promise<Result<void, AdamError>> {
    return tryAsync(async () => {
      const b = await this.getBackend();
      await b.set(SERVICE_NAME, key, value);
    }, "vault:set-failed");
  }

  async get(key: string): Promise<Result<string | null, AdamError>> {
    return tryAsync(async () => {
      const b = await this.getBackend();
      return b.get(SERVICE_NAME, key);
    }, "vault:get-failed");
  }

  async getOrThrow(key: string): Promise<Result<string, AdamError>> {
    const result = await this.get(key);
    if (result.isErr()) return err(result.error);
    if (result.value === null) {
      return err(adamError("vault:not-found", `Credential '${key}' not found in vault`));
    }
    return ok(result.value);
  }

  async delete(key: string): Promise<Result<boolean, AdamError>> {
    return tryAsync(async () => {
      const b = await this.getBackend();
      return b.delete(SERVICE_NAME, key);
    }, "vault:delete-failed");
  }

  async list(): Promise<Result<Array<{ account: string }>, AdamError>> {
    return tryAsync(async () => {
      const b = await this.getBackend();
      return b.findCredentials(SERVICE_NAME);
    }, "vault:list-failed");
  }

  async has(key: string): Promise<boolean> {
    const result = await this.get(key);
    return result.isOk() && result.value !== null;
  }
}

export const vault = new CredentialVault();
