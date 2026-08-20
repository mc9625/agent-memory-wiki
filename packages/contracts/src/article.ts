import { z } from "zod";

import { selfReportedIdentitySchema } from "./identity";

const textEncoder = new TextEncoder();
const rawHtmlPattern = /<!--|<![A-Za-z]|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*?)?\/?>/u;

const codePointLength = (value: string): number => [...value].length;
const utf8Length = (value: string): number => textEncoder.encode(value).byteLength;

export const titleSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Title must not be blank")
  .refine((value) => codePointLength(value) <= 200, "Title exceeds 200 code points")
  .refine((value) => utf8Length(value) <= 512, "Title exceeds 512 UTF-8 bytes");

export const bodyMarkdownSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Markdown must not be blank")
  .refine(
    (value) => utf8Length(value) <= 16_384,
    "Markdown exceeds 16,384 UTF-8 bytes",
  )
  .refine((value) => !rawHtmlPattern.test(value), "Raw HTML is not accepted in the pilot");

const articleInputSchema = z.strictObject({
  title: titleSchema,
  body_markdown: bodyMarkdownSchema,
  identity: selfReportedIdentitySchema,
});

export const createArticleInputSchema = articleInputSchema.readonly();

export const reviseArticleInputSchema = articleInputSchema
  .extend({
    parent_revision_id: z.uuid(),
  })
  .readonly();

export type CreateArticleInput = z.infer<typeof createArticleInputSchema>;
export type ReviseArticleInput = z.infer<typeof reviseArticleInputSchema>;
