import { z } from "zod";

const textEncoder = new TextEncoder();

const codePointLength = (value: string): number => [...value].length;
const utf8Length = (value: string): number => textEncoder.encode(value).byteLength;

const claimedIdentityTextSchema = z
  .string()
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

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const rawClientMetadataSchema = z
  .record(z.string(), jsonValueSchema)
  .refine((value) => {
    try {
      return utf8Length(JSON.stringify(value)) <= 8_192;
    } catch {
      return false;
    }
  }, "Serialized client metadata must not exceed 8,192 UTF-8 bytes");

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
