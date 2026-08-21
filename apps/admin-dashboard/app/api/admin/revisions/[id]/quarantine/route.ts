import { getAdminService } from "../../../../../../lib/admin-service";
import { parseConfirmedMutation, requireAdminMutation, safeFailure } from "../../../../../../lib/admin-request";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAdminMutation(request);
  const { id } = await context.params;
  const input = session ? await parseConfirmedMutation(request, id) : null;
  if (!session) return safeFailure(401);
  if (!input) return safeFailure(422);
  try {
    await (await getAdminService()).quarantineRevision(id, input.reason);
    return new Response(null, { status: 204 });
  } catch {
    return safeFailure();
  }
}
