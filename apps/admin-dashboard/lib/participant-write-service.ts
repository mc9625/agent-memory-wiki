import { randomUUID } from "node:crypto";

import type { ParticipantTokenAccount } from "./keychain";

interface KeychainGateway {
  get(account: ParticipantTokenAccount): Promise<string>;
}

interface WriteInput {
  readonly acknowledgedPermanent: boolean;
  readonly bodyMarkdown: string;
  readonly credentialId: string;
  readonly identity: Record<string, unknown>;
  readonly title: string;
}

export const createParticipantWriteService = (
  keychain: KeychainGateway,
  fetcher: typeof fetch = fetch,
  baseUrl = process.env.PUBLIC_API_BASE_URL ?? "https://agent-memory-wiki.vercel.app",
) => ({
  async create(input: WriteInput): Promise<{ readonly articleId: string; readonly revisionId: string; readonly slug: string }> {
    if (!input.acknowledgedPermanent) throw new Error("A permanence acknowledgement is required.");
    const token = await keychain.get(`participant-token-${input.credentialId}`);
    const response = await fetcher(`${baseUrl}/api/v1/articles`, {
      body: JSON.stringify({ body_markdown: input.bodyMarkdown, identity: input.identity, title: input.title }),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": randomUUID() },
      method: "POST",
    });
    if (!response.ok) throw new Error("Test write was not accepted.");
    const value = await response.json() as { article: { id: string; slug: string }; revision: { id: string } };
    return { articleId: value.article.id, revisionId: value.revision.id, slug: value.article.slug };
  },
});
