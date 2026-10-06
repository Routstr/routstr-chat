import { currentOwner, owned, setOwner } from "@/features/session/owned";
import { STORAGE_KEYS } from "@/utils/storageUtils";

type KeyValueStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

/** Everything stored under one name that belongs to one person. */
const NAMES = [
  "cashu",
  "cashu-history",
  "cashu-unclaimed-tokens",
  "lightning_invoices",
  STORAGE_KEYS.LOCAL_CASHU_TOKENS,
  STORAGE_KEYS.TRANSACTION_HISTORY,
  "sats_spent_by_event",
];
/** Proof backups, one key each: `<family>_<time>`. */
const FAMILIES = ["pending_send_proofs", "pending_receive_proofs"];

/** Makes `pubkey` the owner of every local store that belongs to one person. */
export function bindOwner(pubkey: string | null, storage: KeyValueStorage) {
  const first = currentOwner() === null;
  setOwner(pubkey);
  if (first && pubkey) adoptUnowned(pubkey, storage);
}

/** Before accounts had owners each store had one shared copy. The account
 *  that takes over from no account (at the first start after the update, or a
 *  guest's first key) takes it over too. */
function adoptUnowned(pubkey: string, storage: KeyValueStorage) {
  const moves = NAMES.map((name) => [name, owned(name, pubkey)]);
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    const family = FAMILIES.find((f) => key?.startsWith(`${f}_`));
    if (key && family) {
      moves.push([key, owned(family, pubkey) + key.slice(family.length)]);
    }
  }
  for (const [from, to] of moves) move(storage, from, to);
}

/** Copy, read back, and only then remove the old copy. An existing owned
 *  copy is never overwritten, and on any failure the old one stays. */
function move(storage: KeyValueStorage, from: string, to: string) {
  const value = storage.getItem(from);
  if (value === null || storage.getItem(to) !== null) return;
  try {
    storage.setItem(to, value);
    if (storage.getItem(to) === value) storage.removeItem(from);
  } catch (error) {
    console.error(`Could not move ${from} to its owner`, error);
  }
}
