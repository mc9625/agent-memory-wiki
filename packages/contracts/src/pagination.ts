import { z } from "zod";

export const paginationInputSchema = z
  .strictObject({
    cursor: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9_-]+$/u, "Cursor must be an opaque base64url value")
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .readonly();

export type PaginationInput = z.infer<typeof paginationInputSchema>;
