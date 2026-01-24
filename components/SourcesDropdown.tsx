"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

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

interface SourcesDropdownProps {
  citations?: string[];
  annotations?: import("@/types/chat").AnnotationData[];
}

export default function SourcesDropdown({
  citations,
  annotations,
}: SourcesDropdownProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasCitations = citations && citations.length > 0;
  const hasAnnotations = annotations && annotations.length > 0;

  if (!hasCitations && !hasAnnotations) {
    return null;
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>Sources</span>
        {isExpanded ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-3 pl-4 border-l-2 border-border">
          {hasCitations && (
            <div>
              <ol className="space-y-2">
                {citations.map((url, index) => {
                  const cleanedUrl = cleanUrl(url);
                  return (
                    <li key={`${url}-${index}`} className="flex items-start gap-2">
                      <span className="text-xs text-muted-foreground mt-0.5 min-w-[16px]">
                        {index + 1}.
                      </span>
                      <a
                        href={cleanedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline break-all flex-1"
                      >
                        {cleanedUrl}
                      </a>
                      <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {hasAnnotations && (
            <div>
              <ol className="space-y-2">
                {annotations.map((annotation, index) => {
                  const cleanedUrl = cleanUrl(annotation.url);
                  return (
                    <li
                      key={`${annotation.url}-${annotation.start_index}-${annotation.end_index}-${index}`}
                      className="flex items-start gap-2"
                    >
                      <span className="text-xs text-muted-foreground mt-0.5 min-w-[16px]">
                        {index + 1}.
                      </span>
                      <a
                        href={cleanedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline break-all flex-1"
                      >
                        {annotation.title || cleanedUrl}
                      </a>
                      <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
