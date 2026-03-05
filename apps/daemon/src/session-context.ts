/**
 * AsyncLocalStorage for propagating session context into tool execution.
 * Tools like generate_chat_background need the current sessionId.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type SessionContext = { sessionId: string };

export const sessionContext = new AsyncLocalStorage<SessionContext>();

export function runWithSession<T>(sessionId: string, fn: () => T): T {
  return sessionContext.run({ sessionId }, fn);
}

export function getSessionId(): string | undefined {
  return sessionContext.getStore()?.sessionId;
}
