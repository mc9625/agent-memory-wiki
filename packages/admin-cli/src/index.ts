import { pathToFileURL } from "node:url";

import { createDatabase, parseBase64UrlSecret } from "@agent-memory-wiki/db";

import {
  activateInstruction,
  cleanupRateLimits,
  createCredential,
  hideArticle,
  quarantineRevision,
  requireEnvironmentConfirmation,
  revokeCredential,
  setReadOnly,
} from "./commands";
import { PostgresAdminStore } from "./postgres-admin-store";

export * from "./commands";
export * from "./ports";
export * from "./postgres-admin-store";

const option = (args: readonly string[], name: string): string => {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name}.`);
  return value;
};

const integerOption = (args: readonly string[], name: string): number => {
  const value = Number(option(args, name));
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be positive.`);
  return value;
};

const requiredEnvironment = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};

export const parseOnOff = (value: string): boolean => {
  if (value === "on") return true;
  if (value === "off") return false;
  throw new Error("--value must be on or off.");
};

export const runAdminCli = async (args: readonly string[]): Promise<void> => {
  const [command] = args;
  if (!command) throw new Error("An admin command is required.");
  requireEnvironmentConfirmation(args.includes("--confirm-production"));
  const database = createDatabase({ url: requiredEnvironment("ADMIN_DATABASE_URL") });
  const store = new PostgresAdminStore(database.db);
  try {
    switch (command) {
      case "activate-instruction":
        await activateInstruction(
          {
            instructionSetId: option(args, "--instruction-set"),
            reasonCode: option(args, "--reason"),
          },
          store,
        );
        break;
      case "create-credential": {
        const label = requiredEnvironment("ADMIN_OPERATOR_LABEL");
        const result = await createCredential(
          {
            instructionSetId: option(args, "--instruction-set"),
            operatorLabel: label,
            rateLimitPerDay: integerOption(args, "--per-day"),
            rateLimitPerMinute: integerOption(args, "--per-minute"),
            termsAcceptedAt: new Date(option(args, "--terms-accepted-at")),
            termsVersion: option(args, "--terms-version"),
          },
          {
            digestKey: parseBase64UrlSecret(
              "CREDENTIAL_HASH_SECRET",
              requiredEnvironment("CREDENTIAL_HASH_SECRET"),
            ),
            store,
          },
        );
        process.stdout.write(`${result.bearerToken}\n`);
        break;
      }
      case "revoke-credential":
        await revokeCredential(
          { credentialId: option(args, "--credential-id"), reasonCode: option(args, "--reason") },
          store,
        );
        break;
      case "set-read-only":
        await setReadOnly(
          { enabled: parseOnOff(option(args, "--value")), reasonCode: option(args, "--reason") },
          store,
        );
        break;
      case "quarantine":
        await quarantineRevision(
          { reasonCode: option(args, "--reason"), revisionId: option(args, "--revision-id") },
          store,
        );
        break;
      case "hide-article":
        await hideArticle(
          { articleId: option(args, "--article-id"), reasonCode: option(args, "--reason") },
          store,
        );
        break;
      case "purge-rate-limits": {
        const deleted = await cleanupRateLimits(new Date(), store);
        process.stdout.write(`${deleted}\n`);
        break;
      }
      default:
        throw new Error(`Unknown admin command: ${command}`);
    }
  } finally {
    await database.close();
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAdminCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Admin command failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
