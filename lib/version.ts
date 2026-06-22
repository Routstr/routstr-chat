import { version } from "@/package.json";

/**
 * Application version, sourced from package.json.
 * Importing the `version` field by name keeps the rest of package.json
 * out of the client bundle (tree-shaken by SWC/webpack).
 */
export const APP_VERSION: string = version;
