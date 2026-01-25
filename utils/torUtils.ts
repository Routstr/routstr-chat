export type ProviderDirectoryEntry = {
  endpoint_url?: string | null;
  endpoint_urls?: string[] | null;
  onion_url?: string | null;
  onion_urls?: string[] | null;
  name?: string | null;
};

const TOR_ONION_SUFFIX = ".onion";

export const isTorContext = (): boolean => {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase();
  return hostname.endsWith(TOR_ONION_SUFFIX);
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
