import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { PermissionRegistry } from "../permissions.js";
import type { SkillCapability } from "@adam/shared";

function makeRegistry(): PermissionRegistry {
  return new PermissionRegistry(new Database(":memory:"));
}

describe("PermissionRegistry", () => {
  let reg: PermissionRegistry;

  beforeEach(() => {
    reg = makeRegistry();
  });

  it("isApproved returns false for a capability that has never been approved", () => {
    expect(reg.isApproved("my-skill", "fs:read")).toBe(false);
  });

  it("approve makes isApproved return true", () => {
    reg.approve("my-skill", "fs:read");
    expect(reg.isApproved("my-skill", "fs:read")).toBe(true);
  });

  it("approve is idempotent — calling it twice does not error", () => {
    reg.approve("my-skill", "fs:read");
    const result = reg.approve("my-skill", "fs:read");
    expect(result.isOk()).toBe(true);
    expect(reg.isApproved("my-skill", "fs:read")).toBe(true);
  });

  it("revoke removes an approved capability", () => {
    reg.approve("my-skill", "fs:write");
    reg.revoke("my-skill", "fs:write");
    expect(reg.isApproved("my-skill", "fs:write")).toBe(false);
  });

  it("revoke on a never-approved capability does not error", () => {
    const result = reg.revoke("my-skill", "shell:exec");
    expect(result.isOk()).toBe(true);
  });

  it("getApprovedCapabilities returns only capabilities for the specified skill", () => {
    reg.approve("skill-a", "fs:read");
    reg.approve("skill-a", "net:fetch");
    reg.approve("skill-b", "shell:exec");

    const caps = reg.getApprovedCapabilities("skill-a");
    expect(caps).toHaveLength(2);
    expect(caps).toContain("fs:read");
    expect(caps).toContain("net:fetch");
    expect(caps).not.toContain("shell:exec");
  });

  it("getApprovedCapabilities returns empty array when no caps approved", () => {
    expect(reg.getApprovedCapabilities("ghost-skill")).toEqual([]);
  });

  it("checkAll returns Ok when all capabilities are approved", () => {
    const caps: SkillCapability[] = ["fs:read", "net:fetch"];
    caps.forEach((c) => reg.approve("my-skill", c));
    const result = reg.checkAll("my-skill", caps);
    expect(result.isOk()).toBe(true);
  });

  it("checkAll returns Ok for an empty capabilities array", () => {
    const result = reg.checkAll("any-skill", []);
    expect(result.isOk()).toBe(true);
  });

  it("checkAll returns Err listing missing capabilities", () => {
    reg.approve("my-skill", "fs:read");
    const result = reg.checkAll("my-skill", ["fs:read", "shell:exec", "browser"]);
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe("permissions:not-approved");
    expect(error.message).toContain("shell:exec");
    expect(error.message).toContain("browser");
    expect(error.message).not.toContain("fs:read");
  });

  it("checkAll only lists capabilities that are missing, not approved ones", () => {
    reg.approve("my-skill", "memory:read");
    reg.approve("my-skill", "memory:write");
    const result = reg.checkAll("my-skill", ["memory:read", "memory:write", "voice"]);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("voice");
  });

  it("listAll returns all approvals across all skills", () => {
    reg.approve("skill-a", "fs:read");
    reg.approve("skill-b", "net:fetch");
    const all = reg.listAll();
    expect(all).toHaveLength(2);
    expect(all.every((a) => a.approvedByUser)).toBe(true);
  });

  it("capabilities for skill A are independent of skill B", () => {
    reg.approve("skill-a", "voice");
    expect(reg.isApproved("skill-b", "voice")).toBe(false);
  });
});
