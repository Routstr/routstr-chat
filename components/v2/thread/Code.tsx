"use client";

import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { Icon } from "../icons";
import { edgeFades } from "./Prose";

const LANGS: Record<string, unknown> = {
  bash, sh: bash, shell: bash, zsh: bash, c, cpp, "c++": cpp, csharp, cs: csharp, css, diff,
  go, java, javascript, js: javascript, json, jsx, kotlin, kt: kotlin, markdown, md: markdown,
  html: markup, xml: markup, markup, svg: markup, php, python, py: python, ruby, rb: ruby,
  rust, rs: rust, sql, swift, toml, tsx, typescript, ts: typescript, yaml, yml: yaml,
};
for (const [name, def] of Object.entries(LANGS)) Prism.registerLanguage(name, def);

// Copy feedback survives the remounts a streaming answer causes.
const copiedAt = new Map<string, number>();

/* A code block is a figure in the page: "python · 19 lines" in lower case,
   Copy that says Done in the same width, and Wrap only when a line overflows.
   Past 12 lines the numbers sit in their own gutter that does not scroll
   away; gutter and code share one line box. Colours come from the room. */
function Code({ lang, code }: { lang: string; code: string }) {
  const [done, setDone] = useState(() => Date.now() - (copiedAt.get(code) ?? 0) < 1500);
  const [wrap, setWrap] = useState(false);
  const [over, setOver] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fig = useRef<HTMLElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const lines = useMemo(() => code.split("\n"), [code]);
  const indents = useMemo(() => lines.map((l) => /^ */.exec(l)?.[0].length ?? 0), [lines]);
  const nums = lines.length > 12;
  const name = (lang || "text").toLowerCase();
  const known = name in LANGS;

  // does a line run past the edge? Then Wrap is offered, and the edge fades
  useLayoutEffect(() => {
    const pre = fig.current?.querySelector<HTMLElement>(".rd-pre");
    if (!pre) return;
    const check = () => {
      setOver(pre.scrollWidth - pre.clientWidth > 1);
      edgeFades(pre);
    };
    check();
    let w = pre.clientWidth;
    const ro = new ResizeObserver(() => {
      if (pre.clientWidth === w) return;
      w = pre.clientWidth;
      check();
    });
    ro.observe(pre);
    return () => ro.disconnect();
  }, [code, wrap]);

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

  const Pre = useMemo(
    () =>
      function PreTag(props: React.HTMLAttributes<HTMLPreElement>) {
        return <pre {...props} className="rd-pre scroll" tabIndex={0} aria-label={`${name} code`} style={undefined} />;
      },
    [name]
  );

  return (
    <figure className="rd-code" ref={fig} data-nums={nums ? "" : "off"} data-wrap={wrap ? "on" : "off"}>
      <figcaption className="rd-code-cap">
        <span className="rd-code-lang">
          {name}
          {nums && <span className="rd-code-n">{lines.length} lines</span>}
        </span>
        <span className="rd-code-acts">
          <button
            type="button"
            className="rd-code-btn"
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
        </span>
      </figcaption>
      <div className="rd-code-body">
        {nums && (
          <div className="rd-gutter" aria-hidden="true">
            {lines.map((_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </div>
        )}
        {known ? (
          <Prism
            language={name}
            useInlineStyles={false}
            PreTag={Pre}
            wrapLines
            lineProps={(n: number) => ({ className: "ln", style: { "--i": indents[n - 1] ?? 0 } as React.CSSProperties })}
          >
            {code}
          </Prism>
        ) : (
          <Pre>
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
      <span className="sr" aria-live="polite">
        {done ? "Copied" : ""}
      </span>
    </figure>
  );
}

export default memo(Code);
