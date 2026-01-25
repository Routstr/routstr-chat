"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import CodeBlock from "./CodeBlock";
import "katex/dist/katex.min.css";
import { downloadImageFromSrc } from "../utils/download";

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
            return (
              <a
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
              >
                {children}
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
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
