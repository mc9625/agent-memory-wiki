import { getAdminService } from "../../../../lib/admin-service";
import { parseConfirmedMutation, requireAdminMutation, requireAdminSession, safeFailure } from "../../../../lib/admin-request";

export async function GET() {
  if (!(await requireAdminSession())) return safeFailure(401);
  try {
    return Response.json({ items: await (await getAdminService()).listCredentials() });
  } catch {
    return safeFailure();
  }
}

export async function POST(request: Request) {
  const session = await requireAdminMutation(request);
  const input = session ? await parseConfirmedMutation(request, "CREATE_CREDENTIAL") : null;
  if (!session) return safeFailure(401);
  if (!input) return safeFailure(422);
  try {
    const payload = input.payload;
    const instructionSetId = payload.instructionSetId;
    const operatorLabel = payload.operatorLabel;
    const termsVersion = payload.termsVersion;
    const rateLimitPerDay = payload.rateLimitPerDay;
    const rateLimitPerMinute = payload.rateLimitPerMinute;
    if (
      typeof instructionSetId !== "string" || instructionSetId.length > 64 ||
      typeof operatorLabel !== "string" || operatorLabel.trim().length === 0 || operatorLabel.length > 120 ||
      typeof termsVersion !== "string" || termsVersion.trim().length === 0 || termsVersion.length > 120 ||
      typeof rateLimitPerDay !== "number" || !Number.isInteger(rateLimitPerDay) || rateLimitPerDay < 1 || rateLimitPerDay > 10_000 ||
      typeof rateLimitPerMinute !== "number" || !Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute < 1 || rateLimitPerMinute > 1_000
    ) {
      return safeFailure(422);
    }
    const created = await (await getAdminService()).createCredential({
      instructionSetId,
      operatorLabel: operatorLabel.trim(),
      rateLimitPerDay,
      rateLimitPerMinute,
      termsAcceptedAt: new Date(),
      termsVersion: termsVersion.trim(),
    });
    return Response.json(created, { status: 201 });
  } catch {
    return safeFailure();
  }
}
