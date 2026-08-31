import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createDatabase } from "@agent-memory-wiki/db";
import { PostgresAdminStore } from "@agent-memory-wiki/admin-cli";

const getAdminSecret = (): string => {
  return (
    process.env.ADMIN_PASSWORD ||
    process.env.ADMIN_SECRET ||
    process.env.CREDENTIAL_HASH_SECRET ||
    "agent-memory-wiki-admin-secret-key-32b"
  );
};

const getSignKey = (): Uint8Array => {
  const secret = process.env.CREDENTIAL_HASH_SECRET || getAdminSecret();
  return Buffer.from(createHmac("sha256", "session-sign-salt").update(secret).digest());
};

export const verifyPassword = (password: string): boolean => {
  const expected = getAdminSecret();
  const inputBuffer = Buffer.from(password, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (inputBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(inputBuffer, expectedBuffer);
};

export const createSessionToken = (): string => {
  const payload = {
    admin: true,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const jsonStr = JSON.stringify(payload);
  const base64Payload = Buffer.from(jsonStr, "utf8").toString("base64url");
  const signature = createHmac("sha256", getSignKey()).update(base64Payload).digest("base64url");
  return `${base64Payload}.${signature}`;
};

export const verifySessionToken = (token?: string | null): boolean => {
  if (!token || !token.includes(".")) return false;
  const [base64Payload, signature] = token.split(".");
  if (!base64Payload || !signature) return false;

  const expectedSig = createHmac("sha256", getSignKey()).update(base64Payload).digest("base64url");
  if (signature !== expectedSig) return false;

  try {
    const jsonStr = Buffer.from(base64Payload, "base64url").toString("utf8");
    const data = JSON.parse(jsonStr) as { admin?: boolean; exp?: number };
    if (!data.admin || typeof data.exp !== "number") return false;
    return Date.now() < data.exp;
  } catch {
    return false;
  }
};

export const isAuthenticatedAdmin = async (): Promise<boolean> => {
  const cookieStore = await cookies();
  const token = cookieStore.get("amw_admin_session")?.value;
  return verifySessionToken(token);
};

let adminStoreInstance: PostgresAdminStore | undefined;

export const getAdminStore = (): PostgresAdminStore => {
  if (!adminStoreInstance) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("Missing DATABASE_URL");
    const database = createDatabase({ url: databaseUrl });
    adminStoreInstance = new PostgresAdminStore(database.db);
  }
  return adminStoreInstance;
};
