"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useChat } from "@/context/ChatProvider";
import { useActions } from "../../useActions";

export function Edit({ index, initial, onClose }: { index: number; initial: string; onClose: () => void }) {
  const { isLoading } = useChat();
  const [text, setText] = useState(initial);
  const { saveEdit } = useActions();
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const a = area.current;
    if (!a) return;
    a.focus();
    a.setSelectionRange(a.value.length, a.value.length);
  }, []);
  useLayoutEffect(() => {
    const a = area.current;
    if (!a) return;
    a.style.height = "auto";
    a.style.height = `${Math.min(a.scrollHeight, 360)}px`;
  }, [text]);
  // cancelled, the focus goes back to the Edit button this box replaced
  const cancel = () => {
    const art = area.current?.closest("article");
    onClose();
    requestAnimationFrame(() => art?.querySelector<HTMLElement>('.rd-tool[aria-label="Edit"]')?.focus());
  };
  const send = () => {
    if (!text.trim() || isLoading) return;
    void saveEdit(index, text, onClose);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".island textarea")?.focus());
  };
  return (
    <div className="rd-edit">
      <textarea
        ref={area}
        className="rd-edit-f"
        rows={1}
        value={text}
        spellCheck
        aria-label="Edit your message"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
      />
      <div className="rd-edit-rowwrap">
        <div className="rd-edit-row">
          <span className="rd-edit-hint">
            <kbd>Enter</kbd> sends a new version · <kbd>Esc</kbd> cancels
          </span>
          <span className="rd-edit-acts">
            <button type="button" className="rd-btn" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="rd-btn rd-btn-prime" onClick={send} disabled={!text.trim() || isLoading}>
              Send
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
