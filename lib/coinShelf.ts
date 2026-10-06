/*
 * Some coins live only in localStorage while they are on their way: Lightning
 * journal entries (`cashu_op_<id>`) and the send and receive backups
 * (`pending_send_proofs_<time>`, `pending_receive_proofs_<time>`). Sign out
 * wipes this device's storage, so first those keys move to a shelf named after
 * the account (`<family>:<pubkey>_<rest>`), where the wallet code does not
 * look. When that account signs in again they move back and settle as before.
 */

const FAMILIES = ["cashu_op", "pending_send_proofs", "pending_receive_proofs"];

const storedKeys = () =>
  Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);

/** Writes the new copy before removing the old one, so the coins are never in
 *  zero places: a failed write (quota) throws and leaves the old copy. */
function move(from: string, to: string) {
  localStorage.setItem(to, localStorage.getItem(from)!);
  localStorage.removeItem(from);
}

/** Puts this account's coins that are still settling on its shelf. */
export function shelve(pubkey: string): void {
  for (const key of storedKeys()) {
    const family = FAMILIES.find((f) => key.startsWith(`${f}_`));
    if (family) move(key, `${family}:${pubkey}${key.slice(family.length)}`);
  }
}

/** Gives an account back the coins it left settling when it signed out. */
export function unshelve(pubkey: string): void {
  for (const key of storedKeys()) {
    const family = FAMILIES.find((f) => key.startsWith(`${f}:${pubkey}_`));
    if (family) move(key, family + key.slice(`${family}:${pubkey}`.length));
  }
}

/** Sign out's wipe: everything but the shelf. */
export function clearAllButShelf(): void {
  storedKeys()
    .filter((key) => !FAMILIES.some((f) => key.startsWith(`${f}:`)))
    .forEach((key) => localStorage.removeItem(key));
}
