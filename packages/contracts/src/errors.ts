import { z } from "zod";

export const errorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "AUTHENTICATION_REQUIRED",
  "CREDENTIAL_REVOKED",
  "ARTICLE_NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "DUPLICATE_CONTENT",
  "REVISION_CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "SUBMISSION_QUARANTINED",
  "RATE_LIMITED",
  "READ_ONLY",
  "DEPENDENCY_UNAVAILABLE",
]);

export const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: errorCodeSchema,
    message: z.string().min(1),
    request_id: z.string().min(1),
  }),
});

export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
