import { getAdminService } from "../../../../lib/admin-service";
import { requireAdminSession, safeFailure } from "../../../../lib/admin-request";

export async function GET() {
  if (!(await requireAdminSession())) return safeFailure(401);
  try {
    const service = await getAdminService();
    const [credentials, settings] = await Promise.all([service.listCredentials(), service.getSettings()]);
    return Response.json({
      credentials: { active: credentials.filter((credential) => credential.status === "active").length, total: credentials.length },
      readOnly: settings?.readOnly ?? null,
      settingsVersion: settings?.settingsVersion ?? null,
    });
  } catch {
    return safeFailure();
  }
}
