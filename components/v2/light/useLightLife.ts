import { useEffect, useRef, useState } from "react";
import { useChat } from "@/context/ChatProvider";
import { useMoney } from "../useMoney";
import { isStopped } from "../thread/Trouble";
import type { LightPulse, LightState } from "./Light";

/** What the app is doing, as your light's state and its pulses (one ring each). */
export function useLightLife(): { state: LightState; pulse: LightPulse } {
  const { isLoading, inputMessage, messages, activeConversationId, getStreamingContentFor } = useChat();
  const money = useMoney();
  const streaming = isLoading ? getStreamingContentFor(activeConversationId) : "";
  const [after, setAfter] = useState<"done" | "error" | null>(null);
  const [online, setOnline] = useState(true);
  const [pulse, setPulse] = useState<LightPulse>(null);
  const n = useRef(0);
  const ring = (kind: NonNullable<LightPulse>["kind"]) => setPulse({ kind, n: ++n.current });

  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    on();
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);

  // a send rings once; when the reply ends the light settles (done) or dims (an error)
  const wasLoading = useRef(false);
  const endedAt = useRef(0);
  useEffect(() => {
    if (isLoading && !wasLoading.current) ring("send");
    if (!isLoading && wasLoading.current) {
      endedAt.current = Date.now();
      const last = messages[messages.length - 1];
      setAfter(last?.role === "system" && !isStopped(last) ? "error" : "done");
      const t = window.setTimeout(() => setAfter(null), 2000);
      wasLoading.current = isLoading;
      return () => window.clearTimeout(t);
    }
    wasLoading.current = isLoading;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // words arriving ring softly, at most one every 600 ms
  const lastWord = useRef(0);
  useEffect(() => {
    if (!streaming) return;
    const now = Date.now();
    if (now - lastWord.current < 600) return;
    lastWord.current = now;
    ring("word");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming.length]);

  // money landing rings gold; a reply's change coming back right after it ends does not, and
  // neither does the balance arriving as the wallet loads (the wallet card waits the same way)
  const settled = useRef(false);
  useEffect(() => {
    settled.current = false;
    if (money.loading) return;
    const t = window.setTimeout(() => (settled.current = true), 1500);
    return () => window.clearTimeout(t);
  }, [money.loading]);
  const lastTotal = useRef(money.total);
  useEffect(() => {
    const d = money.total - lastTotal.current;
    lastTotal.current = money.total;
    if (!settled.current || d < 1 || isLoading || Date.now() - endedAt.current < 15000) return;
    ring("gold");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [money.total]);

  const state: LightState = !online
    ? "offline"
    : isLoading
      ? streaming
        ? "stream"
        : "waiting"
      : after ?? (inputMessage.trim() ? "typing" : "idle");
  return { state, pulse };
}
