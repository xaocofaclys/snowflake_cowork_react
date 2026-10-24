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
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      // pptxgenjs references Node built-ins (node:fs, node:https) for its Node mode; they're unused in the browser.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
          resource.request = resource.request.replace(/^node:/, '');
        }),
      );
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, https: false, http: false, path: false, os: false, stream: false, zlib: false, url: false };
    }
    return config;
  },
};

export default nextConfig;
