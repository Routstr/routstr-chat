import {
  OutputData,
  type OutputDataLike,
  type Proof,
  type SerializedBlindedMessage,
} from "@cashu/cashu-ts";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/*
 * Lightning payments move coins in up to two mint calls: a swap (when the
 * wallet cannot pay the exact amount) and then the melt. Each call is written
 * down here before it is sent, with its input proofs and the exact secrets of
 * the outputs it asks for. While an entry exists its inputs are out of the
 * wallet, so nothing else can spend them, and a lost answer, a crash or a
 * PENDING payment can always be settled later from what the mint says.
 *
 * localStorage is used because its writes are synchronous: the entry is on
 * disk before the request leaves.
 */

const PREFIX = "cashu_op_";

interface StoredOutput {
  blindedMessage: SerializedBlindedMessage;
  blindingFactor: string;
  secret: string;
}

interface Base {
  v: 1;
  id: string;
  mintUrl: string;
  keysetId: string;
  createdAt: number;
  inputs: Proof[];
}

export interface SwapEntry extends Base {
  kind: "swap";
  outputs: StoredOutput[];
}

export interface MeltEntry extends Base {
  kind: "melt";
  quoteId: string;
  /** NUT-08 blanks the mint fills with change */
  blanks: StoredOutput[];
}

type JournalEntry = SwapEntry | MeltEntry;

export const encodeOutputs = (outputs: OutputDataLike[] = []): StoredOutput[] =>
  outputs.map((o) => ({
    blindedMessage: o.blindedMessage,
    blindingFactor: o.blindingFactor.toString(16),
    secret: bytesToHex(o.secret),
  }));

export const decodeOutputs = (outputs: StoredOutput[]): OutputData[] =>
  outputs.map(
    (o) => new OutputData(o.blindedMessage, BigInt(`0x${o.blindingFactor}`), hexToBytes(o.secret))
  );

export function putEntry(entry: JournalEntry): void {
  // throws (quota, private mode) before anything is sent
  localStorage.setItem(PREFIX + entry.id, JSON.stringify(entry));
}

export function removeEntry(id: string): void {
  localStorage.removeItem(PREFIX + id);
}

export function listEntries(): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      out.push(JSON.parse(localStorage.getItem(key) ?? ""));
    } catch {
      // an unreadable entry is left in place for a person to look at
    }
  }
  return out;
}
