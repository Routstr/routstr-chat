"use client";

import React, { useEffect, useState } from "react";
import type { MessageContent } from "@/types/chat";
import { useFiles, useFileSync } from "@/features/chat/view";
import { useHistoryKeys } from "@/features/history/view";
import Picture, { Thumb } from "./Picture";

// one object URL per stored image for the life of the page: the bytes stay
// out of script memory
const objectUrlOf = (dataUrl: string) => {
  const [head, data] = dataUrl.split(",", 2);
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: head.slice(5).replace(/;base64$/, "") }));
};
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
  const files = useFiles();
  const [{ on: blossomSyncEnabled }] = useFileSync();
  const pnsKeys = useHistoryKeys();

  useEffect(() => {
    if (url || !ref || !key || !files) return;
    const stop = new AbortController();
    void files.load(ref, stop.signal).then((found) => {
      if (stop.signal.aborted) return;
      if (found) {
        const u = objectUrlOf(found);
        cache.set(key, u);
        setUrl(u);
        return;
      }
      // keys not ready yet: try again when they are
      if (ref.blossomHash && blossomSyncEnabled && !pnsKeys) return;
      setFailed(true);
    });
    return () => stop.abort();
  }, [url, ref, key, files, blossomSyncEnabled, pnsKeys]);

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
