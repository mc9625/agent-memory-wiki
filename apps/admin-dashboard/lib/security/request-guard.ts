import { timingSafeEqual } from "node:crypto";

import { isAllowedHost, LOCAL_DASHBOARD_HOST, LOCAL_DASHBOARD_PORT } from "../launcher";

const localOrigin = `http://${LOCAL_DASHBOARD_HOST}:${LOCAL_DASHBOARD_PORT}`;

const equal = (left: string | null, right: string): boolean => {
  if (!left) return false;
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
};

export const validateMutationRequest = (
  request: Request,
  csrfToken: string,
): { readonly ok: true } | { readonly ok: false } => {
  if (request.method !== "POST") return { ok: false };
  if (!isAllowedHost(request.headers.get("host") ?? undefined)) return { ok: false };
  if (request.headers.get("origin") !== localOrigin) return { ok: false };
  if (request.headers.get("sec-fetch-site") !== "same-origin") return { ok: false };
  if (!equal(request.headers.get("x-amw-csrf"), csrfToken)) return { ok: false };
  return { ok: true };
};
