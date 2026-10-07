import { getTokenMetadata, type Proof } from "@cashu/cashu-ts";
import { storedKeys, type Journal, type KeyValueStorage } from "./journal";
import { normalizeMintUrl } from "./mint";
import type { BookRecord } from "./records";

/*
 * What main left on this device, moved into the journal when its account
 * signs in. Main kept coins in motion in several places; each old key is read
 * here once and nowhere else. The new record is written before the old key is
 * removed, and a record's id comes from its old key, so a run cut short and
 * repeated writes the same record again instead of a second one.
 *
 * Main named what an account left settling at sign out `<family>:<pubkey>_…`,
 * and the session layer gives the plain keys of before accounts had owners to
 * the first account the same way, so every old key here names its account.
 * Main's live journal entries, `cashu_op_<id>`, carry no owner: the caller
 * says whether `owner` is main's account (`mains`), and only that account
 * takes them. Main can still be open in another tab and shares no lock with
 * v2, so an entry is taken only once any request it covers has long landed.
 */

const SHELF = "cashu_op";
const LIVE = "cashu_op_";
const UNCLAIMED = "cashu-unclaimed-tokens";
const RECEIVED = "pending_receive_proofs";
const SENT = "pending_send_proofs";
// the token main kept for each provider it paid by token (X-Cashu)
const PROVIDER = "local_cashu_tokens";
const MAIN_IN_FLIGHT_MS = 10 * 60_000;
// main's Lightning invoices, which v2 still lists, and the paid ones already
// turned into quote records (each is turned once)
const INVOICES = "lightning_invoices";
const ADOPTED = "cashu_invoices_adopted";

interface OldBackup {
  mintUrl?: string;
  normalizedMintUrl?: string;
  proofsToSend?: Proof[];
  timestamp?: number;
}

interface OldInvoice {
  type?: string;
  state?: string;
  quoteId: string;
  mintUrl: string;
  amount?: number;
  createdAt?: number;
}

interface OldToken {
  id: string;
  token: string;
  amount: number;
  unit: string;
  mintUrl: string;
  createdAt: number;
}

/** Moves what main left for `owner` into the journal under it; main's live
 *  entries only when `owner` is main's account (`mains`). */
export function adoptLegacy(
  owner: string,
  storage: KeyValueStorage,
  journal: Journal,
  mains: boolean
): void {
  for (const key of storedKeys(storage)) {
    const family = key.startsWith(LIVE)
      ? LIVE
      : [SHELF, UNCLAIMED, RECEIVED, SENT, PROVIDER].find((f) =>
          key.startsWith(`${f}:${owner}`)
        );
    const value = family && storage.getItem(key);
    if (!family || !value) continue;
    let records: BookRecord[];
    try {
      const saved = JSON.parse(value);
      const landed = Date.now() - saved.createdAt >= MAIN_IN_FLIGHT_MS;
      if (family === LIVE && !(mains && landed)) continue;
      records =
        family === SHELF || family === LIVE
          ? [{ ...saved, owner }]
          : family === UNCLAIMED
            ? tokensFrom(saved, owner)
            : family === PROVIDER
              ? providerTokens(key, saved, owner)
              : backupFrom(key, saved, owner);
    } catch {
      // unreadable: left in place for a person to look at
      continue;
    }
    records.forEach((record) => journal.put(record));
    storage.removeItem(key);
  }
  paidInvoices(owner, storage, journal);
}

/** Main's deposits that were paid and never claimed: a quote record each, so
 *  recovery claims them by itself (one claimed meanwhile is ISSUED, and
 *  dropped). The invoice list stays as it is. */
function paidInvoices(
  owner: string,
  storage: KeyValueStorage,
  journal: Journal
): void {
  let invoices: OldInvoice[];
  let done: string[];
  try {
    invoices = JSON.parse(
      storage.getItem(`${INVOICES}:${owner}`) ?? "{}"
    )?.invoices;
    done = JSON.parse(storage.getItem(`${ADOPTED}:${owner}`) ?? "[]");
  } catch {
    // unreadable: left in place for a person to look at
    return;
  }
  const paid = (Array.isArray(invoices) ? invoices : []).filter(
    (i) =>
      i?.type === "mint" &&
      i.state === "PAID" &&
      !!i.quoteId &&
      !!i.mintUrl &&
      !done.includes(i.quoteId)
  );
  if (!paid.length) return;
  paid.forEach((i) =>
    journal.put({
      v: 1,
      kind: "quote",
      id: `legacy-quote-${i.quoteId}`,
      owner,
      mintUrl: normalizeMintUrl(i.mintUrl),
      createdAt: i.createdAt ?? 0,
      quoteId: i.quoteId,
      // main's figure, in sats; the claim takes the mint's
      amount: i.amount ?? 0,
    })
  );
  storage.setItem(
    `${ADOPTED}:${owner}`,
    JSON.stringify([...done, ...paid.map((i) => i.quoteId)])
  );
}

function tokensFrom(
  saved: { state?: { unclaimedTokens?: OldToken[] } },
  owner: string
): BookRecord[] {
  return (saved?.state?.unclaimedTokens ?? []).map((t) => ({
    v: 1,
    kind: "token",
    id: `legacy-${t.id}`,
    owner,
    mintUrl: t.mintUrl,
    unit: t.unit,
    createdAt: t.createdAt,
    token: t.token,
    amount: t.amount,
  }));
}

/** The tokens main left with a provider's name: tokens the person made, so
 *  listed for them to take back (or keep as that provider's key), never
 *  returned by themselves. */
function providerTokens(
  key: string,
  saved: { baseUrl?: string; token?: string }[],
  owner: string
): BookRecord[] {
  return saved.flatMap(({ baseUrl, token }, i) => {
    if (!token) return [];
    const { mint, unit, amount } = getTokenMetadata(token);
    return [
      {
        v: 1 as const,
        kind: "token" as const,
        id: `legacy-${key}-${i}`,
        owner,
        mintUrl: normalizeMintUrl(mint),
        unit: unit ?? "sat",
        createdAt: 0,
        token,
        amount,
        baseUrl,
      },
    ];
  });
}

/** A send or receive backup: coins main had taken out of the wallet or just
 *  received, and never stored. Main removed a send's backup before the token
 *  was returned, so a backup that is left was never handed to anyone (at most
 *  to the SDK's own storage); recovery stores whichever coins are unspent. */
function backupFrom(key: string, old: OldBackup, owner: string): BookRecord[] {
  const mintUrl = old.mintUrl ?? old.normalizedMintUrl;
  const proofs = old.proofsToSend ?? [];
  if (!mintUrl || !proofs.length) return [];
  return [
    {
      v: 1,
      kind: "landed",
      id: `legacy-${key}`,
      owner,
      mintUrl,
      createdAt: old.timestamp ?? 0,
      proofs,
    },
  ];
}
