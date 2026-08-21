import { describe, expect, it, vi } from "vitest";

const { execFile } = vi.hoisted(() => ({
  execFile: vi.fn(
    (
      _file: string,
      _args: readonly string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => callback(null, "secret\n", ""),
  ),
}));

vi.mock("node:child_process", () => ({ execFile }));

import { createKeychain } from "../lib/keychain";

describe("macOS Keychain gateway", () => {
  it("uses execFile arguments instead of a shell for allowlisted reads", async () => {
    const keychain = createKeychain();

    await expect(keychain.get("credential-hash-secret")).resolves.toBe("secret");
    expect(execFile).toHaveBeenCalledWith(
      "security",
      ["find-generic-password", "-s", "agent-memory-wiki", "-a", "credential-hash-secret", "-w"],
      expect.objectContaining({ encoding: "utf8", maxBuffer: 4_096 }),
      expect.any(Function),
    );
  });

  it("does not permit unrecognised Keychain accounts", async () => {
    await expect(createKeychain().get("DATABASE_URL" as never)).rejects.toThrow("Unsupported Keychain account");
  });
});
