import { afterEach, describe, expect, it } from "vitest";

import { environmentSecret, strictBooleanEnvironment } from "../lib/http/runtime";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

describe("runtime configuration", () => {
  it("rejects public placeholders and non-32-byte secrets", () => {
    process.env.TEST_SECRET = "replace-with-base64url-output-of-openssl-rand-32";
    expect(() => environmentSecret("TEST_SECRET")).toThrow("placeholder");
    process.env.TEST_SECRET = Buffer.alloc(33).toString("base64url");
    expect(() => environmentSecret("TEST_SECRET")).toThrow("exactly 32 bytes");
    process.env.TEST_SECRET = Buffer.alloc(32, 7).toString("base64url");
    expect(environmentSecret("TEST_SECRET")).toHaveLength(32);
  });

  it("parses booleans strictly and fails closed on typos", () => {
    process.env.TEST_BOOLEAN = "true";
    expect(strictBooleanEnvironment("TEST_BOOLEAN", false)).toBe(true);
    process.env.TEST_BOOLEAN = "false";
    expect(strictBooleanEnvironment("TEST_BOOLEAN", true)).toBe(false);
    process.env.TEST_BOOLEAN = "flase";
    expect(() => strictBooleanEnvironment("TEST_BOOLEAN", true)).toThrow("true or false");
  });
});
