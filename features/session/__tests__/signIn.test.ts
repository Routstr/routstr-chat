import { describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  ExtensionAccount,
  PrivateKeyAccount,
} from "applesauce-accounts/accounts";
import { NostrConnectSigner } from "applesauce-signers";
import { readSecret, secretOf, signerByCode } from "../signIn";

const sk = generateSecretKey();
const pk = getPublicKey(sk);

describe("readSecret", () => {
  it("takes an nsec or 64 hex characters, with spaces around", () => {
    expect(readSecret(` ${nip19.nsecEncode(sk)}\n`)).toEqual({ key: sk });
    expect(readSecret(bytesToHex(sk).toUpperCase())).toEqual({ key: sk });
  });

  it("says when the public key was pasted instead", () => {
    expect(readSecret(nip19.npubEncode(pk))).toEqual({ problem: "public" });
    expect(readSecret(nip19.nprofileEncode({ pubkey: pk }))).toEqual({
      problem: "public",
    });
  });

  it("rejects anything else, including a cut-off nsec", () => {
    expect(readSecret("")).toEqual({ problem: "invalid" });
    expect(readSecret(nip19.nsecEncode(sk).slice(0, -3))).toEqual({
      problem: "invalid",
    });
    expect(readSecret(nip19.noteEncode(pk))).toEqual({ problem: "invalid" });
  });
});

describe("secretOf", () => {
  it("gives back the nsec of a key kept in this browser, and nothing for other signers", () => {
    expect(secretOf(PrivateKeyAccount.fromKey(sk))).toBe(nip19.nsecEncode(sk));
    expect(secretOf(new ExtensionAccount(pk, {} as never))).toBeNull();
  });
});

describe("signerByCode", () => {
  // the app wires these to its relay pool; showing a code needs no relay
  NostrConnectSigner.subscriptionMethod = () =>
    ({ subscribe: () => ({ unsubscribe() {} }) }) as never;
  NostrConnectSigner.publishMethod = async () => {};

  it("shows a nostrconnect code for the given relay and app name", () => {
    const { uri } = signerByCode(["wss://relay.example"], "Routstr Chat");
    const url = new URL(uri);
    expect(url.protocol).toBe("nostrconnect:");
    expect(url.searchParams.get("relay")).toBe("wss://relay.example");
    expect(url.searchParams.get("name")).toBe("Routstr Chat");
  });
});
