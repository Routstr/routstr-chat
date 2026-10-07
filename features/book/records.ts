import {
  OutputData,
  type OutputDataLike,
  type Proof,
  type SerializedBlindedMessage,
} from "@cashu/cashu-ts";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/*
 * A record is money on its way somewhere: written before the mint call that
 * moves it, removed only by the code that settles it. The JSON is main's
 * Lightning journal entry plus `owner`, so entries main wrote read as they are.
 */

/** The exact outputs asked of a mint, kept so a lost answer can be restored (NUT-09). */
export interface SavedOutput {
  blindedMessage: SerializedBlindedMessage;
  blindingFactor: string;
  secret: string;
}

interface Base {
  v: 1;
  id: string;
  /** pubkey of the account that started it; main wrote none before owners existed */
  owner?: string;
  mintUrl: string;
  /** the unit of the mint keyset its proofs are in; main wrote none */
  unit?: string;
  createdAt: number;
}

/** A swap sent or about to be sent: its inputs and the outputs it asks for. */
export interface SwapRecord extends Base {
  kind: "swap";
  keysetId: string;
  inputs: Proof[];
  outputs: SavedOutput[];
  /** receiving a token: the inputs are the sender's, never ours to keep */
  incoming?: true;
}

/** A Lightning payment sent or about to be sent. */
export interface MeltRecord extends Base {
  kind: "melt";
  keysetId: string;
  quoteId: string;
  inputs: Proof[];
  /** NUT-08 blanks the mint fills with change */
  blanks: SavedOutput[];
}

/** A paid deposit being claimed (NUT-04): the outputs asked for its coins. */
export interface MintRecord extends Base {
  kind: "mint";
  keysetId: string;
  quoteId: string;
  /** in the keyset's unit */
  amount: number;
  outputs: SavedOutput[];
}

/** New proofs the mint gave us, held until the wallet has stored them. */
export interface LandedRecord extends Base {
  kind: "landed";
  proofs: Proof[];
}

/** A token that left the wallet and nobody has claimed yet. Its coins may be
 *  in someone's hands, so only the person reclaims or dismisses it. */
export interface TokenRecord extends Base {
  kind: "token";
  token: string;
  amount: number;
  unit: string;
}

export type BookRecord =
  | SwapRecord
  | MeltRecord
  | MintRecord
  | LandedRecord
  | TokenRecord;

export const saveOutputs = (outputs: OutputDataLike[] = []): SavedOutput[] =>
  outputs.map((o) => ({
    blindedMessage: o.blindedMessage,
    blindingFactor: o.blindingFactor.toString(16),
    secret: bytesToHex(o.secret),
  }));

export const loadOutputs = (saved: SavedOutput[]): OutputData[] =>
  saved.map(
    (o) =>
      new OutputData(
        o.blindedMessage,
        BigInt(`0x${o.blindingFactor}`),
        hexToBytes(o.secret)
      )
  );

export const amountOf = (proofs: Proof[]) =>
  proofs.reduce((sum, p) => sum + p.amount, 0);
