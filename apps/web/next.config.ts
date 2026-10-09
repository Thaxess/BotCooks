import path from 'node:path';
import type { NextConfig } from 'next';

// Share the repository-root .env with the bot and worker (Next only reads apps/web/.env itself).
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env'));
} catch {
  /* no root .env: rely on the real environment */
}

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript sources.
  transpilePackages: [
    '@botcooks/ai',
    '@botcooks/database',
    '@botcooks/discord',
    '@botcooks/security',
    '@botcooks/services',
    '@botcooks/shared',
    '@botcooks/workflows',
  ],
  serverExternalPackages: ['pg', '@discordjs/rest'],
  turbopack: { root: path.resolve(import.meta.dirname, '../..') },
  output: 'standalone',
  outputFileTracingRoot: path.resolve(import.meta.dirname, '../..'),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
