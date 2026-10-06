"use client";

import { hostOf } from "../links";
import type { Source } from "./cite";

export function Sources({ sources }: { sources: Source[] }) {
  return (
    <>
      <section className="rd-sources" aria-label="Sources">
        <h4 className="rd-sources-t">Sources</h4>
        <ol>
          {sources.map((s, i) => (
            <li className="rd-src" data-n={i + 1} key={s.url}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                <span className="n">{i + 1}</span>
                <span className="t">{s.title || hostOf(s.url)}</span>
                {s.title && s.title !== hostOf(s.url) && <span className="h">{hostOf(s.url)}</span>}
              </a>
            </li>
          ))}
        </ol>
      </section>
      <div className="rd-notes">
        {sources.map((s, i) => {
          const host = hostOf(s.url);
          const title = s.title && s.title !== host ? s.title : "";
          return (
            <a
              key={s.url}
              className="rd-note"
              data-n={i + 1}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Source ${i + 1}: ${title || host}, ${host}`}
            >
              <span className="rd-note-n">{i + 1}</span>
              <span className="rd-note-h">{host}</span>
              <span className="rd-note-t">{title}</span>
            </a>
          );
        })}
      </div>
    </>
  );
}
