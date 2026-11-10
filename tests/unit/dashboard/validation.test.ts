import { describe, expect, it } from "vitest";
import { z } from "zod";

import { strLimit, plural, statusLabel } from "@/server/dashboard/format";
import {
  EMAIL_PATTERN,
  formValues,
  messages,
  parseDateYmd,
  passwordIssues,
  requiredString,
  todayYmd,
  zodFieldErrors,
} from "@/server/dashboard/validation";

describe("formValues", () => {
  it("trims strings, keeps passwords as typed and turns empty strings into null", () => {
    const data = new FormData();
    data.set("name", "  Ann  ");
    data.set("username", "   ");
    data.set("password", " secret ");
    expect(formValues(data, ["name", "username", "password", "email"])).toEqual({
      name: "Ann",
      username: null,
      password: " secret ",
      email: undefined,
    });
  });
});

describe("messages", () => {
  it("uses Laravel's attribute names and texts", () => {
    expect(messages.required("layer_category_id")).toBe("The layer category id field is required.");
    expect(messages.unique("username")).toBe("The username has already been taken.");
    expect(messages.different("password", "current_password")).toBe(
      "The password field and current password must be different.",
    );
  });

  it("reports a missing required field once", () => {
    const result = z.object({ name: requiredString("name").max(3) }).safeParse({ name: null });
    expect(result.success).toBe(false);
    if (!result.success) expect(zodFieldErrors(result.error)).toEqual({ name: ["The name field is required."] });
  });
});

describe("passwordIssues", () => {
  it("lists confirmed, different and min in Laravel's rule order", () => {
    expect(passwordIssues("abc", "xyz", { different: { value: "abc", field: "current_password" } })).toEqual([
      "The password field confirmation does not match.",
      "The password field and current password must be different.",
      "The password field must be at least 8 characters.",
    ]);
    expect(passwordIssues("long-enough", "long-enough")).toEqual([]);
  });
});

describe("dates", () => {
  it("accepts real Y-m-d dates only", () => {
    expect(parseDateYmd("2026-02-28")).not.toBeNull();
    expect(parseDateYmd("2026-02-30")).toBeNull();
    expect(parseDateYmd("2026-2-3")).toBeNull();
    expect(parseDateYmd("yesterday")).toBeNull();
  });

  it("formats today in local time", () => {
    expect(todayYmd(new Date(2026, 10, 9, 23, 59))).toBe("2026-11-09");
  });
});

describe("EMAIL_PATTERN", () => {
  it.each(["admin@mail.com", "first.last+tag@sub.example.co.id", "admin@localhost"])("accepts %s", (email) => {
    expect(EMAIL_PATTERN.test(email)).toBe(true);
  });

  it.each(["plain", "a@b@c.com", "a b@c.com", "a@", "@b.com", "a@b..com", "a@.b.com"])("rejects %s", (email) => {
    expect(EMAIL_PATTERN.test(email)).toBe(false);
  });
});

describe("format helpers", () => {
  it("limits long text like Str::limit", () => {
    expect(strLimit("abcdef", 3)).toBe("abc...");
    expect(strLimit("abc", 3)).toBe("abc");
  });

  it("pluralises and labels", () => {
    expect(`1 ${plural("layer", 1)}`).toBe("1 layer");
    expect(`0 ${plural("layer", 0)}`).toBe("0 layers");
    expect(statusLabel("process_failed")).toBe("process failed");
  });
});
