/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@agent-memory-wiki/application",
    "@agent-memory-wiki/contracts",
    "@agent-memory-wiki/db",
    "@agent-memory-wiki/domain",
  ],
};

export default nextConfig;
