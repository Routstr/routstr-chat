export type ProviderDirectoryEntry = {
  endpoint_url?: string | null;
  endpoint_urls?: string[] | null;
  onion_url?: string | null;
  onion_urls?: string[] | null;
  name?: string | null;
};

const TOR_ONION_SUFFIX = ".onion";
const TOR_MODE_STORAGE_KEY = "routstr_tor_mode_preference";

/**
 * Detect if the user is using Tor Browser based on userAgent.
 * Tor Browser modifies the userAgent to match Firefox ESR on Windows
 * to reduce fingerprinting, but we can detect common patterns.
 */
export const isTorBrowser = (): boolean => {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  
  const ua = navigator.userAgent.toLowerCase();
  
  // Tor Browser uses Firefox ESR and often has specific version patterns
  // It also blocks many fingerprinting APIs, which we can detect
  const isFirefox = ua.includes("firefox");
  
  if (!isFirefox) return false;
  
  // Check for Tor Browser-specific behaviors:
  // 1. Tor Browser spoofs timezone to UTC
  const timezoneOffset = new Date().getTimezoneOffset();
  const isUtcTimezone = timezoneOffset === 0;
  
  // 2. Tor Browser limits screen dimensions reporting
  const hasLimitedScreen = typeof window.screen !== "undefined" && 
    (window.screen.width === window.innerWidth || 
     window.outerWidth === window.innerWidth);
  
  // 3. Check for blocked/spoofed APIs common in Tor Browser
  let hasSpoofedApis = false;
  try {
    // Tor Browser returns empty or spoofed values for these
    const plugins = navigator.plugins;
    hasSpoofedApis = plugins.length === 0;
  } catch {
    hasSpoofedApis = true;
  }
  
  // Consider it Tor Browser if Firefox + multiple privacy indicators
  const privacyIndicators = [isUtcTimezone, hasLimitedScreen, hasSpoofedApis]
    .filter(Boolean).length;
  
  return privacyIndicators >= 2;
};

/**
 * Get the user's Tor mode preference from localStorage.
 * Returns: true (force Tor), false (force clearnet), null (auto-detect)
 */
export const getTorModePreference = (): boolean | null => {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return null;
  }
  
  try {
    const stored = localStorage.getItem(TOR_MODE_STORAGE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
    return null; // auto-detect
  } catch {
    return null;
  }
};

/**
 * Set the user's Tor mode preference.
 * @param preference - true (force Tor), false (force clearnet), null (auto-detect)
 */
export const setTorModePreference = (preference: boolean | null): void => {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return;
  }
  
  try {
    if (preference === null) {
      localStorage.removeItem(TOR_MODE_STORAGE_KEY);
    } else {
      localStorage.setItem(TOR_MODE_STORAGE_KEY, String(preference));
    }
  } catch {
    // localStorage may be unavailable in some contexts
  }
};

/**
 * Check if we're in a Tor context (should route to .onion endpoints).
 * 
 * Detection priority:
 * 1. User preference (if explicitly set)
 * 2. Frontend accessed via .onion URL
 * 3. Tor Browser detection
 */
export const isTorContext = (): boolean => {
  if (typeof window === "undefined") return false;
  
  // Check user preference first
  const preference = getTorModePreference();
  if (preference !== null) {
    return preference;
  }
  
  // Check if frontend is accessed via .onion
  const hostname = window.location.hostname.toLowerCase();
  if (hostname.endsWith(TOR_ONION_SUFFIX)) {
    return true;
  }
  
  // Check if using Tor Browser on clearnet frontend
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
