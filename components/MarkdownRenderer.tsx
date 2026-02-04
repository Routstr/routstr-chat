"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import CodeBlock from "./CodeBlock";
import "katex/dist/katex.min.css";
import { downloadImageFromSrc } from "../utils/download";
import { ExternalLink } from "lucide-react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const getSafeHref = (href?: string) => {
  if (!href) return null;
  if (href.startsWith("/") || href.startsWith("#")) return href;
  try {
    const url = new URL(href);
    if (["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) {
      return href;
    }
  } catch {}
  return null;
};

const stripParenthesesAroundLinks = (text: string): string => {
  // Remove ( ) around markdown links: ([text](url)) -> [text](url)
  return text.replace(/\(\[([^\]]+)\]\(([^)]+)\)\)/g, '[$1]($2)');
};

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'ref', 'source', 'from', 'via',
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid',
  'msclkid', 'twclkid', 'igshid', 'mc_cid', 'mc_eid',
  '_ga', '_gl', 'yclid', 'zanpid', 'spm', 'share_source',
]);

const cleanUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const params = new URLSearchParams(parsed.search);
    let modified = false;
    for (const key of [...params.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        params.delete(key);
        modified = true;
      }
    }
    if (modified) {
      parsed.search = params.toString();
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
};

const getSafeImageSrc = (src?: string | Blob) => {
  if (!src) return null;
  if (typeof src !== "string") return null;
  if (src.startsWith("/")) return src;
  try {
    const url = new URL(src);
    if (["http:", "https:", "data:", "blob:"].includes(url.protocol)) {
      return src;
    }
  } catch {}
  return null;
};

export default function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  return (
    <div
      className={`prose prose-neutral dark:prose-invert max-w-none text-[1rem] leading-loose ${
        className || ""
      }`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        children={stripParenthesesAroundLinks(content)}
        components={{
          // Code blocks and inline code
          code: ({ className, children, ...props }: any) => {
            const inline = !className;
            return (
              <CodeBlock className={className} inline={inline} {...props}>
                {String(children).replace(/\n$/, "")}
              </CodeBlock>
            );
          },

          // Headings
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold text-foreground mb-4 mt-6 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-semibold text-foreground mb-3 mt-5 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-medium text-foreground mb-2 mt-4 first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-base font-medium text-foreground mb-2 mt-3 first:mt-0">
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5 className="text-sm font-medium text-foreground mb-2 mt-3 first:mt-0">
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6 className="text-sm font-medium text-foreground/80 mb-2 mt-3 first:mt-0">
              {children}
            </h6>
          ),

          // Paragraphs
          p: ({ children }) => (
            <p className="text-foreground/90 mb-4 leading-loose last:mb-0">
              {children}
            </p>
          ),

          // Lists
          ul: ({ children }) => (
            <ul className="list-disc ml-4 mb-4 space-y-1 text-foreground/90 [&>li]:pl-1">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal ml-4 mb-4 space-y-1 text-foreground/90 [&>li]:pl-1">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-foreground/90 leading-loose">{children}</li>
          ),

          // Links
          a: ({ href, children }) => {
            const safeHref = getSafeHref(href);
            if (!safeHref) {
              return (
                <span className="text-blue-400 underline underline-offset-2">
                  {children}
                </span>
              );
            }
            const cleanedHref = cleanUrl(safeHref);
            const childText = typeof children === 'string' ? children : '';
            const isCitationNumber = /^\d+$/.test(childText.trim());

            if (isCitationNumber) {
              return (
                <a
                  href={cleanedHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 ml-0.5 align-super text-[0.65rem] font-medium rounded bg-slate-500/15 text-slate-400 hover:bg-slate-500/25 hover:text-slate-300 transition-colors no-underline border border-slate-500/20"
                  title={cleanedHref}
                >
                  {childText.trim()}
                  <ExternalLink className="h-2.5 w-2.5 ml-0.5 opacity-50" />
                </a>
              );
            }

            // Clean the display text if it's a URL
            let displayContent = children;
            if (typeof children === 'string' && children.startsWith('http')) {
              displayContent = cleanUrl(children);
            }
            return (
              <a
                href={cleanedHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-muted/50 text-foreground/60 hover:bg-muted hover:text-foreground/80 dark:bg-muted/40 dark:text-foreground/50 dark:hover:bg-muted/60 dark:hover:text-foreground/70 transition-colors no-underline break-all border border-border/30"
              >
                {displayContent}
                <ExternalLink className="h-3 w-3 shrink-0 opacity-40" />
              </a>
            );
          },

          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-border pl-4 py-2 mb-4 text-foreground/80 italic bg-muted/50 rounded-r">
              {children}
            </blockquote>
          ),

          // Tables
          table: ({ children }) => (
            <div
              className="overflow-x-auto mb-4 -mx-4 px-4 sm:mx-0 sm:px-0"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              <table className="min-w-full border border-border rounded-lg overflow-hidden">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted">{children}</thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-border">{children}</tbody>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-muted/50 transition-colors">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="px-4 py-2 text-left text-sm font-medium text-foreground border-b border-border">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-2 text-sm text-foreground/90">{children}</td>
          ),

          // Horizontal rule
          hr: () => <hr className="border-border my-6" />,

          // Strong and emphasis
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em className="italic text-foreground/90">{children}</em>
          ),

          // Images with download button overlay
          img: ({ src, alt }) => {
            const safeSrc = getSafeImageSrc(src);
            if (!safeSrc) return null;
            return (
              <div className="relative inline-block mb-4 group">
                <img
                  src={safeSrc}
                  alt={alt}
                  className="max-w-full h-auto rounded-lg border border-border"
                />
                <button
                  type="button"
                  onClick={() => downloadImageFromSrc(safeSrc)}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-card hover:bg-muted text-foreground text-xs rounded-md px-2 py-1 border border-border"
                  aria-label="Download image"
                >
                  Download
                </button>
              </div>
            );
          },
        }}
      />
    </div>
  );
}
