"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NostrEvent } from "nostr-tools";
import { eventStore, relayPool } from "@/lib/applesauce-core";
import { useAppContext } from "@/hooks/useAppContext";

export type NostrProfile = {
  pubkey: string;
  name: string;
  picture?: string;
};

const PROFILE_RELAY_URLS = [
  "wss://relay.routstr.com",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://purplepag.es",
];

const isNostrEvent = (value: unknown): value is NostrEvent =>
  typeof value === "object" && value !== null && "id" in value;

const parseKind0ProfileEvent = (event: NostrEvent): NostrProfile => {
  const fallbackName = event.pubkey.slice(0, 12);

  try {
    const parsed = JSON.parse(event.content) as {
      name?: string;
      display_name?: string;
      picture?: string;
      nip05?: string;
    };

    const name =
      (typeof parsed.display_name === "string" && parsed.display_name.trim()) ||
      (typeof parsed.name === "string" && parsed.name.trim()) ||
      (typeof parsed.nip05 === "string" && parsed.nip05.trim()) ||
      fallbackName;

    const picture =
      typeof parsed.picture === "string" && parsed.picture.trim()
        ? parsed.picture.trim()
        : undefined;

    return {
      pubkey: event.pubkey,
      name,
      picture,
    };
  } catch {
    return {
      pubkey: event.pubkey,
      name: fallbackName,
    };
  }
};

const getLatestProfileEventsFromStore = (
  pubkeys: string[]
): Record<string, NostrEvent> => {
  if (pubkeys.length === 0) return {};

  const timeline = eventStore.getTimeline({
    kinds: [0],
    authors: pubkeys,
  });

  const latestByPubkey = new Map<string, NostrEvent>();
  for (const event of timeline) {
    if (!latestByPubkey.has(event.pubkey)) {
      latestByPubkey.set(event.pubkey, event);
    }
  }

  const profileEvents: Record<string, NostrEvent> = {};
  for (const [pubkey, event] of latestByPubkey.entries()) {
    profileEvents[pubkey] = event;
  }

  return profileEvents;
};

const mapProfileEventsToProfiles = (
  latestEvents: Record<string, NostrEvent>
): Record<string, NostrProfile> => {
  const profiles: Record<string, NostrProfile> = {};

  for (const [pubkey, event] of Object.entries(latestEvents)) {
    profiles[pubkey] = parseKind0ProfileEvent(event);
  }

  return profiles;
};

export function useNostrProfiles(pubkeys: string[]): Record<string, NostrProfile> {
  const { config } = useAppContext();
  const [profiles, setProfiles] = useState<Record<string, NostrProfile>>({});
  const latestEventsRef = useRef<Record<string, NostrEvent>>({});

  const normalizedPubkeys = useMemo(
    () =>
      Array.from(new Set(pubkeys.filter(Boolean).map((pubkey) => pubkey.trim()))).sort(),
    [pubkeys]
  );
  const pubkeysKey = normalizedPubkeys.join("|");
  const relayUrls = useMemo(
    () => Array.from(new Set([...PROFILE_RELAY_URLS, ...config.relayUrls])),
    [config.relayUrls]
  );

  useEffect(() => {
    if (normalizedPubkeys.length === 0) {
      latestEventsRef.current = {};
      setProfiles({});
      return;
    }

    const latestEvents = getLatestProfileEventsFromStore(normalizedPubkeys);
    latestEventsRef.current = latestEvents;
    setProfiles(mapProfileEventsToProfiles(latestEvents));
  }, [pubkeysKey, normalizedPubkeys]);

  useEffect(() => {
    if (normalizedPubkeys.length === 0 || relayUrls.length === 0) {
      return;
    }

    const subscription = relayPool.subscription(relayUrls, {
        kinds: [0],
        authors: normalizedPubkeys,
      })
      .subscribe({
        next: (value: unknown) => {
          if (value === "EOSE" || !isNostrEvent(value)) {
            return;
          }

          const current = latestEventsRef.current[value.pubkey];
          const shouldReplace =
            !current ||
            value.created_at > current.created_at ||
            (value.created_at === current.created_at && value.id !== current.id);

          eventStore.add(value);

          if (!shouldReplace) {
            return;
          }

          latestEventsRef.current = {
            ...latestEventsRef.current,
            [value.pubkey]: value,
          };

          const nextProfile = parseKind0ProfileEvent(value);
          setProfiles((currentProfiles) => {
            const existing = currentProfiles[value.pubkey];
            if (
              existing?.name === nextProfile.name &&
              existing?.picture === nextProfile.picture
            ) {
              return currentProfiles;
            }

            return {
              ...currentProfiles,
              [value.pubkey]: nextProfile,
            };
          });
        },
        error: (error) => {
          console.error("[useNostrProfiles] kind 0 subscription error:", error);
        },
      });

    return () => subscription.unsubscribe();
  }, [normalizedPubkeys, pubkeysKey, relayUrls]);

  return profiles;
}

export function useActiveNostrProfile(pubkey?: string | null): NostrProfile | null {
  const profiles = useNostrProfiles(pubkey ? [pubkey] : []);
  return pubkey ? profiles[pubkey] ?? null : null;
}
