"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import CodeBlock from "./CodeBlock";
import "katex/dist/katex.min.css";
import { downloadImageFromSrc } from "../utils/download";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export default function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  return (
    <div
      className={`prose prose-invert max-w-none text-[1rem] leading-relaxed ${
        className || ""
      }`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
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
            <h1 className="text-2xl font-bold text-white mb-4 mt-6 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-semibold text-white mb-3 mt-5 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-medium text-white mb-2 mt-4 first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-base font-medium text-white mb-2 mt-3 first:mt-0">
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5 className="text-sm font-medium text-white mb-2 mt-3 first:mt-0">
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6 className="text-sm font-medium text-white/80 mb-2 mt-3 first:mt-0">
              {children}
            </h6>
          ),

          // Paragraphs
          p: ({ children }) => (
            <p className="text-white/90 mb-4 leading-relaxed last:mb-0">
              {children}
            </p>
          ),

          // Lists
          ul: ({ children }) => (
            <ul className="list-disc ml-4 mb-4 space-y-1 text-white/90 [&>li]:pl-1">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal ml-4 mb-4 space-y-1 text-white/90 [&>li]:pl-1">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-white/90 leading-relaxed">{children}</li>
          ),

          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
            >
              {children}
            </a>
          ),

          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-white/20 pl-4 py-2 mb-4 text-white/80 italic bg-white/5 rounded-r">
              {children}
            </blockquote>
          ),

          // Tables
          table: ({ children }) => (
            <div className="overflow-x-auto mb-4">
              <table className="min-w-full border border-white/10 rounded-lg overflow-hidden">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-white/10">{children}</thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-white/10">{children}</tbody>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-white/5 transition-colors">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="px-4 py-2 text-left text-sm font-medium text-white border-b border-white/10">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-2 text-sm text-white/90">{children}</td>
          ),

          // Horizontal rule
          hr: () => <hr className="border-white/20 my-6" />,

          // Strong and emphasis
          strong: ({ children }) => (
            <strong className="font-semibold text-white">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-white/90">{children}</em>
          ),

          // Images with download button overlay
          img: ({ src, alt }) => (
            <div className="relative inline-block mb-4 group">
              <img
                src={src}
                alt={alt}
                className="max-w-full h-auto rounded-lg border border-white/10"
              />
              <button
                type="button"
                onClick={() => src && downloadImageFromSrc(src)}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 hover:bg-black/80 text-white text-xs rounded-md px-2 py-1 border border-white/20"
                aria-label="Download image"
              >
                Download
              </button>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
