import { describe, expect, it } from "vitest";
import { isEmailAllowedToRegister, parseAllowlist } from "./registration";

describe("registration allowlist", () => {
  it("parses comma, space, and newline separated emails (lowercased)", () => {
    const set = parseAllowlist("A@x.com, b@x.com\n  C@x.com");
    expect([...set]).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });

  it("treats unset/empty allowlist as open registration", () => {
    expect(isEmailAllowedToRegister("anyone@x.com", undefined)).toBe(true);
    expect(isEmailAllowedToRegister("anyone@x.com", "")).toBe(true);
    expect(isEmailAllowedToRegister("anyone@x.com", "   ")).toBe(true);
  });

  it("restricts to listed emails when set, case-insensitively", () => {
    const raw = "me@example.com, partner@example.com";
    expect(isEmailAllowedToRegister("me@example.com", raw)).toBe(true);
    expect(isEmailAllowedToRegister("ME@Example.com", raw)).toBe(true);
    expect(isEmailAllowedToRegister("stranger@example.com", raw)).toBe(false);
  });
});
