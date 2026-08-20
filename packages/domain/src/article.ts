import { DomainInvariantError, RevisionConflictError } from "./errors.js";

export interface Article {
  readonly id: string;
  readonly slug: string;
  readonly currentRevisionId: string;
  readonly createdAt: Date;
}

export const createArticle = (input: Article): Article => {
  if (!input.id || !input.slug || !input.currentRevisionId) {
    throw new DomainInvariantError("An article requires an id, slug, and current revision");
  }

  return Object.freeze({ ...input });
};

export const advanceArticle = (
  article: Article,
  input: Readonly<{
    expectedParentRevisionId: string;
    newRevisionId: string;
  }>,
): Article => {
  if (article.currentRevisionId !== input.expectedParentRevisionId) {
    throw new RevisionConflictError();
  }

  if (!input.newRevisionId) {
    throw new DomainInvariantError("A new revision id is required");
  }

  return Object.freeze({ ...article, currentRevisionId: input.newRevisionId });
};
