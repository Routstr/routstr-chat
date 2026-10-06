"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../icons";

/** Copy with a check that answers in place; the live region says it once. */
function useCopied() {
  const [done, setDone] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      clearTimeout(t.current);
      t.current = setTimeout(() => setDone(false), 1400);
    } catch {
      // clipboard refused: nothing to confirm
    }
  }, []);
  return { done, copy };
}

export function CopyTool({ text, side }: { text: string; side?: "right" }) {
  const { done, copy } = useCopied();
  return (
    <>
      <button type="button" className="rd-tool" onClick={() => void copy(text)} aria-label="Copy" data-tip={done ? "Copied" : "Copy"} data-tip-side={side}>
        <span className="rd-swap" data-on={done ? "" : undefined}>
          <Icon name="copy" />
          <Icon name="check" />
        </span>
      </button>
      <span className="sr" aria-live="polite">
        {done ? "Copied" : ""}
      </span>
    </>
  );
}
