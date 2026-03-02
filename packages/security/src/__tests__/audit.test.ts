import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { AuditLog, type AuditEntryInput } from "../audit.js";

function makeDb(): Database.Database {
  return new Database(":memory:");
}

function baseEntry(overrides: Partial<AuditEntryInput> = {}): AuditEntryInput {
  return {
    action: "tool:call",
    target: "some-tool",
    outcome: "success",
    sessionId: null,
    taskId: null,
    skillId: null,
    errorMessage: null,
    undoData: null,
    ...overrides,
  };
}

describe("AuditLog", () => {
  let log: AuditLog;

  beforeEach(() => {
    log = new AuditLog(makeDb());
  });

  it("record returns Ok with a non-empty id", () => {
    const result = log.record(baseEntry());
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeTruthy();
  });

  it("each recorded entry gets a unique id", () => {
    const id1 = log.record(baseEntry())._unsafeUnwrap();
    const id2 = log.record(baseEntry())._unsafeUnwrap();
    expect(id1).not.toBe(id2);
  });

  it("query with no filters returns all rows", () => {
    log.record(baseEntry({ action: "fs:read", target: "a.txt" }));
    log.record(baseEntry({ action: "fs:write", target: "b.txt" }));
    expect(log.query({})).toHaveLength(2);
  });

  it("query by sessionId returns only matching rows", () => {
    log.record(baseEntry({ sessionId: "sess-1" }));
    log.record(baseEntry({ sessionId: "sess-2" }));
    const results = log.query({ sessionId: "sess-1" });
    expect(results).toHaveLength(1);
    expect(results[0]!.sessionId).toBe("sess-1");
  });

  it("query by action filters correctly", () => {
    log.record(baseEntry({ action: "shell:exec" }));
    log.record(baseEntry({ action: "net:fetch" }));
    const results = log.query({ action: "shell:exec" });
    expect(results).toHaveLength(1);
    expect(results[0]!.action).toBe("shell:exec");
  });

  it("query by outcome filters correctly", () => {
    log.record(baseEntry({ outcome: "failure" }));
    log.record(baseEntry({ outcome: "success" }));
    expect(log.query({ outcome: "failure" })).toHaveLength(1);
  });

  it("query with limit caps results", () => {
    for (let i = 0; i < 5; i++) log.record(baseEntry());
    expect(log.query({ limit: 2 })).toHaveLength(2);
  });

  it("params and undoData round-trip as JSON", () => {
    const params = { url: "https://example.com", method: "GET" };
    const undoData = { original: "value" };
    log.record(baseEntry({ action: "net:fetch", target: "api", params, undoData }));
    const [entry] = log.query({});
    expect(entry!.params).toEqual(params);
    expect(entry!.undoData).toEqual(undoData);
  });

  it("null optional fields are preserved as null", () => {
    log.record(baseEntry());
    const [entry] = log.query({});
    expect(entry!.sessionId).toBeNull();
    expect(entry!.taskId).toBeNull();
    expect(entry!.skillId).toBeNull();
    expect(entry!.errorMessage).toBeNull();
    expect(entry!.undoData).toBeNull();
  });

  it("query by since filters out earlier entries", async () => {
    log.record(baseEntry({ action: "fs:read", target: "old" }));
    const cutoff = new Date();
    // Small delay so the next timestamp is strictly after cutoff
    await new Promise((r) => setTimeout(r, 5));
    log.record(baseEntry({ action: "fs:write", target: "new" }));

    const results = log.query({ since: cutoff });
    expect(results.every((e) => e.timestamp >= cutoff)).toBe(true);
  });

  it("migrate is idempotent — constructing a second log on the same DB is safe", () => {
    const db = makeDb();
    const log1 = new AuditLog(db);
    log1.record(baseEntry());
    const log2 = new AuditLog(db); // runs migrate again on the same DB
    expect(log2.query({})).toHaveLength(1);
  });
});
