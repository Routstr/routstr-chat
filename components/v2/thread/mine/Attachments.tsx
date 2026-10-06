"use client";

import type { MessageContent } from "@/types/chat";
import StoredImage from "../StoredImage";
import type { Parsed } from "../content";

/** A long file name is cut in the middle: its end (year, .pdf) tells files apart. */
function DocName({ name }: { name: string }) {
  if (name.length <= 14)
    return (
      <span className="rd-doc-n" title={name}>
        {name}
      </span>
    );
  return (
    <span className="rd-doc-n" title={name}>
      <span className="rd-doc-h">{name.slice(0, -8)}</span>
      <span className="rd-doc-e">{name.slice(-8)}</span>
    </span>
  );
}
const sizeOf = (b?: number) => (!b ? "" : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function Attachments({ parsed }: { parsed: Parsed }) {
  return (
    <div className="rd-atts">
      {parsed.images.map((im: MessageContent, i) => (
        <StoredImage key={i} item={im} thumb />
      ))}
      {parsed.files.map((f, i) => {
        const name = f.file?.name || "Attachment";
        const kind = /pdf/i.test(f.file?.mimeType ?? name) ? "PDF" : (name.split(".").pop() || "file").toUpperCase().slice(0, 4);
        return (
          <div className="rd-doc" key={i}>
            <span className="rd-doc-ico" aria-hidden="true">
              <span>{kind}</span>
            </span>
            <span className="rd-doc-txt">
              <DocName name={name} />
              <span className="rd-doc-m">
                {kind}
                {f.file?.size ? ` · ${sizeOf(f.file.size)}` : ""}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
