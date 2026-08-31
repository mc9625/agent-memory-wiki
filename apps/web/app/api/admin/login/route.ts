import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSessionToken, verifyPassword } from "../../../../lib/admin-auth";

// Rate limiting & lockout state for admin login (in-memory per serverless instance)
interface LoginAttemptRecord {
  failures: number;
  lockedUntil: number;
  firstAttempt: number;
}

const loginAttempts = new Map<string, LoginAttemptRecord>();
const MAX_FAILURES = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown-ip"
  );
}

function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record) {
    return { allowed: true };
  }

  // Check if currently locked out
  if (record.lockedUntil > now) {
    const retryAfterSeconds = Math.ceil((record.lockedUntil - now) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  // Reset if window has expired (older than 15 min)
  if (now - record.firstAttempt > LOCKOUT_DURATION_MS) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }

  return { allowed: true };
}

function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const record = loginAttempts.get(ip) || {
    failures: 0,
    lockedUntil: 0,
    firstAttempt: now,
  };

  record.failures += 1;
  if (record.failures >= MAX_FAILURES) {
    record.lockedUntil = now + LOCKOUT_DURATION_MS;
  }

  loginAttempts.set(ip, record);

  // Prune map size if necessary
  if (loginAttempts.size > 500) {
    loginAttempts.clear();
  }
}

function recordLoginSuccess(ip: string): void {
  loginAttempts.delete(ip);
}

export async function POST(request: Request) {
  const ip = getClientIp(request);

  // 1. Check rate limit / lockout
  const { allowed, retryAfterSeconds } = checkLoginRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many failed login attempts. Account temporarily locked. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds || 900),
        },
      }
    );
  }

  try {
    const body = await request.json();
    const { password } = body as { password?: string };

    if (!password || !verifyPassword(password)) {
      recordLoginFailure(ip);
      // Small artificial delay to defeat high-speed automated brute force
      await new Promise((resolve) => setTimeout(resolve, 300));

      return NextResponse.json(
        { error: "Invalid admin credentials" },
        { status: 401 }
      );
    }

    // 2. Successful verification
    recordLoginSuccess(ip);
    const token = createSessionToken();
    const cookieStore = await cookies();
    cookieStore.set("amw_admin_session", token, {
      httpOnly: true,
      secure: request.url.startsWith("https://") || request.headers.get("x-forwarded-proto") === "https",
      sameSite: "lax",
      maxAge: 24 * 60 * 60, // 24 hours
      path: "/",
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Bad request" },
      { status: 400 }
    );
  }
}
