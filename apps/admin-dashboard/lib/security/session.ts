import { randomBytes, timingSafeEqual } from "node:crypto";

const absoluteLifetimeMs = 60 * 60 * 1_000;
const idleLifetimeMs = 10 * 60 * 1_000;

export interface LocalSession {
  readonly csrfToken: string;
  readonly id: string;
}

interface StoredSession extends LocalSession {
  readonly createdAt: number;
  lastSeenAt: number;
}

const equal = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
};

const token = (): string => randomBytes(32).toString("base64url");

export const createLaunchGate = (launchCode: string, now: () => Date = () => new Date()) => {
  let available = true;
  const sessions = new Map<string, StoredSession>();

  const expired = (session: StoredSession, at: number): boolean =>
    at - session.createdAt > absoluteLifetimeMs || at - session.lastSeenAt > idleLifetimeMs;

  return {
    get(id: string): LocalSession | null {
      const session = sessions.get(id);
      const at = now().getTime();
      if (!session || expired(session, at)) {
        sessions.delete(id);
        return null;
      }
      session.lastSeenAt = at;
      return { csrfToken: session.csrfToken, id: session.id };
    },
    lock(id: string): void {
      sessions.delete(id);
    },
    unlock(submittedCode: string): LocalSession | null {
      if (!available || !equal(launchCode, submittedCode)) return null;
      available = false;
      const at = now().getTime();
      const session: StoredSession = { createdAt: at, csrfToken: token(), id: token(), lastSeenAt: at };
      sessions.set(session.id, session);
      return { csrfToken: session.csrfToken, id: session.id };
    },
  };
};
