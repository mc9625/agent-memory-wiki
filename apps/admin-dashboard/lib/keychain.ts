import { execFile as execFileCallback } from "node:child_process";
const serviceName = "agent-memory-wiki";

const allowedAccounts = [
  "credential-hash-secret",
  "neon-admin-database-url",
] as const;

export type KeychainAccount = (typeof allowedAccounts)[number];

export type ParticipantTokenAccount = `participant-token-${string}`;

const isKeychainAccount = (account: string): account is KeychainAccount =>
  (allowedAccounts as readonly string[]).includes(account);

const isParticipantTokenAccount = (account: string): account is ParticipantTokenAccount =>
  /^participant-token-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(account);

export const createKeychain = () => ({
  async get(account: KeychainAccount | ParticipantTokenAccount): Promise<string> {
    if (!isKeychainAccount(account) && !isParticipantTokenAccount(account)) {
      throw new Error("Unsupported Keychain account.");
    }
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFileCallback(
          "security",
          ["find-generic-password", "-s", serviceName, "-a", account, "-w"],
          { encoding: "utf8", maxBuffer: 4_096 },
          (error, output) => (error ? reject(error) : resolve(output)),
        );
      });
      const secret = stdout.trim();
      if (!secret) throw new Error("Keychain value is empty.");
      return secret;
    } catch {
      throw new Error("Required local Keychain item is unavailable.");
    }
  },
  async setParticipantToken(account: ParticipantTokenAccount, token: string): Promise<void> {
    if (!isParticipantTokenAccount(account) || !token) throw new Error("Invalid participant token.");
    await new Promise<void>((resolve, reject) => {
      execFileCallback(
        "security",
        ["add-generic-password", "-U", "-s", serviceName, "-a", account, "-w", token],
        { encoding: "utf8", maxBuffer: 4_096 },
        (error) => (error ? reject(error) : resolve()),
      );
    }).catch(() => {
      throw new Error("Could not store the participant token in the local Keychain.");
    });
  },
});
