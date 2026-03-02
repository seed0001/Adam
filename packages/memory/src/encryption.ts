import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { trySync, type Result, type AdamError } from "@adam/shared";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Derives a 32-byte AES key from a master key string.
 * The master key itself comes from the OS keychain — it never touches disk.
 */
export function deriveKey(masterKey: string): Buffer {
  return createHash("sha256").update(masterKey).digest();
}

export function encrypt(plaintext: string, key: Buffer): Result<Buffer, AdamError> {
  return trySync(() => {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]);
  }, "encryption:encrypt-failed");
}

export function decrypt(ciphertext: Buffer, key: Buffer): Result<string, AdamError> {
  return trySync(() => {
    const iv = ciphertext.subarray(0, IV_LENGTH);
    const tag = ciphertext.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = ciphertext.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final("utf8");
  }, "encryption:decrypt-failed");
}
