import { createParticipantWriteService } from "../../../../lib/participant-write-service";
import { createKeychain } from "../../../../lib/keychain";
import { requireAdminMutation, safeFailure } from "../../../../lib/admin-request";

export async function POST(request: Request) {
  if (!(await requireAdminMutation(request))) return safeFailure(401);
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) return safeFailure(422);
    const { acknowledgedPermanent, bodyMarkdown, credentialId, identity, title } = input as Record<string, unknown>;
    if (acknowledgedPermanent !== true || typeof bodyMarkdown !== "string" || typeof credentialId !== "string" || typeof title !== "string" || !identity || typeof identity !== "object" || Array.isArray(identity)) return safeFailure(422);
    const result = await createParticipantWriteService(createKeychain()).create({ acknowledgedPermanent, bodyMarkdown, credentialId, identity: identity as Record<string, unknown>, title });
    return Response.json(result, { status: 201 });
  } catch { return safeFailure(); }
}
