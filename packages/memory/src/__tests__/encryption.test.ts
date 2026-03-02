import { describe, it, expect } from "vitest";
import { deriveKey, encrypt, decrypt } from "../encryption.js";

const KEY = deriveKey("test-master-key");

describe("deriveKey", () => {
  it("returns a 32-byte Buffer", () => {
    const key = deriveKey("any key");
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it("is deterministic — same input always produces same output", () => {
    const a = deriveKey("same");
    const b = deriveKey("same");
    expect(a.equals(b)).toBe(true);
  });

  it("produces different keys for different inputs", () => {
    const a = deriveKey("one");
    const b = deriveKey("two");
    expect(a.equals(b)).toBe(false);
  });
});

describe("encrypt / decrypt", () => {
  it("round-trips a plaintext string", () => {
    const encResult = encrypt("hello world", KEY);
    expect(encResult.isOk()).toBe(true);

    const decResult = decrypt(encResult._unsafeUnwrap(), KEY);
    expect(decResult.isOk()).toBe(true);
    expect(decResult._unsafeUnwrap()).toBe("hello world");
  });

  it("round-trips the empty string", () => {
    const enc = encrypt("", KEY)._unsafeUnwrap();
    expect(decrypt(enc, KEY)._unsafeUnwrap()).toBe("");
  });

  it("round-trips unicode content", () => {
    const text = "こんにちは 🌍 café";
    const enc = encrypt(text, KEY)._unsafeUnwrap();
    expect(decrypt(enc, KEY)._unsafeUnwrap()).toBe(text);
  });

  it("produces a different ciphertext on each call (random IV)", () => {
    const a = encrypt("same plaintext", KEY)._unsafeUnwrap();
    const b = encrypt("same plaintext", KEY)._unsafeUnwrap();
    expect(a.equals(b)).toBe(false);
  });

  it("returns Err when decrypting with the wrong key", () => {
    const enc = encrypt("secret", KEY)._unsafeUnwrap();
    const wrongKey = deriveKey("wrong-key");
    const result = decrypt(enc, wrongKey);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("encryption:decrypt-failed");
  });

  it("returns Err when the ciphertext is tampered", () => {
    const enc = encrypt("secret", KEY)._unsafeUnwrap();
    enc[enc.length - 1] ^= 0xff; // flip last byte
    const result = decrypt(enc, KEY);
    expect(result.isErr()).toBe(true);
  });

  it("returns Err when the buffer is too short to contain IV + tag", () => {
    const tooShort = Buffer.alloc(10);
    const result = decrypt(tooShort, KEY);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("encryption:decrypt-failed");
  });
});
