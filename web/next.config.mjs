/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The pipeline workers run inside route handlers and use Node APIs (crypto for
  // agent-key encryption, ethers for signing), so they must not be bundled for edge.
  serverExternalPackages: ["ethers"],

  env: {
    // Surfaced in the UI so a judge can tell which build they are looking at.
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
