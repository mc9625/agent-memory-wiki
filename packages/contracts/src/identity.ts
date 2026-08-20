import { z } from "zod";

import { isDatabaseSafeText } from "./text";

const textEncoder = new TextEncoder();

const codePointLength = (value: string): number => [...value].length;
const utf8Length = (value: string): number => textEncoder.encode(value).byteLength;

const claimedIdentityTextSchema = z
  .string()
  .refine(isDatabaseSafeText, "Contains an unsupported character")
  .refine((value) => value.trim().length > 0, "Must not be blank")
  .refine((value) => codePointLength(value) <= 200, "Must not exceed 200 code points")
  .refine((value) => utf8Length(value) <= 512, "Must not exceed 512 UTF-8 bytes");

export type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

const rawClientMetadataSchema = z
  .record(z.string().refine(isDatabaseSafeText, "Metadata key contains an unsupported character"), z.unknown())
  .superRefine((value, context) => {
    const stack: { readonly depth: number; readonly value: unknown }[] = [
      { depth: 0, value },
    ];
    let nodes = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) break;
      nodes += 1;
      if (nodes > 512) {
        context.addIssue({ code: "custom", message: "Client metadata must not exceed 512 JSON nodes" });
        return;
      }
      if (current.depth > 16) {
        context.addIssue({ code: "custom", message: "Client metadata must not exceed 16 levels" });
        return;
      }
      const item = current.value;
      if (item === null || typeof item === "boolean") continue;
      if (typeof item === "string") {
        if (!isDatabaseSafeText(item)) {
          context.addIssue({ code: "custom", message: "Metadata string contains an unsupported character" });
          return;
        }
        continue;
      }
      if (typeof item === "number" && Number.isFinite(item)) continue;
      if (Array.isArray(item)) {
        for (const child of item) stack.push({ depth: current.depth + 1, value: child });
        continue;
      }
      if (typeof item === "object") {
        for (const [key, child] of Object.entries(item)) {
          if (!isDatabaseSafeText(key)) {
            context.addIssue({ code: "custom", message: "Metadata key contains an unsupported character" });
            return;
          }
          stack.push({ depth: current.depth + 1, value: child });
        }
        continue;
      }
      context.addIssue({ code: "custom", message: "Client metadata must contain JSON values only" });
      return;
    }
    try {
      if (utf8Length(JSON.stringify(value)) > 8_192) {
        context.addIssue({
          code: "custom",
          message: "Serialized client metadata must not exceed 8,192 UTF-8 bytes",
        });
      }
    } catch {
      context.addIssue({ code: "custom", message: "Client metadata must be serializable" });
    }
  }) as z.ZodType<Readonly<Record<string, JsonValue>>>;

export const selfReportedIdentitySchema = z
  .strictObject({
    claimed_agent_name: claimedIdentityTextSchema,
    claimed_model: claimedIdentityTextSchema.optional(),
    claimed_provider: claimedIdentityTextSchema.optional(),
    claimed_client: claimedIdentityTextSchema.optional(),
    raw_client_metadata: rawClientMetadataSchema.optional(),
  })
  .readonly();

export type SelfReportedIdentityInput = z.infer<typeof selfReportedIdentitySchema>;
