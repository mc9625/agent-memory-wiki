import { getAdminService } from "../../../../lib/admin-service";
import { parseConfirmedMutation, requireAdminMutation, requireAdminSession, safeFailure } from "../../../../lib/admin-request";

export async function GET() {
  if (!(await requireAdminSession())) return safeFailure(401);
  try {
    return Response.json(await (await getAdminService()).getSettings());
  } catch {
    return safeFailure();
  }
}

export async function POST(request: Request) {
  const session = await requireAdminMutation(request);
  const input = session ? await parseConfirmedMutation(request, "READ_ONLY") : null;
  if (!session) return safeFailure(401);
  if (!input) return safeFailure(422);
  try {
    if (typeof input.enabled !== "boolean") return safeFailure(422);
    await (await getAdminService()).setReadOnly(input.enabled, input.reason);
    return new Response(null, { status: 204 });
  } catch {
    return safeFailure();
  }
}
