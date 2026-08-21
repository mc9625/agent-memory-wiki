import {
  PostgresAdminStore,
  activateInstruction,
  createCredential,
  hideArticle,
  quarantineRevision,
  revokeCredential,
  setReadOnly,
  type AdminStore,
} from "@agent-memory-wiki/admin-cli";
import { createDatabase, parseBase64UrlSecret } from "@agent-memory-wiki/db";

import { presentCredential } from "./admin-views";
import { createKeychain, type KeychainAccount, type ParticipantTokenAccount } from "./keychain";

interface KeychainGateway {
  get(account: KeychainAccount | ParticipantTokenAccount): Promise<string>;
  setParticipantToken(account: ParticipantTokenAccount, token: string): Promise<void>;
}

interface AdminServiceDependencies {
  readonly keychain: KeychainGateway;
  readonly store: AdminStore;
}

export const createAdminService = ({ keychain, store }: AdminServiceDependencies) => ({
  async activateInstruction(instructionSetId: string, reasonCode: string): Promise<void> {
    await activateInstruction({ instructionSetId, reasonCode }, store);
  },
  async createCredential(input: {
    readonly instructionSetId: string;
    readonly operatorLabel: string;
    readonly rateLimitPerDay: number;
    readonly rateLimitPerMinute: number;
    readonly termsAcceptedAt: Date;
    readonly termsVersion: string;
  }): Promise<{ readonly bearerToken: string; readonly credentialId: string }> {
    const digestKey = parseBase64UrlSecret("credential-hash-secret", await keychain.get("credential-hash-secret"));
    const result = await createCredential(input, { digestKey, store });
    await keychain.setParticipantToken(`participant-token-${result.credentialId}`, result.bearerToken);
    return result;
  },
  async getSettings() {
    return store.getSettings();
  },
  async hideArticle(articleId: string, reasonCode: string): Promise<void> {
    await hideArticle({ articleId, reasonCode }, store);
  },
  async listCredentials() {
    return (await store.listCredentials()).map(presentCredential);
  },
  async quarantineRevision(revisionId: string, reasonCode: string): Promise<void> {
    await quarantineRevision({ reasonCode, revisionId }, store);
  },
  async revokeCredential(credentialId: string, reasonCode: string): Promise<void> {
    await revokeCredential({ credentialId, reasonCode }, store);
  },
  async setReadOnly(enabled: boolean, reasonCode: string): Promise<void> {
    await setReadOnly({ enabled, reasonCode }, store);
  },
});

let servicePromise: Promise<ReturnType<typeof createAdminService>> | undefined;

export const getAdminService = (): Promise<ReturnType<typeof createAdminService>> => {
  servicePromise ??= (async () => {
    const keychain = createKeychain();
    const url = await keychain.get("neon-admin-database-url");
    const database = createDatabase({ maxConnections: 3, url });
    return createAdminService({ keychain, store: new PostgresAdminStore(database.db) });
  })();
  return servicePromise;
};
