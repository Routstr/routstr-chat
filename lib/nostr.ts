import { nip19 } from "nostr-tools";

// Decode an nsec to get the private key
export const decodePrivateKey = (nsec: string): Uint8Array | null => {
  try {
    const { type, data } = nip19.decode(nsec);
    if (type !== "nsec") return null;
    return data as Uint8Array;
  } catch (error) {
    console.error("Error decoding nsec:", error);
    return null;
  }
};
