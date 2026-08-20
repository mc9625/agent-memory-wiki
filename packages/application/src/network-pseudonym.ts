import { createHmac } from "node:crypto";
import { isIP } from "node:net";

interface NetworkPseudonymDependencies {
  readonly dailyHmacKey: Uint8Array;
  readonly dailyKeyDate: string;
  readonly nextDailyHmacKey?: Uint8Array;
  readonly nextDailyKeyDate?: string;
}

const canonicalAddress = (address: string): string => {
  const version = isIP(address);
  if (version === 0) throw new Error("Invalid network address");
  if (version === 4) return new URL(`http://${address}`).hostname;
  return new URL(`http://[${address}]/`).hostname.slice(1, -1);
};

const utcDay = (value: string, label: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid UTC calendar date.`);
  }
  return date;
};

export class NetworkPseudonymService {
  readonly #dailyHmacKey: Uint8Array;
  readonly #dailyKeyDate: string;
  readonly #nextDailyHmacKey: Uint8Array | undefined;
  readonly #nextDailyKeyDate: string | undefined;

  public constructor({
    dailyHmacKey,
    dailyKeyDate,
    nextDailyHmacKey,
    nextDailyKeyDate,
  }: NetworkPseudonymDependencies) {
    if (dailyHmacKey.byteLength !== 32) {
      throw new Error("Daily network HMAC key must be exactly 32 bytes.");
    }
    const currentDay = utcDay(dailyKeyDate, "Daily network HMAC key date");
    if ((nextDailyHmacKey === undefined) !== (nextDailyKeyDate === undefined)) {
      throw new Error("Next daily network HMAC key and date must be configured together.");
    }
    if (nextDailyHmacKey && nextDailyHmacKey.byteLength !== 32) {
      throw new Error("Next daily network HMAC key must be exactly 32 bytes.");
    }
    if (nextDailyKeyDate) {
      const nextDay = utcDay(nextDailyKeyDate, "Next daily network HMAC key date");
      if (nextDay.getTime() !== currentDay.getTime() + 86_400_000) {
        throw new Error("Next daily network HMAC key date must immediately follow the current date.");
      }
    }
    this.#dailyHmacKey = dailyHmacKey;
    this.#dailyKeyDate = dailyKeyDate;
    this.#nextDailyHmacKey = nextDailyHmacKey;
    this.#nextDailyKeyDate = nextDailyKeyDate;
  }

  public digest(address: string, at: Date): string {
    const day = at.toISOString().substring(0, 10);
    const key = day === this.#dailyKeyDate
      ? this.#dailyHmacKey
      : day === this.#nextDailyKeyDate
        ? this.#nextDailyHmacKey
        : undefined;
    if (!key) {
      throw new Error("No network HMAC key is configured for the current UTC day.");
    }
    const canonical = canonicalAddress(address);
    return createHmac("sha256", key)
      .update(`${day}\0${canonical}`, "utf8")
      .digest("hex");
  }
}
