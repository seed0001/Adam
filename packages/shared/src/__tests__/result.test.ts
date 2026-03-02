import { describe, it, expect } from "vitest";
import { adamError, trySync, tryAsync } from "../result.js";

describe("adamError", () => {
  it("creates an error object with code and message", () => {
    const e = adamError("test:code", "test message");
    expect(e.code).toBe("test:code");
    expect(e.message).toBe("test message");
    expect(e.cause).toBeUndefined();
  });

  it("attaches cause when provided", () => {
    const cause = new Error("root cause");
    const e = adamError("test:code", "msg", cause);
    expect(e.cause).toBe(cause);
  });
});

describe("trySync", () => {
  it("returns Ok with the function's return value", () => {
    const result = trySync(() => 42, "code");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(42);
  });

  it("returns Err when the function throws an Error", () => {
    const result = trySync(() => {
      throw new Error("boom");
    }, "my:code");
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe("my:code");
    expect(error.message).toBe("boom");
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("returns Err with String(e) when a non-Error is thrown", () => {
    const result = trySync(() => {
      throw "just a string";
    }, "my:code");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe("just a string");
  });

  it("stores the caught value as cause", () => {
    const thrown = { weird: true };
    const result = trySync(() => {
      throw thrown;
    }, "code");
    expect(result._unsafeUnwrapErr().cause).toBe(thrown);
  });
});

describe("tryAsync", () => {
  it("returns Ok with the resolved value", async () => {
    const result = await tryAsync(async () => "hello", "code");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("hello");
  });

  it("returns Err when the async function throws", async () => {
    const result = await tryAsync(async () => {
      throw new Error("async boom");
    }, "async:code");
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe("async:code");
    expect(error.message).toBe("async boom");
  });

  it("returns Err with String(e) for non-Error rejections", async () => {
    const result = await tryAsync(async () => {
      throw 404;
    }, "code");
    expect(result._unsafeUnwrapErr().message).toBe("404");
  });
});
