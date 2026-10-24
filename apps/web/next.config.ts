import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../..');

// Share the monorepo-root .env with the API.
loadEnvConfig(repoRoot);

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image; tracing from the repo root picks up @cowork/shared.
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  transpilePackages: ['@cowork/shared'],
  // Compression would buffer streamed responses; the ingress/router handle it.
  compress: false,
};

export default nextConfig;
