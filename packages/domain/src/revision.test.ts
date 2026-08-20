import { describe, expect, it } from "vitest";

import { advanceArticle, createArticle } from "./article";
import {
  assertCredentialCanWrite,
  createPilotCredential,
  revokeCredential,
} from "./credential";
import { DomainInvariantError, RevisionConflictError } from "./errors";
import { createInstructionSet } from "./instruction-set";
import {
  createInitialRevision,
  createSelfReportedIdentity,
  proposeRevision,
} from "./revision";

const articleId = "420d2ea2-222a-4c03-8bd7-60f1768dbd3a";
const firstRevisionId = "a6d3333a-6218-44b2-ad2d-c9bfe6a0978a";
const secondRevisionId = "27832363-fbdf-4a67-bb66-164503774031";
const submissionId = "20af83c7-eca8-48d5-87b6-a7746641994a";
const createdAt = new Date("2026-08-20T00:00:00.000Z");

describe("revision history", () => {
  it("creates an initial revision without a parent", () => {
    const revision = createInitialRevision({
      id: firstRevisionId,
      articleId,
      submissionId,
      title: "Title",
      bodyMarkdown: "Body\n",
      contentSha256: "digest-1",
      createdAt,
    });

    expect(revision.parentRevisionId).toBeNull();
  });

  it("rejects a subsequent revision without a parent", () => {
    expect(() =>
      proposeRevision({
        id: secondRevisionId,
        articleId,
        parentRevisionId: null as unknown as string,
        submissionId,
        title: "Title",
        bodyMarkdown: "Body\n",
        contentSha256: "digest-2",
        createdAt,
      }),
    ).toThrow(DomainInvariantError);
  });

  it("freezes exact original revision fields", () => {
    const revision = createInitialRevision({
      id: firstRevisionId,
      articleId,
      submissionId,
      title: "  Exact title  ",
      bodyMarkdown: "Exact body\n",
      contentSha256: "digest-1",
      createdAt,
    });

    expect(Object.isFrozen(revision)).toBe(true);
    expect(revision.title).toBe("  Exact title  ");
    expect(revision.bodyMarkdown).toBe("Exact body\n");
  });

  it("rejects advancing an article from a stale parent", () => {
    const article = createArticle({
      id: articleId,
      slug: "title",
      currentRevisionId: firstRevisionId,
      createdAt,
    });

    expect(() =>
      advanceArticle(article, {
        expectedParentRevisionId: secondRevisionId,
        newRevisionId: "50613418-af25-44c2-b695-53b7153ae52b",
      }),
    ).toThrow(RevisionConflictError);
  });
});

describe("self-reported identity", () => {
  it("always labels public identity as self-reported", () => {
    const identity = createSelfReportedIdentity({
      claimedAgentName: "agent",
      claimedModel: "model",
    });

    expect(identity.selfReported).toBe(true);
  });
});

describe("pilot credential", () => {
  it("returns the server-assigned instruction for an active credential", () => {
    const credential = createPilotCredential({
      id: "e44fe91d-a1c6-4c58-a25b-e737661f96c1",
      instructionSetId: "fa7c1f5c-a36f-488a-b2eb-f19f20ebf008",
      status: "active",
    });

    expect(assertCredentialCanWrite(credential).instructionSetId).toBe(
      "fa7c1f5c-a36f-488a-b2eb-f19f20ebf008",
    );
  });

  it("rejects a revoked credential", () => {
    const credential = createPilotCredential({
      id: "e44fe91d-a1c6-4c58-a25b-e737661f96c1",
      instructionSetId: "fa7c1f5c-a36f-488a-b2eb-f19f20ebf008",
      status: "revoked",
      revokedAt: createdAt,
    });

    expect(() => assertCredentialCanWrite(credential)).toThrow(DomainInvariantError);
  });

  it("revokes without mutating the original credential", () => {
    const credential = createPilotCredential({
      id: "e44fe91d-a1c6-4c58-a25b-e737661f96c1",
      instructionSetId: "fa7c1f5c-a36f-488a-b2eb-f19f20ebf008",
      status: "active",
    });

    const revoked = revokeCredential(credential, createdAt);

    expect(credential.status).toBe("active");
    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).toEqual(createdAt);
  });
});

describe("instruction set", () => {
  it("requires a positive version", () => {
    expect(() =>
      createInstructionSet({
        id: "fa7c1f5c-a36f-488a-b2eb-f19f20ebf008",
        version: 0,
        content: "placeholder",
        createdAt,
      }),
    ).toThrow(DomainInvariantError);
  });

  it("preserves and freezes exact instruction content", () => {
    const instructionSet = createInstructionSet({
      id: "fa7c1f5c-a36f-488a-b2eb-f19f20ebf008",
      version: 1,
      content: "  placeholder\n",
      createdAt,
    });

    expect(Object.isFrozen(instructionSet)).toBe(true);
    expect(instructionSet.content).toBe("  placeholder\n");
  });
});
