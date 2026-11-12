"use client";

import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { PrismLight as Prism } from "react-syntax-highlighter";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import php from "react-syntax-highlighter/dist/esm/languages/prism/php";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import swift from "react-syntax-highlighter/dist/esm/languages/prism/swift";
import toml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import { downloadImageFromSrc } from "@/utils/download";
import { Icon } from "../icons";
import { edgeFades } from "./Prose";
import { PageBox, PageViewer } from "./Page";
import { pageDoc, pageFile, pageKind } from "./pageDoc";

const LANGS: Record<string, unknown> = {
  bash, sh: bash, shell: bash, zsh: bash, c, cpp, "c++": cpp, csharp, cs: csharp, css, diff,
  go, java, javascript, js: javascript, json, jsx, kotlin, kt: kotlin, markdown, md: markdown,
  html: markup, xml: markup, markup, svg: markup, php, python, py: python, ruby, rb: ruby,
  rust, rs: rust, sql, swift, toml, tsx, typescript, ts: typescript, yaml, yml: yaml,
};
for (const [name, def] of Object.entries(LANGS)) Prism.registerLanguage(name, def);

// Copy feedback survives the remounts a streaming answer causes.
const copiedAt = new Map<string, number>();

function Pre({ label, ...props }: React.HTMLAttributes<HTMLPreElement> & { label: string }) {
  return <pre {...props} className="rd-pre scroll" tabIndex={0} aria-label={`${label} code`} style={undefined} />;
}

/* A code block is a figure in the page: "python · 19 lines" in lower case,
   Copy that says Done in the same width, and Wrap only when a line overflows.
   Past 12 lines the numbers sit in their own gutter that does not scroll
   away; gutter and code share one line box. Colours come from the room.
   A whole html or svg block can be shown working in its place (Preview),
   then opened over the window or saved as a file. */
function Code({ lang, code, live = false, answering = false }: { lang: string; code: string; live?: boolean; answering?: boolean }) {
  const [done, setDone] = useState(() => Date.now() - (copiedAt.get(code) ?? 0) < 1500);
  const [wrap, setWrap] = useState(false);
  const [over, setOver] = useState(false);
  const [shown, setShown] = useState(false);
  const [full, setFull] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fig = useRef<HTMLElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const lines = useMemo(() => code.split("\n"), [code]);
  const indents = useMemo(() => lines.map((l) => /^ */.exec(l)?.[0].length ?? 0), [lines]);
  const nums = lines.length > 12;
  const name = (lang || "text").toLowerCase();
  const known = name in LANGS;
  // offered once the answer is in: the finished answer is drawn anew, which would close a preview
  const kind = live || answering ? null : pageKind(name);
  const preview = !!kind && shown;
  const doc = useMemo(() => (preview && kind ? pageDoc(kind, code) : ""), [preview, kind, code]);
  const label = kind === "svg" ? "Drawing from the answer" : "Page from the answer";
  const save = () => {
    // as bytes, not as a page: a browser that opened the file instead of saving it would run it as the app
    if (kind) void downloadImageFromSrc(new Blob([code], { type: "application/octet-stream" }), pageFile(kind, code));
  };

  // does a line run past the edge? Then Wrap is offered, and the edge fades.
  // Read by a ResizeObserver, which reports after the browser has laid the
  // page out (first when it starts watching, then on each width change), so
  // reading here never makes it lay out again. Not while lines still arrive.
  useEffect(() => {
    const pre = fig.current?.querySelector<HTMLElement>(".rd-pre");
    if (!pre || live) return;
    let w = -1;
    const ro = new ResizeObserver(() => {
      if (pre.clientWidth === w) return;
      w = pre.clientWidth;
      setOver(pre.scrollWidth - pre.clientWidth > 1);
      edgeFades(pre);
    });
    ro.observe(pre);
    return () => ro.disconnect();
  }, [code, wrap, live, preview]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      copiedAt.set(code, Date.now());
      setDone(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 1500);
    } catch {
      // clipboard refused; nothing to confirm
    }
  };

  return (
    <figure className="rd-code" ref={fig} data-nums={nums ? "" : "off"} data-wrap={wrap ? "on" : "off"} data-page={kind ? (preview ? "on" : "off") : undefined}>
      <figcaption className="rd-code-cap">
        <span className="rd-code-lang">
          {name}
          {nums && <span className="rd-code-n">{lines.length} lines</span>}
        </span>
        <span className="rd-code-acts">
          {kind && (
            <button type="button" className="rd-code-btn" aria-pressed={preview} onClick={() => setShown((s) => !s)}>
              <Icon name="eye" size={14} />
              <span>Preview</span>
            </button>
          )}
          {preview ? (
            <>
              <button type="button" className="rd-code-btn" onClick={() => setFull(true)} aria-label="Full screen" data-tip="Full screen">
                <Icon name="expand" size={14} />
              </button>
              <button type="button" className="rd-code-btn" onClick={save} aria-label={kind === "svg" ? "Save drawing" : "Save page"} data-tip="Save">
                <Icon name="download" size={14} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="rd-code-btn rd-code-wrap"
                aria-label="Wrap"
                aria-pressed={wrap}
                hidden={!(over || wrap)}
                onClick={() => setWrap((w) => !w)}
              >
                <Icon name="wrap" size={14} />
                <span>Wrap</span>
              </button>
              <button type="button" className="rd-code-btn" onClick={copy} aria-label="Copy code">
                <span className="rd-swap" data-on={done ? "" : undefined}>
                  <Icon name="copy" size={14} />
                  <Icon name="check" size={14} />
                </span>
                <span className="rd-swapw" data-on={done ? "" : undefined}>
                  <span>Copy</span>
                  <span>Done</span>
                </span>
              </button>
            </>
          )}
        </span>
      </figcaption>
      {preview ? (
        // one live copy of the page: over the window, the one in the thread rests
        full ? <div className="rd-page" aria-hidden="true" /> : <PageBox doc={doc} label={label} />
      ) : (
        <div className="rd-code-body">
          {nums && (
            <div className="rd-gutter" aria-hidden="true">
              {lines.map((_, i) => (
                <span key={i}>{i + 1}</span>
              ))}
            </div>
          )}
          {/* coloured once the block is whole; while it streams the lines show plain */}
          {known && !live ? (
            <Prism
              language={name}
              useInlineStyles={false}
              PreTag={Pre}
              label={name}
              wrapLines
              lineProps={(n: number) => ({ className: "ln", style: { "--i": indents[n - 1] ?? 0 } as React.CSSProperties })}
            >
              {code}
            </Prism>
          ) : (
            <Pre label={name}>
              <code>
                {lines.map((l, i) => (
                  <span key={i} className="ln" style={{ "--i": indents[i] } as React.CSSProperties}>
                    {l}
                    {"\n"}
                  </span>
                ))}
              </code>
            </Pre>
          )}
        </div>
      )}
      {full && preview && <PageViewer doc={doc} label={label} onSave={save} onClose={() => setFull(false)} />}
      <span className="sr" aria-live="polite">
        {done ? "Copied" : ""}
      </span>
    </figure>
  );
}

export default memo(Code);
