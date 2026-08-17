import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `next dev` and `next start` share .next by default, so starting the dev server
  // overwrites a running production build — the app keeps serving HTML that points at
  // chunk files which no longer exist. Giving dev its own directory makes the two
  // safe to run side by side.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  serverExternalPackages: ['@react-pdf/renderer', '@electric-sql/pglite', 'xlsx', 'postgres'],
  typedRoutes: false,
};

export default nextConfig;
