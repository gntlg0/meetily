/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native module — it must stay a real require() on the
  // server and never be bundled/traced into a client chunk.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
