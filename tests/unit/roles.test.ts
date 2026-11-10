import { describe, expect, it } from "vitest";

import { USER_ROLES, UserRole } from "@/lib/enums";
import { canManageData, canManageUsers, canUploadData, hasRole, isAdmin, isEngineering } from "@/lib/roles";

const subject = (role: string | null) => ({ role });

describe("hasRole", () => {
  it.each([
    ["string value", "admin"],
    ["list containing the role", ["engineering", UserRole.Admin]],
  ])("matches the assigned role given as %s", (_label, roles) => {
    expect(hasRole(subject("admin"), roles)).toBe(true);
  });

  it.each([
    ["other role", "admin"],
    ["unknown role name", "superadmin"],
    ["case mismatch", "Engineering"],
    ["empty list", []],
  ])("rejects %s", (_label, roles) => {
    expect(hasRole(subject("engineering"), roles)).toBe(false);
  });

  it("is false for every role when no role is assigned", () => {
    expect(hasRole(subject(null), USER_ROLES)).toBe(false);
    expect(hasRole(null, USER_ROLES)).toBe(false);
  });
});

describe("role predicates", () => {
  it.each([
    ["admin", true, false],
    ["engineering", false, true],
    [null, false, false],
  ])("reflect the assigned role (%s)", (role, admin, engineering) => {
    expect(isAdmin(subject(role))).toBe(admin);
    expect(isEngineering(subject(role))).toBe(engineering);
  });

  it.each([
    ["admin", true],
    ["engineering", false],
    [null, false],
  ])("only admins can upload data, manage data and manage users (%s)", (role, allowed) => {
    const user = subject(role);
    expect([canUploadData(user), canManageData(user), canManageUsers(user)]).toEqual([allowed, allowed, allowed]);
  });
});

describe("UserRole", () => {
  it("lists the role values", () => {
    expect(USER_ROLES).toEqual(["admin", "engineering"]);
  });
});
