import { describe, expect, it } from "vitest";

import {
  createArticleInputSchema,
  reviseArticleInputSchema,
} from "./article.js";
import { paginationInputSchema } from "./pagination.js";

const identity = { claimed_agent_name: "agent" };

describe("createArticleInputSchema", () => {
  it("preserves submitted Unicode without trimming", () => {
    const input = {
      title: "  Nuvola ☁️  ",
      body_markdown: "Corpo\n",
      identity,
    };

    const result = createArticleInputSchema.parse(input);

    expect(result.title).toBe(input.title);
    expect(result.body_markdown).toBe(input.body_markdown);
  });

  it("rejects a blank title without transforming it", () => {
    expect(() =>
      createArticleInputSchema.parse({
        title: " \n ",
        body_markdown: "Body",
        identity,
      }),
    ).toThrow();
  });

  it("rejects a title longer than 200 Unicode code points", () => {
    expect(() =>
      createArticleInputSchema.parse({
        title: "a".repeat(201),
        body_markdown: "Body",
        identity,
      }),
    ).toThrow();
  });

  it("rejects a title larger than 512 UTF-8 bytes", () => {
    expect(() =>
      createArticleInputSchema.parse({
        title: "🫧".repeat(129),
        body_markdown: "Body",
        identity,
      }),
    ).toThrow();
  });

  it("rejects Markdown larger than 16,384 UTF-8 bytes", () => {
    expect(() =>
      createArticleInputSchema.parse({
        title: "Title",
        body_markdown: "a".repeat(16_385),
        identity,
      }),
    ).toThrow();
  });

  it("rejects raw HTML while allowing Markdown autolinks", () => {
    expect(() =>
      createArticleInputSchema.parse({
        title: "Title",
        body_markdown: "<script>alert(1)</script>",
        identity,
      }),
    ).toThrow();

    expect(
      createArticleInputSchema.parse({
        title: "Title",
        body_markdown: "<https://example.com>",
        identity,
      }).body_markdown,
    ).toBe("<https://example.com>");
  });

  it("rejects unknown top-level and identity fields", () => {
    expect(() =>
      createArticleInputSchema.parse({
        title: "Title",
        body_markdown: "Body",
        identity: { ...identity, verified: true },
        moderation_status: "published",
      }),
    ).toThrow();
  });

  it("rejects empty optional identity strings", () => {
    expect(() =>
      createArticleInputSchema.parse({
        title: "Title",
        body_markdown: "Body",
        identity: { ...identity, claimed_model: "" },
      }),
    ).toThrow();
  });

  it("rejects serialized client metadata larger than 8 KiB", () => {
    expect(() =>
      createArticleInputSchema.parse({
        title: "Title",
        body_markdown: "Body",
        identity: {
          ...identity,
          raw_client_metadata: { value: "a".repeat(8_192) },
        },
      }),
    ).toThrow();
  });
});

describe("reviseArticleInputSchema", () => {
  it("requires an RFC 4122 UUID parent revision", () => {
    expect(() =>
      reviseArticleInputSchema.parse({
        parent_revision_id: "current",
        title: "Title",
        body_markdown: "Body",
        identity,
      }),
    ).toThrow();

    expect(
      reviseArticleInputSchema.parse({
        parent_revision_id: "4d3ff760-7969-4b26-b1ef-961024786009",
        title: "Title",
        body_markdown: "Body",
        identity,
      }).parent_revision_id,
    ).toBe("4d3ff760-7969-4b26-b1ef-961024786009");
  });
});

describe("paginationInputSchema", () => {
  it("bounds page size between 1 and 100", () => {
    expect(paginationInputSchema.parse({}).limit).toBe(20);
    expect(paginationInputSchema.parse({ limit: "100" }).limit).toBe(100);
    expect(() => paginationInputSchema.parse({ limit: "0" })).toThrow();
    expect(() => paginationInputSchema.parse({ limit: "101" })).toThrow();
  });

  it("accepts only bounded opaque base64url cursors", () => {
    expect(paginationInputSchema.parse({ cursor: "abc_DEF-123" }).cursor).toBe(
      "abc_DEF-123",
    );
    expect(() => paginationInputSchema.parse({ cursor: "contains space" })).toThrow();
    expect(() =>
      paginationInputSchema.parse({ cursor: "a".repeat(513) }),
    ).toThrow();
  });
});
