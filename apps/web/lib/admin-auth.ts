import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createDatabase } from "@agent-memory-wiki/db";
import { PostgresAdminStore } from "@agent-memory-wiki/admin-cli";

export const getAdminSecret = (): string => {
  const secret = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET;
  if (!secret || secret.trim() === "") {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") {
      throw new Error("FATAL: ADMIN_PASSWORD or ADMIN_SECRET environment variable must be set in production.");
    }
    return "dev-local-admin-secret-key-not-for-prod";
  }
  return secret;
};

const getSignKey = (): Uint8Array => {
  const secret = process.env.CREDENTIAL_HASH_SECRET || getAdminSecret();
  return Buffer.from(createHmac("sha256", "session-sign-salt-v1").update(secret).digest());
};

export const verifyPassword = (password?: string | null): boolean => {
  if (!password || typeof password !== "string") return false;
  let expected: string;
  try {
    expected = getAdminSecret();
  } catch {
    return false; // Fail closed if secret is missing in production
  }
  if (!expected) return false;

  // Compare SHA-256 digests in constant time (always 32 bytes each) to prevent timing & length leak
  const inputHash = createHash("sha256").update(password).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(inputHash, expectedHash);
};

export const createSessionToken = (): string => {
  const payload = {
    admin: true,
    iat: Date.now(),
    exp: Date.now() + 24 * 60 * 60 * 1000, // 24-hour expiration
  };
  const jsonStr = JSON.stringify(payload);
  const base64Payload = Buffer.from(jsonStr, "utf8").toString("base64url");
  const signature = createHmac("sha256", getSignKey()).update(base64Payload).digest("base64url");
  return `${base64Payload}.${signature}`;
};

export const verifySessionToken = (token?: string | null): boolean => {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;
  const [base64Payload, signature] = token.split(".");
  if (!base64Payload || !signature) return false;

  let expectedSig: string;
  try {
    expectedSig = createHmac("sha256", getSignKey()).update(base64Payload).digest("base64url");
  } catch {
    return false;
  }

  const sigBuffer = Buffer.from(signature);
  const expBuffer = Buffer.from(expectedSig);
  if (sigBuffer.length !== expBuffer.length || !timingSafeEqual(sigBuffer, expBuffer)) {
    return false;
  }

  try {
    const jsonStr = Buffer.from(base64Payload, "base64url").toString("utf8");
    const data = JSON.parse(jsonStr) as { admin?: boolean; exp?: number };
    if (!data.admin || typeof data.exp !== "number") return false;
    return Date.now() < data.exp;
  } catch {
    return false;
  }
};

export const isAuthenticatedAdmin = async (request?: Request): Promise<boolean> => {
  if (request) {
    const authHeader = request.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const candidate = authHeader.slice(7).trim();

      // Check optional dedicated ADMIN_API_KEY if configured in environment
      const adminApiKey = process.env.ADMIN_API_KEY;
      if (adminApiKey && adminApiKey.trim() !== "") {
        const inputHash = createHash("sha256").update(candidate).digest();
        const expectedHash = createHash("sha256").update(adminApiKey).digest();
        if (timingSafeEqual(inputHash, expectedHash)) {
          return true;
        }
      }

      // Only accept cryptographically signed and unexpired session tokens
      return verifySessionToken(candidate);
    }
  }

  const cookieStore = await cookies();
  const token = cookieStore.get("amw_admin_session")?.value;
  return verifySessionToken(token);
};

let adminStoreInstance: PostgresAdminStore | undefined;

export const getAdminStore = (): PostgresAdminStore => {
  if (!adminStoreInstance) {
    const databaseUrl = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("Missing DATABASE_URL or ADMIN_DATABASE_URL");
    const database = createDatabase({ url: databaseUrl });
    adminStoreInstance = new PostgresAdminStore(database.db);
  }
  return adminStoreInstance;
};
