import { cookies } from "next/headers";

import { localSessionGate } from "./security/runtime";
import { validateMutationRequest } from "./security/request-guard";

const sessionCookie = "amw_local_session";

export const requireAdminMutation = async (
  request: Request,
): Promise<{ readonly csrfToken: string; readonly sessionId: string } | null> => {
  const sessionId = (await cookies()).get(sessionCookie)?.value;
  const session = sessionId ? localSessionGate.get(sessionId) : null;
  if (!session || !validateMutationRequest(request, session.csrfToken).ok) return null;
  return { csrfToken: session.csrfToken, sessionId: session.id };
};

export const requireAdminSession = async (): Promise<{ readonly csrfToken: string; readonly sessionId: string } | null> => {
  const sessionId = (await cookies()).get(sessionCookie)?.value;
  const session = sessionId ? localSessionGate.get(sessionId) : null;
  return session ? { csrfToken: session.csrfToken, sessionId: session.id } : null;
};

export const parseConfirmedMutation = async (
  request: Request,
  target: string,
): Promise<{ readonly enabled?: unknown; readonly payload: Readonly<Record<string, unknown>>; readonly reason: string } | null> => {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/json")) return null;
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const { confirmation, reason } = input as Record<string, unknown>;
    if (
      typeof confirmation !== "string" ||
      confirmation !== target ||
      typeof reason !== "string" ||
      reason.trim().length === 0 ||
      reason.length > 240
    ) {
      return null;
    }
    const payload = input as Record<string, unknown>;
    return { enabled: payload.enabled, payload, reason: reason.trim() };
  } catch {
    return null;
  }
};

export const safeFailure = (status = 503) => Response.json({ error: "Administrative operation unavailable." }, { status });
