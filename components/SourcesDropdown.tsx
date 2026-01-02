"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { cn } from "@/lib/utils";

interface SourcesDropdownProps {
  citations?: string[];
  annotations?: import("@/types/chat").AnnotationData[];
}

export default function SourcesDropdown({
  citations,
  annotations,
}: SourcesDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hasCitations = citations && citations.length > 0;
  const hasAnnotations = annotations && annotations.length > 0;

  if (!hasCitations && !hasAnnotations) {
    return null;
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-2"
        >
          <span>Sources</span>
          {isOpen ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-80 max-h-96 overflow-y-auto"
      >
        <div className="space-y-3">
          {hasCitations && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Citations</h4>
              <ol className="space-y-2">
                {citations.map((url, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground mt-0.5 min-w-[16px]">
                      {index + 1}.
                    </span>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline break-all flex-1"
                    >
                      {url}
                    </a>
                    <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                  </li>
                ))}
              </ol>
            </div>
          )}

          {hasAnnotations && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Annotations</h4>
              <ol className="space-y-2">
                {annotations.map((annotation, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground mt-0.5 min-w-[16px]">
                      {index + 1}.
                    </span>
                    <a
                      href={annotation.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline break-all flex-1"
                    >
                      {annotation.title || annotation.url}
                    </a>
                    <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
