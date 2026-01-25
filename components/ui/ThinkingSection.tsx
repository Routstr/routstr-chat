"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Loader2 } from "lucide-react";

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
  // 1. Explicit "Title: ..." or markdown headers "# ...", "## ...", "### ..." at start of line
  // 2. Bold text "**...**" that looks like a header (preceded by newline or sentence ending)
  const titleRegex = /(?:^|\n)(?:Title:\s*(.+?)|#{1,6}\s+(.+?))(?:\n|$)|(?:^|\n|[.!?])\s*\*\*(.+?)\*\*/g;
  
  const matches = Array.from(text.matchAll(titleRegex));
  
  // If no titles found at all, fall back to simple chunking
  if (matches.length === 0) {
    // If the text is short enough to be a single thought, just return it
    const chunks = text.split(/\n\n+/).filter(chunk => chunk.trim());
    if (chunks.length <= 1) {
      const content = text.trim();
      // Try to extract a title from the first sentence if it's not too long
      let title = "Reasoning Process";
      let body = content;
      
      const firstLine = content.split('\n')[0].trim();
      if (firstLine.length > 0 && firstLine.length < 80) {
          // If first line is short, use it as title
          title = firstLine.replace(/\*\*/g, '').replace(/:$/, '');
          // If there's more text, the rest is body. If not, body is same as title or empty?
          // Let's keep body as full text if it's just one line, or remove first line if multiple.
          if (content.indexOf('\n') !== -1) {
             body = content.slice(firstLine.length).trim();
          }
      } else {
          // Use first sentence or chunk as title
          const firstSentenceMatch = content.match(/^.*?[.!?](?:\s|$)/);
          if (firstSentenceMatch && firstSentenceMatch[0].length < 80) {
              title = firstSentenceMatch[0].trim().replace(/\*\*/g, '');
          } else {
              // Fallback to truncated text
              title = content.slice(0, 50).replace(/\n/g, ' ') + (content.length > 50 ? "..." : "");
          }
      }

      return [{
        title,
        body,
        isComplete: !isStreaming,
        isFallback: true
      }];
    }

    // Map chunks to steps
    const steps = chunks.map((chunk, index) => {
        const lines = chunk.trim().split('\n');
        let title = ""; 
        let body = chunk.trim();
        const firstLine = lines[0].trim();
        
        // Try to detect a header-like first line
        if (firstLine.length < 80 && (firstLine.startsWith('**') || firstLine.endsWith(':') || /^[A-Z][a-zA-Z0-9\s]+$/.test(firstLine))) {
            title = firstLine.replace(/\*\*/g, '').replace(/:$/, '');
            body = lines.slice(1).join('\n').trim();
        } else {
            // Fallback: Use first sentence or truncated text as title
            const firstSentenceMatch = chunk.match(/^.*?[.!?](?:\s|$)/);
            if (firstSentenceMatch && firstSentenceMatch[0].length < 80) {
                title = firstSentenceMatch[0].trim().replace(/\*\*/g, '');
                // We keep the body as is because we just extracted a title from the prose
            } else {
                title = chunk.slice(0, 50).replace(/\n/g, ' ') + (chunk.length > 50 ? "..." : "");
            }
        }
        
        // Ensure we always have a title
        if (!title) title = "Step " + (index + 1);

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
  
  // Clean up: Strip "Body:" prefix or leading colons if present
  steps.forEach(step => {
      let body = step.body.trim();
      
      // Remove "Body:" prefix if present
      if (body.match(/^Body:\s*/i)) {
          body = body.replace(/^Body:\s*/i, '');
      }
      
      // Remove leading colons which can happen if the model outputs "Title\n:\nContent"
      // or "**Title**\n:\nContent"
      if (body.match(/^\s*:\s*/)) {
          body = body.replace(/^\s*:\s*/, '');
      }

      step.body = body.trim();
  });

  return steps;
};

export default function ThinkingSection({
  thinking,
  thinkingContent,
  isStreaming = false,
}: ThinkingSectionProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  const toggleStep = (index: number) => {
    setExpandedSteps((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

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

  // Auto-expand new steps during streaming - REMOVED to allow auto-collapse of previous steps
  // useEffect(() => {
  //   if (isStreaming) {
  //     const activeIndex = steps.length - 1;
  //     setExpandedSteps(prev => {
  //       if (!prev.has(activeIndex)) {
  //           const newSet = new Set(prev);
  //           newSet.add(activeIndex);
  //           return newSet;
  //       }
  //       return prev;
  //     });
  //   }
  // }, [steps.length, isStreaming]);

  // Auto-scroll to the bottom of the active step when streaming
  useEffect(() => {
    const activeIndex = steps.length - 1;
    if (isStreaming && expandedSteps.has(activeIndex) && activeStepRef.current) {
      // Auto-scroll disabled for now as it can be jumpy
      // activeStepRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [content, isStreaming, expandedSteps, steps.length]);

  // Collapse all when streaming ends
  useEffect(() => {
    if (!isStreaming) {
      setExpandedSteps(new Set());
    }
  }, [isStreaming]);

  if (!thinking && !isStreaming && !thinkingContent) return null;

  const activeStepIndex = steps.length - 1;
  const containerClass = "py-2";

  // Completed State: Single "Thinking" group
  if (!isStreaming) {
      const isAllExpanded = expandedSteps.has(-1); // Use -1 for the main container toggle
      
      return (
        <div className="mb-4">
          <div className={containerClass}>
             <div className="flex gap-3 relative z-10 items-center">
                <div className="flex-1 min-w-0">
                    <button 
                        onClick={() => toggleStep(-1)}
                        className="flex items-center gap-1.5 w-full text-left cursor-pointer hover:opacity-80"
                    >
                        <h4 className="text-xs font-medium text-muted-foreground">
                            {durationLabel || "Thinking"}
                        </h4>
                        <ChevronDown
                             className={`w-3 h-3 text-muted-foreground transition-transform duration-200 ${
                               isAllExpanded ? "rotate-180" : ""
                             }`}
                        />
                    </button>
                    
                    <AnimatePresence>
                        {isAllExpanded && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                            >
                                <div className="mt-2 flex flex-col relative">
                                    {!steps[0]?.isFallback && (
                                        <div className="absolute left-[11.5px] top-[22px] bottom-[10px] w-px bg-border z-0" />
                                    )}
                                    <div className="pt-2 flex flex-col gap-2">
                                        {steps.map((step, index) => (
                                            <div key={index} className="flex gap-3 relative z-10 group items-start">
                                                <div className="shrink-0 mt-1.5 flex flex-col items-center">
                                                    <div className="w-6 h-3 flex items-center justify-center relative z-10 bg-background/50">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 group-hover:bg-muted-foreground/60 transition-colors" />
                                                    </div>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <button 
                                                        onClick={() => toggleStep(index)}
                                                        className="flex items-center gap-2 w-full text-left cursor-pointer hover:opacity-80 group/btn"
                                                    >
                                                        {step.title && (
                                                            <h4 className="text-sm text-muted-foreground group-hover/btn:text-foreground transition-colors">
                                                                {step.title}
                                                            </h4>
                                                        )}
                                                    </button>
                                                    <AnimatePresence>
                                                        {expandedSteps.has(index) && (
                                                            <motion.div
                                                                initial={{ height: 0, opacity: 0 }}
                                                                animate={{ height: "auto", opacity: 1 }}
                                                                exit={{ height: 0, opacity: 0 }}
                                                                className="mt-1 overflow-hidden pl-0"
                                                            >
                                                                {step.body && (
                                                                    <p className="text-xs text-muted-foreground/60 italic whitespace-pre-wrap leading-relaxed">
                                                                        {step.body}
                                                                    </p>
                                                                )}
                                                            </motion.div>
                                                        )}
                                                    </AnimatePresence>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
             </div>
          </div>
        </div>
      );
  }

  // Streaming View
  return (
    <div className="mb-4">
      <div className={containerClass}>
        <div className="flex flex-col relative">
          {/* Vertical connecting line background */}
          {!steps[0]?.isFallback && (
             <div className="absolute left-[11.5px] top-[12px] bottom-[8px] w-px bg-border z-0" />
          )}

          {/* All Steps */}
          {steps.map((step, index) => {
             const isActive = index === activeStepIndex;
             // Only auto-expand the active step, keep others collapsed unless manually opened
             const isExpanded = expandedSteps.has(index) || (isActive && isStreaming && !expandedSteps.has(index));
             
             return (
               <div key={index} className="flex gap-3 mb-3 last:mb-0 relative z-10 group items-start">
                  {/* Icon */}
                  <div className="shrink-0 mt-1">
                    <div className="w-6 h-4 flex items-center justify-center bg-background/50 backdrop-blur-[1px] rounded-full">
                        {isActive && isStreaming ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                        ) : (
                            <div className={`w-1.5 h-1.5 rounded-full ${step.isComplete ? "bg-muted-foreground/40" : "bg-primary"}`} />
                        )}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <button 
                       onClick={() => toggleStep(index)}
                       className="flex items-center gap-2 w-full text-left cursor-pointer hover:opacity-80"
                    >
                       {step.title ? (
                          <h4 className={`text-sm font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                            {step.title}
                          </h4>
                       ) : null}
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="mt-1 overflow-hidden"
                          ref={(isActive && isStreaming) ? activeStepRef : null}
                        >
                          {step.body ? (
                            <p className="text-xs text-muted-foreground/60 italic whitespace-pre-wrap leading-relaxed">
                              {step.body}
                            </p>
                          ) : (
                            <div className="flex items-center gap-1.5 h-6">
                              <span className="w-1 h-1 rounded-full bg-muted-foreground/40 animate-pulse" />
                              <span className="w-1 h-1 rounded-full bg-muted-foreground/40 animate-pulse delay-150" />
                              <span className="w-1 h-1 rounded-full bg-muted-foreground/40 animate-pulse delay-300" />
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
               </div>
             );
          })}
        </div>
      </div>
    </div>
  );
}
