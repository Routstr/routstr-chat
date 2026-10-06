"use client";

import React, { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import Code from "./Code";
import Picture, { RemotePicture } from "./Picture";
import { splitBlocks } from "./splitBlocks";
import { cleanUrl, safeHref, safeImageSrc, stripParensAroundLinks } from "./links";
import { rehypeWords } from "./words";

const REMARK = [remarkMath, remarkGfm];
const REHYPE = [rehypeKatex];

const text = (children: React.ReactNode): string =>
  React.Children.toArray(children)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : ""))
    .join("");

const COMPONENTS: Components = {
  pre: ({ children }) => {
    const child = React.Children.toArray(children)[0] as React.ReactElement<{
      className?: string;
      children?: React.ReactNode;
    }>;
    const lang = /language-([\w+#-]+)/.exec(child?.props?.className ?? "")?.[1] ?? "";
    return <Code lang={lang} code={text(child?.props?.children).replace(/\n$/, "")} />;
  },
  code: ({ children, className }) => <code className={className}>{children}</code>,
  a: ({ href, children }) => {
    const ok = safeHref(href);
    if (!ok) return <span className="dead-link">{children}</span>;
    const url = cleanUrl(ok);
    const label = text(children).trim();
    // a bare number is a citation: a quiet superscript that knows its source
    if (/^\d+$/.test(label)) {
      return (
        <a className="rd-cite" data-n={label} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Source ${label}`}>
          {label}
        </a>
      );
    }
    const shown = label.startsWith("http") ? cleanUrl(label) : children;
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {shown}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const ok = safeImageSrc(src);
    if (!ok) return null;
    return /^https?:/i.test(ok) ? <RemotePicture src={ok} alt={alt ?? ""} /> : <Picture src={ok} alt={alt ?? ""} />;
  },
  table: ({ children }) => (
    <div className="rd-table scroll" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
};

const Block = memo(function Block({ md }: { md: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS}>
      {md}
    </ReactMarkdown>
  );
});

/* Sideways scrollers (tables, wide maths) say which way there is more, with
   a fade on that edge. Numbers in a table line up on the right. */
const NUM = /^[\s~≈]*[-+]?[\d.,]+\s*(%|g|kg|ms|s|sats?)?\s*$/;
const watched = new WeakSet<Element>();
export function edgeFades(el: HTMLElement) {
  const set = () => {
    const over = el.scrollWidth - el.clientWidth > 1;
    el.toggleAttribute("data-over", over);
    // a table or code body is a tab stop only when there is more to scroll to
    if (el.matches(".rd-table, .rd-pre")) el.tabIndex = over ? 0 : -1;
    el.toggleAttribute("data-more-l", over && el.scrollLeft > 2);
    el.toggleAttribute("data-more-r", over && el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  };
  if (!watched.has(el)) {
    watched.add(el);
    el.addEventListener("scroll", set, { passive: true });
  }
  set();
}
function tableNums(wrap: HTMLElement) {
  const rows = Array.from(wrap.querySelectorAll("tbody tr"));
  const cols = rows[0]?.children.length ?? 0;
  for (let c = 0; c < cols; c++) {
    if (!rows.every((r) => NUM.test(r.children[c]?.textContent ?? ""))) continue;
    rows.forEach((r) => r.children[c]?.setAttribute("data-num", ""));
    wrap.querySelectorAll("thead th")[c]?.setAttribute("data-num", "");
  }
}

/* The block words are arriving in: each new word settles into ink once; the
   caret rides after the newest word and breathes when the model pauses. */
function LiveBlock({ md, from, idle, count }: { md: string; from: number; idle: boolean; count: { n: number } }) {
  const plugins = useMemo(() => [rehypeKatex, rehypeWords({ from, idle, count })], [from, idle, count]);
  return (
    <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={plugins} components={COMPONENTS}>
      {md}
    </ReactMarkdown>
  );
}

export default function Prose({ content, streaming, words, idle = false }: { content: string; streaming?: boolean; words?: boolean; idle?: boolean }) {
  const blocks = useMemo(() => splitBlocks(stripParensAroundLinks(content)), [content]);
  // how much of the last block was already shown, so only new words settle
  const seen = useRef({ block: -1, n: 0 });
  const count = useMemo(() => ({ n: 0 }), []);
  const lastIdx = blocks.length - 1;
  const from = seen.current.block === lastIdx ? seen.current.n : 0;
  useEffect(() => {
    if (words) seen.current = { block: lastIdx, n: count.n };
  });
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    el.querySelectorAll<HTMLElement>(".rd-table").forEach((t) => {
      tableNums(t);
      edgeFades(t);
    });
    el.querySelectorAll<HTMLElement>(".katex-display").forEach(edgeFades);
  }, [blocks]);
  return (
    <div className="md" ref={root} data-streaming={streaming ? "" : undefined}>
      {blocks.map((b, i) => (
        <div className="blk" key={i}>
          {words && i === lastIdx ? <LiveBlock md={b} from={from} idle={idle} count={count} /> : <Block md={b} />}
        </div>
      ))}
    </div>
  );
}
