import { useEffect, useRef, useState } from "react";
import { useChat } from "@/context/ChatProvider";
import { useAsking, useRun } from "@/features/chat/view";
import { useDraft } from "../ui";
import { useMoney } from "../useMoney";
import type { LightPulse, LightState } from "./Light";

/** What the app is doing, as your light's state and its pulses (one ring each). */
export function useLightLife(): { state: LightState; pulse: LightPulse } {
  const { activeConversationId } = useChat();
  const asking = useAsking(activeConversationId);
  const run = useRun(activeConversationId);
  const { text } = useDraft();
  const money = useMoney();
  const streaming = asking ? run?.text ?? "" : "";
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
    if (asking && !wasLoading.current) ring("send");
    if (!asking && wasLoading.current) {
      endedAt.current = Date.now();
      setAfter(run?.phase === "failed" ? "error" : "done");
      const t = window.setTimeout(() => setAfter(null), 2000);
      wasLoading.current = asking;
      return () => window.clearTimeout(t);
    }
    wasLoading.current = asking;
  }, [asking]);

  // words arriving ring softly, at most one every 600 ms
  const lastWord = useRef(0);
  useEffect(() => {
    if (!streaming) return;
    const now = Date.now();
    if (now - lastWord.current < 600) return;
    lastWord.current = now;
    ring("word");
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
    if (!settled.current || d < 1 || asking || Date.now() - endedAt.current < 15000) return;
    ring("gold");
  }, [money.total]);

  const state: LightState = !online
    ? "offline"
    : asking
      ? streaming
        ? "stream"
        : "waiting"
      : after ?? (text.trim() ? "typing" : "idle");
  return { state, pulse };
}
