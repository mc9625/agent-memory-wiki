export const parseBase64UrlSecret = (name: string, encoded: string): Uint8Array => {
  if (encoded.startsWith("replace-with-")) {
    throw new Error(`${name} is still a public placeholder`);
  }
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.byteLength !== 32 || Buffer.from(bytes).toString("base64url") !== encoded) {
    throw new Error(`${name} must contain exactly 32 bytes encoded as canonical base64url`);
  }
  return new Uint8Array(bytes);
};
