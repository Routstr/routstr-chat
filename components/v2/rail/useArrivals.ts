import { useEffect, useRef, useState, type RefObject } from "react";
import type { Conversation } from "@/types/chat";
import { reduced } from "./helpers";

export function useArrivals({
  list,
  finding,
  conversations,
  conversationsLoaded,
  isAuthenticated,
}: {
  list: RefObject<HTMLElement | null>;
  finding: boolean;
  conversations: Conversation[];
  conversationsLoaded: boolean;
  isAuthenticated: boolean;
}) {
  const seen = useRef<Set<string> | null>(null);
  const [arriving, setArriving] = useState<Set<string>>(new Set());
  const [titled, setTitled] = useState<Set<string>>(new Set());
  const [arrivingList, setArrivingList] = useState(false);
  const wasFinding = useRef(finding);
  useEffect(() => {
    if (wasFinding.current && !finding && conversations.length && !reduced()) {
      setArrivingList(true);
      const t = window.setTimeout(() => setArrivingList(false), 900);
      wasFinding.current = finding;
      return () => window.clearTimeout(t);
    }
    wasFinding.current = finding;
  }, [finding, conversations.length]);
  useEffect(() => {
    if (!conversationsLoaded && isAuthenticated) return;
    if (!seen.current) {
      seen.current = new Set(conversations.map((c) => c.id));
      return;
    }
    const fresh = conversations.filter((c) => !seen.current!.has(c.id)).map((c) => c.id);
    conversations.forEach((c) => seen.current!.add(c.id));
    if (!fresh.length || reduced()) return;
    setArriving(new Set(fresh));
    setTitled(new Set(fresh));
    list.current?.scrollTo({ top: 0, behavior: "smooth" });
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setArriving(new Set())));
    const t = window.setTimeout(() => setTitled(new Set()), 700);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [conversations, conversationsLoaded, isAuthenticated]);
  return { arriving, titled, arrivingList };
}
