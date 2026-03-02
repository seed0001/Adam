export { ok, err, Ok, Err, Result, ResultAsync, okAsync, errAsync } from "neverthrow";

import { err, ok, type Result } from "neverthrow";

export type AdamError = {
  code: string;
  message: string;
  cause?: unknown;
};

export function adamError(code: string, message: string, cause?: unknown): AdamError {
  return { code, message, cause };
}

export function trySync<T>(fn: () => T, errorCode: string): Result<T, AdamError> {
  try {
    return ok(fn());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(adamError(errorCode, message, e));
  }
}

export async function tryAsync<T>(
  fn: () => Promise<T>,
  errorCode: string,
): Promise<Result<T, AdamError>> {
  try {
    return ok(await fn());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(adamError(errorCode, message, e));
  }
}
