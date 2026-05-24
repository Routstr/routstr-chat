import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const withPWACfg = withPWA({
  dest: "public",
  register: true,
  disable: process.env.NODE_ENV === "development",
  publicExcludes: ["!*.txt"],
  workboxOptions: {
    skipWaiting: true,
    // Exclude RSC payload files (.txt) from precaching
    exclude: [/\.txt$/],
    // Prevent navigation fallback for .txt files (RSC payloads)
    navigateFallbackDenylist: [/\.txt$/],
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "google-fonts",
          expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
        },
      },
      {
        urlPattern: ({ request }: { request: any }) =>
          request?.destination === "image",
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "images",
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
        },
      },
      {
        urlPattern: ({ url }: { url: any }) => url?.pathname?.startsWith("/api/"),
        handler: "NetworkFirst",
        options: {
          cacheName: "api",
          networkTimeoutSeconds: 10,
          expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
    ],
  },
  fallbacks: {
    document: "/offline",
  },
});

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ["better-sqlite3"],
  // Add HMR configuration to prevent ping errors
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }

    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        path: false,
        crypto: false,
      };

      config.module.rules.push(
        {
          test: /better-sqlite3|bindings|file-uri-to-path/,
          use: "null-loader",
        },
        {
          test: /bun:sqlite/,
          use: "null-loader",
        }
      );
    }

    return config;
  },
  // Silence Next 16 Turbopack + webpack plugin warning (next-pwa injects webpack config)
  // See: https://nextjs.org/docs/app/api-reference/next-config-js/turbopack
  turbopack: {},
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default withPWACfg(nextConfig);

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
