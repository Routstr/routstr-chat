"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Check, Loader2, Circle } from "lucide-react";
import MarkdownRenderer from "@/components/MarkdownRenderer";

const BrainIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    className={className}
  >
    <path
      d="M12 2a5 5 0 0 0-5 5v1a5 5 0 0 0-2 4v2a5 5 0 0 0 5 5h4a5 5 0 0 0 5-5v-2a5 5 0 0 0-2-4V7a5 5 0 0 0-5-5z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M9 12h6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 16h6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 8h6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const BulbIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className={className}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
    />
  </svg>
);

// Ephemeral in-memory cache for thought durations keyed by content fingerprint
const thoughtDurationCache = new Map<string, number>();
const fingerprintText = (text: string): string => {
  // Simple, fast fingerprint to survive remounts without localStorage
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  const head = text.slice(0, 64);
  const tail = text.slice(-32);
  return `${text.length}:${hash}:${head}:${tail}`;
};

interface ThinkingSectionProps {
  thinking?: string;
  thinkingContent?: string;
  isStreaming?: boolean;
}

interface ThinkingStep {
  title: string;
  body: string;
  isComplete: boolean;
  isFallback?: boolean; // Added to distinguish single blob fallback
}

const parseThinkingSteps = (text: string, isStreaming: boolean): ThinkingStep[] => {
  // Regex for titles:
  // 1. Explicit "Title: ..." or "### ..." at start of line
  // 2. Bold text "**...**" that looks like a header (preceded by newline or sentence ending)
  //    This handles cases like "...search!**Planning...**" where the model forgets spacing.
  const titleRegex = /(?:^|\n)(?:Title:\s*(.+?)|###\s+(.+?))(?:\n|$)|(?:^|\n|[.!?])\s*\*\*(.+?)\*\*/g;
  
  const matches = Array.from(text.matchAll(titleRegex));
  
  // If no titles found at all, fall back to simple chunking
  if (matches.length === 0) {
    // ... existing fallback logic ...
    const chunks = text.split(/\n\n+/).filter(chunk => chunk.trim());
    if (chunks.length <= 1) {
      return [{
        title: "Reasoning Process",
        body: text.trim(),
        isComplete: !isStreaming,
        isFallback: true
      }];
    }
    // ... chunks mapping ...
    const steps = chunks.map((chunk, index) => {
        const lines = chunk.trim().split('\n');
        let title = ""; 
        let body = chunk.trim();
        const firstLine = lines[0].trim();
        if (firstLine.length < 50 && (firstLine.startsWith('**') || firstLine.endsWith(':'))) {
            title = firstLine.replace(/\*\*/g, '').replace(/:$/, '');
            body = lines.slice(1).join('\n').trim();
        }
        return { title, body, isComplete: true };
    });
    // Adjust completion
    steps.forEach((step, i) => { step.isComplete = (i < steps.length - 1) || !isStreaming; });
    return steps;
  }

  const steps: ThinkingStep[] = [];
  let lastIndex = 0;

  matches.forEach((match, index) => {
    // Identify the content of the title
    // match[1] -> Title: ...
    // match[2] -> ### ...
    // match[3] -> **...**
    const titleText = (match[1] || match[2] || match[3])?.trim();
    
    // Ignore bold matches that are likely just emphasis (too short or just one word inside sentence?)
    // But our regex requires sentence boundary, so "I **love** it" is excluded (unless "I. **Love** it").
    if (!titleText) return;

    // Everything before this match (since last match) is the body of the PREVIOUS step
    // But we need to handle the start index carefully.
    // match.index is the start of the pattern.
    // The pattern might include the preceding punctuation/newline.
    // We want to slice up to the actual title start? 
    // No, we want to slice up to match.index, effectively leaving the punctuation with the previous step.
    
    // Correction: If the regex matched `! **Title**`, the `!` is part of the match.
    // We want `!` to stay in the previous body.
    // We can use a capturing group for the prefix?
    // Or just look at the full match[0].
    
    // Let's refine the regex to NOT consume the punctuation if possible (lookbehind not fully supported everywhere?)
    // Actually we can just manually adjust.
    
    let stepStart = match.index!;
    let titleContentStart = stepStart; // will adjust
    
    // Find where the actual title formatting starts
    const fullMatch = match[0];
    const boldStart = fullMatch.indexOf("**");
    const headerStart = fullMatch.search(/Title:|###/);
    
    if (boldStart !== -1) {
        // It's a bold title. 
        // The text before '**' within the match belongs to the previous step.
        titleContentStart = stepStart + boldStart;
    } else if (headerStart !== -1) {
        // It's a structured title.
        // The text before it (newline) belongs to separation.
        titleContentStart = stepStart + headerStart;
    }

    const prevBody = text.slice(lastIndex, titleContentStart).trim();
    
    if (steps.length > 0) {
        // Update the previous step's body to include everything up to this new title
        // But wait, we pushed the previous step when we found ITS title.
        // So we just need to finalize its body.
        steps[steps.length - 1].body = prevBody;
        steps[steps.length - 1].isComplete = true;
    } else if (prevBody) {
        // Text before the first title -> Initialization step
        steps.push({
            title: "Initialization",
            body: prevBody,
            isComplete: true
        });
    }

    // Now start the NEW step
    steps.push({
        title: titleText,
        body: "", // Body will be filled by the next iteration or at the end
        isComplete: false
    });

    // Update lastIndex to point to the end of this title match
    lastIndex = stepStart + fullMatch.length;
  });

  // Handle the remaining text after the last title
  const remainingText = text.slice(lastIndex).trim();
  if (steps.length > 0) {
      steps[steps.length - 1].body = remainingText;
      steps[steps.length - 1].isComplete = !isStreaming;
  } else if (remainingText) {
      // Should be covered by fallback check, but just in case
      steps.push({
          title: "Reasoning Process",
          body: remainingText,
          isComplete: !isStreaming,
          isFallback: true
      });
  }
  
  // Clean up: Remove steps with empty body AND complete? 
  // No, keep them as they might be milestones.
  // But strip "Body:" prefix if present
  steps.forEach(step => {
      if (step.body.match(/^\s*Body:\s*/i)) {
          step.body = step.body.replace(/^\s*Body:\s*/i, '').trim();
      }
  });

  return steps;
};

export default function ThinkingSection({
  thinking,
  thinkingContent,
  isStreaming = false,
}: ThinkingSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Determine content source
  const content = useMemo(() => {
    if (isStreaming && thinkingContent) return thinkingContent;
    if (!isStreaming && thinking) return thinking;
    return thinkingContent || thinking || "";
  }, [thinking, thinkingContent, isStreaming]);

  // Parse steps
  const steps = useMemo(() => {
    return parseThinkingSteps(content, isStreaming);
  }, [content, isStreaming]);

  // Track streaming duration
  const [startTime, setStartTime] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);

  useEffect(() => {
    if (isStreaming) {
      if (startTime === null) {
        setStartTime(Date.now());
        setDurationMs(null);
      }
    } else {
      if (startTime !== null && durationMs === null) {
        const finalMs = Date.now() - startTime;
        setDurationMs(finalMs);
        const key = fingerprintText(thinking || thinkingContent || "");
        if (key) {
          thoughtDurationCache.set(key, finalMs);
        }
      } else if (durationMs == null) {
        const key = fingerprintText(thinking || thinkingContent || "");
        if (key && thoughtDurationCache.has(key)) {
          setDurationMs(thoughtDurationCache.get(key)!);
        }
      }
    }
  }, [isStreaming, startTime, durationMs, thinking, thinkingContent]);

  const durationLabel = useMemo(() => {
    if (durationMs == null) return null;
    const seconds = durationMs / 1000;
    const value =
      seconds >= 10
        ? Math.round(seconds).toString()
        : seconds.toFixed(1).replace(/\.0$/, "");
    return `Thought for ${value}s`;
  }, [durationMs]);

  const activeStepRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom of the active step when streaming
  useEffect(() => {
    if (isStreaming && isExpanded && activeStepRef.current) {
      // Only scroll if we are near the bottom or it's a new step?
      // Actually simple auto-scroll for now
      // activeStepRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [content, isStreaming, isExpanded]);

  if (!thinking && !isStreaming && !thinkingContent) return null;

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
      >
        {isStreaming ? (
          <BrainIcon className="w-3 h-3" />
        ) : (
          <BulbIcon className="w-3 h-3" />
        )}
        <span>{isStreaming ? "Thinking..." : durationLabel || "Thought"}</span>
        <ChevronDown
          className={`w-3 h-3 transition-transform duration-200 ${
            isExpanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Collapsed state: Ghost text preview of the active step */}
      {!isExpanded && isStreaming && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="mt-2 pl-7 text-xs text-muted-foreground/60 overflow-hidden"
        >
          <div className="">
            {steps[steps.length - 1]?.body ? (
               steps[steps.length - 1].body
            ) : (
               <span className="animate-pulse">Thinking...</span>
            )}
          </div>
        </motion.div>
      )}

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="bg-muted/30 border border-border/50 rounded-xl p-4">
              <div className="flex flex-col relative">
                {/* Vertical connecting line background */}
                {!steps[0]?.isFallback && (
                  <div className="absolute left-[11px] top-2 bottom-4 w-[2px] bg-border/40 z-0" />
                )}
                
                {steps.map((step, index) => {
                  const isLast = index === steps.length - 1;
                  const isActive = !step.isComplete && isStreaming;
                  
                  if (step.isFallback) {
                    // Fallback rendering for unstructured content (single block)
                    return (
                        <div key="fallback" className="text-sm text-muted-foreground/90 overflow-hidden">
                            <MarkdownRenderer 
                                content={step.body} 
                                className="text-xs prose-sm dark:prose-invert max-w-none" 
                            />
                        </div>
                    );
                  }

                  return (
                    <div key={index} className="flex gap-3 mb-4 last:mb-0 relative z-10 group">
                      {/* Icon */}
                      <div className="shrink-0 mt-0.5">
                        <div
                          className={`
                            w-6 h-6 rounded-full flex items-center justify-center border-2 
                            ${step.isComplete 
                              ? "bg-muted border-border text-muted-foreground" 
                              : isActive
                                ? "bg-primary/10 border-primary text-primary"
                                : "bg-muted border-muted-foreground/30 text-muted-foreground"
                            }
                            transition-colors duration-300
                          `}
                        >
                          {step.isComplete ? (
                            <div className="w-1.5 h-1.5 rounded-full bg-foreground/60" />
                          ) : isActive ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Circle className="w-2 h-2 fill-current" />
                          )}
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {step.title && (
                          <h4 
                            className={`text-sm font-medium leading-6 ${
                              step.isComplete ? "text-muted-foreground" : "text-foreground"
                            }`}
                          >
                            {step.title}
                          </h4>
                        )}
                        
                        {/* Show body for all steps */}
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          className="mt-2 text-sm text-muted-foreground/90 overflow-hidden"
                          ref={isActive ? activeStepRef : null}
                        >
                          {step.body ? (
                            <MarkdownRenderer 
                              content={step.body} 
                              className="text-xs prose-sm dark:prose-invert max-w-none" 
                            />
                          ) : (
                            // Loading placeholder for empty body
                            <div className="flex items-center gap-1.5 h-6">
                              <span className="w-1 h-1 rounded-full bg-muted-foreground/40 animate-pulse" />
                              <span className="w-1 h-1 rounded-full bg-muted-foreground/40 animate-pulse delay-150" />
                              <span className="w-1 h-1 rounded-full bg-muted-foreground/40 animate-pulse delay-300" />
                            </div>
                          )}
                        </motion.div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
