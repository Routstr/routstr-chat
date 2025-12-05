import type { NextConfig } from "next";
import withPWA from "next-pwa";

const withPWACfg = withPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
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
      // TypeScript doesn't have Workbox types here; use any for config-time typing
      urlPattern: ({ request }: { request: any }) => request?.destination === "image",
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "images",
        expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
    {
      urlPattern: ({ url }: { url: any }) => url?.pathname?.startsWith("/api/"),
      handler: "NetworkFirst",
      method: "GET",
      options: {
        cacheName: "api",
        networkTimeoutSeconds: 10,
        expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
  ],
  fallbacks: {
    document: "/offline",
  },
});

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  // Add HMR configuration to prevent ping errors
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
  serverExternalPackages: [],
  // Silence Next 16 Turbopack + webpack plugin warning (next-pwa injects webpack config)
  // See: https://nextjs.org/docs/app/api-reference/next-config-js/turbopack
  turbopack: {},
};

export default withPWACfg(nextConfig);