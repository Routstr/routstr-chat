export type ProviderDirectoryEntry = {
  endpoint_url?: string | null;
  endpoint_urls?: string[] | null;
  onion_url?: string | null;
  onion_urls?: string[] | null;
  name?: string | null;
};

const TOR_ONION_SUFFIX = ".onion";
const TOR_MODE_STORAGE_KEY = "routstr_tor_mode";

/**
 * Detect if the current browser is Tor Browser by checking the user agent
 */
const isTorBrowser = (): boolean => {
  if (typeof window === "undefined") return false;
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.includes("tor");
};

/**
 * Get manual Tor mode preference from localStorage
 * Returns: true (force Tor), false (force non-Tor), or null (auto-detect)
 */
export const getTorModePreference = (): boolean | null => {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(TOR_MODE_STORAGE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
    return null;
  } catch {
    return null;
  }
};

/**
 * Set manual Tor mode preference in localStorage
 * Pass null to clear the preference and enable auto-detection
 */
export const setTorModePreference = (value: boolean | null): void => {
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      localStorage.removeItem(TOR_MODE_STORAGE_KEY);
    } else {
      localStorage.setItem(TOR_MODE_STORAGE_KEY, String(value));
    }
  } catch {
    // Silently fail if localStorage is not available
  }
};

/**
 * Determine if we're in a Tor context
 * Checks in order:
 * 1. Manual override from localStorage
 * 2. .onion hostname check
 * 3. Tor Browser detection via user agent
 */
export const isTorContext = (): boolean => {
  if (typeof window === "undefined") return false;

  // Check manual override first
  const manualOverride = getTorModePreference();
  if (manualOverride !== null) {
    return manualOverride;
  }

  // Check if accessed via .onion address
  const hostname = window.location.hostname.toLowerCase();
  if (hostname.endsWith(TOR_ONION_SUFFIX)) {
    return true;
  }

  // Auto-detect Tor Browser
  return isTorBrowser();
};

export const isOnionUrl = (url: string): boolean => {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  if (!trimmed) return false;
  try {
    const candidate = trimmed.startsWith("http") ? trimmed : `http://${trimmed}`;
    return new URL(candidate).hostname.endsWith(TOR_ONION_SUFFIX);
  } catch {
    return trimmed.includes(TOR_ONION_SUFFIX);
  }
};

const shouldAllowHttp = (url: string, torMode: boolean): boolean => {
  if (!url.startsWith("http://")) return true;
  if (url.includes("localhost") || url.includes("127.0.0.1")) return true;
  return torMode && isOnionUrl(url);
};

export const normalizeProviderUrl = (
  url?: string | null,
  torMode: boolean = false
): string | null => {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  }
  const useHttpForOnion = torMode && isOnionUrl(trimmed);
  const withProto = `${useHttpForOnion ? "http" : "https"}://${trimmed}`;
  return withProto.endsWith("/") ? withProto : `${withProto}/`;
};

const dedupePreserveOrder = (urls: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
};

export const getProviderEndpoints = (
  provider: ProviderDirectoryEntry,
  torMode: boolean
): string[] => {
  const rawUrls: (string | null | undefined)[] = [
    provider.endpoint_url,
    ...(Array.isArray(provider.endpoint_urls) ? provider.endpoint_urls : []),
    provider.onion_url,
    ...(Array.isArray(provider.onion_urls) ? provider.onion_urls : []),
  ];

  const normalized = rawUrls
    .map((value) => normalizeProviderUrl(value, torMode))
    .filter((value): value is string => Boolean(value));

  const unique = dedupePreserveOrder(normalized).filter((value) =>
    shouldAllowHttp(value, torMode)
  );

  if (unique.length === 0) return [];

  const onion = unique.filter((value) => isOnionUrl(value));
  const clearnet = unique.filter((value) => !isOnionUrl(value));

  if (torMode) {
    return onion.length > 0 ? onion : clearnet;
  }

  return clearnet;
};

export const filterBaseUrlsForTor = (
  baseUrls: string[],
  torMode: boolean
): string[] => {
  if (!Array.isArray(baseUrls)) return [];

  const normalized = baseUrls
    .map((value) => normalizeProviderUrl(value, torMode))
    .filter((value): value is string => Boolean(value));

  const filtered = normalized.filter((value) =>
    torMode ? true : !isOnionUrl(value)
  );

  return dedupePreserveOrder(
    filtered.filter((value) => shouldAllowHttp(value, torMode))
  );
};
