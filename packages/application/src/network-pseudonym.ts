import { createHmac } from "node:crypto";
import { isIP } from "node:net";

interface NetworkPseudonymDependencies {
  readonly hmacKey: Uint8Array;
}

const canonicalAddress = (address: string): string => {
  const version = isIP(address);
  if (version === 0) throw new Error("Invalid network address");
  if (version === 4) return new URL(`http://${address}`).hostname;
  return new URL(`http://[${address}]/`).hostname.slice(1, -1);
};

export class NetworkPseudonymService {
  readonly #hmacKey: Uint8Array;

  public constructor({ hmacKey }: NetworkPseudonymDependencies) {
    if (hmacKey.byteLength < 32) throw new Error("Network HMAC key must be 32 bytes.");
    this.#hmacKey = hmacKey;
  }

  public digest(address: string, at: Date): string {
    const day = at.toISOString().substring(0, 10);
    const canonical = canonicalAddress(address);
    return createHmac("sha256", this.#hmacKey)
      .update(`${day}\0${canonical}`, "utf8")
      .digest("hex");
  }
}
