import { execFileSync } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";

import { eq, sql } from "drizzle-orm";
import {
  createDatabase,
  parseBase64UrlSecret,
  instructionSets,
  pilotCredentials,
  revisions,
  articles,
} from "@agent-memory-wiki/db";

import { PostgresAdminStore } from "./postgres-admin-store";
import {
  activateInstruction,
  cleanupRateLimits,
  createCredential,
  hideArticle,
  quarantineRevision,
  revokeCredential,
  setReadOnly,
} from "./commands";

function getFromKeychain(account: string): string | null {
  try {
    const stdout = execFileSync(
      "security",
      ["find-generic-password", "-s", "agent-memory-wiki", "-a", account, "-w"],
      { encoding: "utf8" }
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

const databaseUrl = process.env.ADMIN_DATABASE_URL || getFromKeychain("neon-admin-database-url");
const credentialHashSecret = process.env.CREDENTIAL_HASH_SECRET || getFromKeychain("credential-hash-secret");
const defaultOperatorLabel = process.env.ADMIN_OPERATOR_LABEL || "local-operator";

if (!databaseUrl) {
  console.error("\x1b[31mError: ADMIN_DATABASE_URL is not set and could not be retrieved from the macOS Keychain.\x1b[0m");
  process.exit(1);
}

if (!credentialHashSecret) {
  console.error("\x1b[31mError: CREDENTIAL_HASH_SECRET is not set and could not be retrieved from the macOS Keychain.\x1b[0m");
  process.exit(1);
}

const database = createDatabase({ url: databaseUrl });
const store = new PostgresAdminStore(database.db);
const digestKey = parseBase64UrlSecret("CREDENTIAL_HASH_SECRET", credentialHashSecret);

const rl = readline.createInterface({ input, output });

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

const printHeader = (text: string) => {
  console.log(`\n${colors.cyan}${colors.bright}=== ${text} ===${colors.reset}`);
};

const getInstructionSets = async () => {
  return database.db.select().from(instructionSets);
};

const listCredentials = async () => {
  const items = await database.db.select().from(pilotCredentials);
  printHeader("CREDENTIALS LIST");
  if (items.length === 0) {
    console.log("No credentials found.");
    return;
  }
  
  console.log(
    `${colors.bright}${"Operator Label".padEnd(25)} | ${"Public Prefix".padEnd(18)} | ${"Status".padEnd(10)} | ${"ID"}${colors.reset}`
  );
  console.log("-".repeat(85));
  for (const item of items) {
    const statusColor = item.status === "active" ? colors.green : colors.red;
    console.log(
      `${(item.operatorLabel || "—").padEnd(25)} | ${item.publicPrefix.padEnd(18)} | ${statusColor}${item.status.padEnd(10)}${colors.reset} | ${item.id}`
    );
  }
};

const selectInstructionSet = async () => {
  const sets = await getInstructionSets();
  printHeader("SELECT INSTRUCTION SET");
  for (let i = 0; i < sets.length; i++) {
    const set = sets[i];
    if (!set) continue;
    console.log(`[${i + 1}] Version ${set.version} (${set.id})`);
    console.log(`    Content snippet: ${set.content.slice(0, 100).replace(/\n/g, " ")}...`);
  }
  
  while (true) {
    const ans = await rl.question(`\nSelect an option (1-${sets.length}): `);
    const idx = parseInt(ans, 10) - 1;
    if (idx >= 0 && idx < sets.length) {
      return sets[idx]!.id;
    }
    console.log(`${colors.red}Invalid option.${colors.reset}`);
  }
};

const handleCreateCredential = async () => {
  try {
    const instructionSetId = await selectInstructionSet();
    
    printHeader("CREATE NEW CREDENTIAL");
    const operatorLabel = (await rl.question(`Participant label [${defaultOperatorLabel}]: `)).trim() || defaultOperatorLabel;
    const termsVersion = (await rl.question("Terms version [pilot-v1]: ")).trim() || "pilot-v1";
    const perMinuteStr = (await rl.question("Per-minute rate limit [10]: ")).trim() || "10";
    const perDayStr = (await rl.question("Daily rate limit [100]: ")).trim() || "100";
    
    const perMinute = parseInt(perMinuteStr, 10);
    const perDay = parseInt(perDayStr, 10);
    
    if (isNaN(perMinute) || perMinute <= 0 || isNaN(perDay) || perDay <= 0) {
      console.log(`${colors.red}Error: Rate limits must be positive integers.${colors.reset}`);
      return;
    }
    
    const result = await createCredential(
      {
        instructionSetId,
        operatorLabel,
        rateLimitPerDay: perDay,
        rateLimitPerMinute: perMinute,
        termsAcceptedAt: new Date(),
        termsVersion,
      },
      { digestKey, store }
    );
    
    console.log(`\n${colors.green}${colors.bright}✔ Credential successfully created!${colors.reset}`);
    console.log(`${colors.bright}Bearer Token:${colors.reset} ${colors.yellow}${result.bearerToken}${colors.reset}`);
    console.log(`${colors.yellow}IMPORTANT: Copy this token now. It cannot be retrieved again.${colors.reset}`);
  } catch (error: any) {
    console.error(`${colors.red}Error creating credential: ${error.message}${colors.reset}`);
  }
};

const handleRevokeCredential = async () => {
  const activeItems = (await database.db.select().from(pilotCredentials)).filter(c => c.status === "active");
  
  if (activeItems.length === 0) {
    console.log("\nNo active credentials available to revoke.");
    return;
  }
  
  printHeader("SELECT CREDENTIAL TO REVOKE");
  for (let i = 0; i < activeItems.length; i++) {
    const item = activeItems[i];
    if (!item) continue;
    console.log(`[${i + 1}] ${item.operatorLabel || "—"} (prefix: ${item.publicPrefix})`);
  }
  console.log(`[0] Cancel`);
  
  const choice = await rl.question(`\nSelect a credential to revoke (0-${activeItems.length}): `);
  const idx = parseInt(choice, 10) - 1;
  if (idx === -1) return;
  if (idx < 0 || idx >= activeItems.length) {
    console.log(`${colors.red}Invalid selection.${colors.reset}`);
    return;
  }
  
  const credential = activeItems[idx]!;
  const reason = (await rl.question("Reason for revocation: ")).trim();
  if (!reason) {
    console.log(`${colors.red}Error: A reason is required.${colors.reset}`);
    return;
  }
  
  try {
    await revokeCredential({ credentialId: credential.id, reasonCode: reason }, store);
    console.log(`${colors.green}✔ Credential ${credential.publicPrefix} successfully revoked.${colors.reset}`);
  } catch (error: any) {
    console.error(`${colors.red}Error revoking credential: ${error.message}${colors.reset}`);
  }
};

const handleSetReadOnly = async () => {
  printHeader("SET WIKI READ-ONLY MODE");
  const valueInput = (await rl.question("Set read-only mode to on or off? (on/off): ")).trim().toLowerCase();
  
  if (valueInput !== "on" && valueInput !== "off") {
    console.log(`${colors.red}Invalid option. Type 'on' or 'off'.${colors.reset}`);
    return;
  }
  
  const enabled = valueInput === "on";
  const reason = (await rl.question("Reason for changing read-only mode: ")).trim();
  if (!reason) {
    console.log(`${colors.red}Error: A reason is required.${colors.reset}`);
    return;
  }
  
  try {
    await setReadOnly({ enabled, reasonCode: reason }, store);
    console.log(`${colors.green}✔ Read-only mode successfully set to ${valueInput.toUpperCase()}.${colors.reset}`);
  } catch (error: any) {
    console.error(`${colors.red}Error setting read-only mode: ${error.message}${colors.reset}`);
  }
};

const handleQuarantineRevision = async () => {
  const latestRevisions = await database.db.select().from(revisions).orderBy(sql`${revisions.createdAt} DESC`).limit(10);
  
  printHeader("QUARANTINE REVISION");
  if (latestRevisions.length > 0) {
    console.log("Recent revisions:");
    for (let i = 0; i < latestRevisions.length; i++) {
      const rev = latestRevisions[i];
      if (!rev) continue;
      console.log(`[${i + 1}] Title: "${rev.title}" (ID: ${rev.id})`);
    }
  }
  
  const targetIdInput = (await rl.question("\nEnter revision ID (or select index 1-10): ")).trim();
  let revisionId = targetIdInput;
  
  const idx = parseInt(targetIdInput, 10) - 1;
  if (!isNaN(idx) && idx >= 0 && idx < latestRevisions.length) {
    revisionId = latestRevisions[idx]!.id;
  }
  
  if (!revisionId) {
    console.log(`${colors.red}Error: Revision ID is required.${colors.reset}`);
    return;
  }
  
  const reason = (await rl.question("Reason for quarantining: ")).trim();
  if (!reason) {
    console.log(`${colors.red}Error: A reason is required.${colors.reset}`);
    return;
  }
  
  try {
    await quarantineRevision({ revisionId, reasonCode: reason }, store);
    console.log(`${colors.green}✔ Revision ${revisionId} quarantined successfully.${colors.reset}`);
  } catch (error: any) {
    console.error(`${colors.red}Error quarantining revision: ${error.message}${colors.reset}`);
  }
};

const handleHideArticle = async () => {
  const latestArticles = await database.db.select().from(articles).orderBy(sql`${articles.createdAt} DESC`).limit(10);
  
  printHeader("HIDE ARTICLE");
  if (latestArticles.length > 0) {
    console.log("Recent articles:");
    for (let i = 0; i < latestArticles.length; i++) {
      const art = latestArticles[i];
      if (!art) continue;
      let title = "unknown";
      if (art.currentRevisionId) {
        const [rev] = await database.db.select({ title: revisions.title }).from(revisions).where(eq(revisions.id, art.currentRevisionId)).limit(1);
        if (rev) title = rev.title;
      }
      console.log(`[${i + 1}] Title: "${title}" (Slug: ${art.slug}, ID: ${art.id})`);
    }
  }
  
  const targetIdInput = (await rl.question("\nEnter article ID (or select index 1-10): ")).trim();
  let articleId = targetIdInput;
  
  const idx = parseInt(targetIdInput, 10) - 1;
  if (!isNaN(idx) && idx >= 0 && idx < latestArticles.length) {
    articleId = latestArticles[idx]!.id;
  }
  
  if (!articleId) {
    console.log(`${colors.red}Error: Article ID is required.${colors.reset}`);
    return;
  }
  
  const reason = (await rl.question("Reason for hiding: ")).trim();
  if (!reason) {
    console.log(`${colors.red}Error: A reason is required.${colors.reset}`);
    return;
  }
  
  try {
    await hideArticle({ articleId, reasonCode: reason }, store);
    console.log(`${colors.green}✔ Article ${articleId} hidden successfully.${colors.reset}`);
  } catch (error: any) {
    console.error(`${colors.red}Error hiding article: ${error.message}${colors.reset}`);
  }
};

const handlePurgeRateLimits = async () => {
  printHeader("PURGE RATE LIMITS");
  try {
    const deleted = await cleanupRateLimits(new Date(), store);
    console.log(`${colors.green}✔ Successfully purged ${deleted} expired rate limit buckets.${colors.reset}`);
  } catch (error: any) {
    console.error(`${colors.red}Error purging rate limits: ${error.message}${colors.reset}`);
  }
};

const handleActivateInstruction = async () => {
  const sets = await getInstructionSets();
  printHeader("SELECT INSTRUCTION SET TO ACTIVATE");
  for (let i = 0; i < sets.length; i++) {
    const set = sets[i];
    if (!set) continue;
    console.log(`[${i + 1}] Version ${set.version} (${set.id})`);
    console.log(`    Content snippet: ${set.content.slice(0, 100).replace(/\n/g, " ")}...`);
  }
  console.log("[0] Cancel");
  
  const choice = await rl.question(`\nSelect an instruction set (0-${sets.length}): `);
  const idx = parseInt(choice, 10) - 1;
  if (idx === -1) return;
  if (idx < 0 || idx >= sets.length) {
    console.log(`${colors.red}Invalid selection.${colors.reset}`);
    return;
  }
  
  const set = sets[idx]!;
  const reason = (await rl.question("Reason for activation: ")).trim();
  if (!reason) {
    console.log(`${colors.red}Error: A reason is required.${colors.reset}`);
    return;
  }
  
  try {
    await activateInstruction({ instructionSetId: set.id, reasonCode: reason }, store);
    console.log(`${colors.green}✔ Instruction set version ${set.version} activated successfully.${colors.reset}`);
  } catch (error: any) {
    console.error(`${colors.red}Error activating instruction set: ${error.message}${colors.reset}`);
  }
};

const main = async () => {
  let running = true;
  while (running) {
    printHeader("WIKI ADMIN CONSOLE");
    console.log("[1] List credentials");
    console.log("[2] Create a new credential");
    console.log("[3] Revoke a credential");
    console.log("[4] Set read-only mode");
    console.log("[5] Quarantine a revision");
    console.log("[6] Hide an article");
    console.log("[7] Purge rate limits");
    console.log("[8] Activate instruction set");
    console.log("[0] Exit");
    
    const ans = (await rl.question("\nSelect an action (0-8): ")).trim();
    switch (ans) {
      case "1":
        await listCredentials();
        break;
      case "2":
        await handleCreateCredential();
        break;
      case "3":
        await handleRevokeCredential();
        break;
      case "4":
        await handleSetReadOnly();
        break;
      case "5":
        await handleQuarantineRevision();
        break;
      case "6":
        await handleHideArticle();
        break;
      case "7":
        await handlePurgeRateLimits();
        break;
      case "8":
        await handleActivateInstruction();
        break;
      case "0":
        running = false;
        break;
      default:
        console.log(`${colors.red}Invalid option.${colors.reset}`);
    }
  }
  
  rl.close();
  await database.close();
  console.log("\nGoodbye!");
};

main().catch((err) => {
  console.error("Fatal error:", err);
  rl.close();
  process.exit(1);
});
