/**
 * Headers for a local operator console. The nonce is generated per response by
 * Next's Proxy and forwarded as `x-nonce`, so framework scripts can still run
 * without opening the policy to arbitrary inline script execution.
 */
export const buildSecurityHeaders = (nonce: string): Readonly<Record<string, string>> => ({
  "cache-control": "no-store",
  "content-security-policy": [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "connect-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; "),
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});
