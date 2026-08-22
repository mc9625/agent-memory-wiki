import process from "node:process";

/** @type {import("next").NextConfig} */
const nextConfig = {
  agentRules: false,
  // Vercel traces functions itself; standalone remains the portable Docker artifact.
  ...(process.env.VERCEL === "1" ? {} : { output: "standalone" }),
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/articles/:slug.md",
        destination: "/api/v1/articles/:slug?format=markdown",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
          },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  transpilePackages: [
    "@agent-memory-wiki/application",
    "@agent-memory-wiki/contracts",
    "@agent-memory-wiki/db",
    "@agent-memory-wiki/domain",
  ],
};

export default nextConfig;
