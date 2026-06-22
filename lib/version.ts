/**
 * Application version, inlined into the build via `next.config.ts`
 * (`NEXT_PUBLIC_APP_VERSION` env var, sourced from package.json).
 * This keeps the rest of package.json out of the client bundle.
 */
export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION!;
