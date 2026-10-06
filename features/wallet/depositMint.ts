import { normalizeMintUrl } from "@/features/book/mint";

/**
 * Where new money goes, so the provider about to be paid can take it. The
 * provider is paid from one mint, so the money joins the accepted mint that
 * already holds the most (the active one on a tie), else goes to the
 * provider's first accepted mint. A mint the person picked stays. With no
 * provider known yet (nothing accepted): the active mint, else the wallet's
 * first, else the default.
 */
export function depositMint({
  active,
  picked,
  known,
  balances,
  accepted,
  fallback,
}: {
  active?: string;
  /** the person chose the active mint themselves */
  picked: boolean;
  known: string[];
  balances: Record<string, number>;
  accepted: string[];
  fallback: string;
}): string {
  const takes = new Set(accepted.map(normalizeMintUrl));
  if (!takes.size) return active || known[0] || fallback;
  if (picked && active) return active;
  const candidates = [...(active ? [active] : []), ...known].filter((url) =>
    takes.has(normalizeMintUrl(url))
  );
  const best = candidates.reduce<string | undefined>(
    (most, url) =>
      most === undefined || (balances[url] ?? 0) > (balances[most] ?? 0)
        ? url
        : most,
    undefined
  );
  return best ?? accepted[0];
}
