import { currentOwner } from "@/features/session/owned";
import { theBook } from "./purseBridge";

/** Whether this account (by default the active one) has money in the wallet
 *  book: a token not claimed yet, or a payment or receive still settling. */
export const holdsRecords = (owner = currentOwner()) =>
  !!owner && theBook().journal.list(owner).length > 0;

/** Removes an unclaimed token from the list (claimed by someone, or dismissed). */
export const dismissToken = (id: string) => theBook().journal.remove(id);
