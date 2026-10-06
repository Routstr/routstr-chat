"use client";

import React, { useEffect, useState } from "react";
import type { MessageContent } from "@/types/chat";
import { getFile, saveFile } from "@/utils/indexedDb";
import { useBlossomSync } from "@/hooks/useBlossomSync";
import { useHistoryKeys } from "@/features/history/view";
import { storeStorageIdMapping } from "@/utils/storageUtils";
import Picture, { Thumb } from "./Picture";

// one object URL per stored image for the life of the page
const cache = new Map<string, string>();

/* A picture a model made, or one you attached. It may live inline, in this
   device's IndexedDB, or encrypted on Blossom (another device made it). The
   frame keeps its square until the pixels are in, then they develop. */
export default function StoredImage({
  item,
  caption,
  thumb,
}: {
  item: MessageContent;
  caption?: string;
  /** an enclosure under your words, not a picture in an answer */
  thumb?: boolean;
}) {
  const ref = item.image_url;
  const key = ref?.storageId || ref?.blossomHash || "";
  const [url, setUrl] = useState<string | undefined>(() => ref?.url || cache.get(key));
  const [failed, setFailed] = useState(false);
  const { fetchFromBlossom, blossomSyncEnabled } = useBlossomSync();
  const pnsKeys = useHistoryKeys();

  useEffect(() => {
    if (url || !ref || !key) return;
    let cancelled = false;
    (async () => {
      if (ref.storageId) {
        try {
          const file = await getFile(ref.storageId);
          if (file && !cancelled) {
            const u = URL.createObjectURL(file);
            cache.set(key, u);
            setUrl(u);
            return;
          }
        } catch {
          // fall through to Blossom
        }
      }
      if (ref.blossomHash && blossomSyncEnabled) {
        if (!pnsKeys) return; // keys not ready yet; try again when they are
        try {
          const res = await fetchFromBlossom(ref.blossomHash, pnsKeys, ref.blossomServers);
          if (res && !cancelled) {
            const blob = new Blob([new Uint8Array(res.data).buffer as ArrayBuffer], { type: res.mimeType });
            const u = URL.createObjectURL(blob);
            cache.set(key, u);
            setUrl(u);
            if (ref.storageId) {
              try {
                const id = await saveFile(new File([blob], "recovered-image", { type: res.mimeType }));
                storeStorageIdMapping(ref.storageId, id);
              } catch {
                // shown already; saving a local copy is a nicety
              }
            }
            return;
          }
        } catch {
          // reported below
        }
      }
      if (!cancelled) setFailed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [url, ref, key, blossomSyncEnabled, pnsKeys, fetchFromBlossom]);

  if (failed) {
    return (
      <div className="rd-doc rd-missing">
        <span className="rd-doc-ico" aria-hidden="true">
          <span>IMG</span>
        </span>
        <span className="rd-doc-txt">
          <span className="rd-doc-n">This picture is not on this device</span>
        </span>
      </div>
    );
  }

  if (!url) {
    return thumb ? (
      <span className="rd-thumb rd-thumb-wait" aria-hidden="true" />
    ) : (
      <div className="frame" aria-hidden="true">
        {caption && <span className="frame-t">{caption}</span>}
      </div>
    );
  }
  return thumb ? <Thumb src={url} alt={caption ?? "Attached picture"} /> : <Picture src={url} alt={caption ?? ""} />;
}
