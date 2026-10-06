import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "../motion";

/* Networks deliver words in bursts. The page lets them out at an even pace:
   each frame reveals a share of the backlog (about a quarter second to catch
   up, whatever the burst), always ending on a word boundary. */
export function useSmoothText(target: string, live: boolean) {
  const reduce = useReducedMotion();
  const smooth = live && !reduce;
  const [shown, setShown] = useState(target);
  if (!smooth && shown !== target) setShown(target);
  // a new answer, or the words were held back: start again from nothing
  if (smooth && target.length < shown.length) setShown("");
  const len = useRef(target.length);
  const raf = useRef(0);
  const targetRef = useRef(target);
  useLayoutEffect(() => {
    targetRef.current = target;
  });

  useEffect(() => {
    if (!smooth) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      len.current = target.length;
      return;
    }
    if (target.length < len.current) len.current = 0;
    if (raf.current) return;
    const step = () => {
      const t = targetRef.current;
      const backlog = t.length - len.current;
      if (backlog <= 0) {
        raf.current = 0;
        return;
      }
      let next = len.current + Math.max(2, Math.ceil(backlog / 14));
      if (next < t.length) {
        const space = t.slice(next).search(/\s/);
        next = space === -1 ? t.length : Math.min(t.length, next + space);
      }
      len.current = next;
      setShown(t.slice(0, next));
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [target, smooth]);

  // a loop cancelled from outside must not look like one still running
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    []
  );
  return smooth ? shown : target;
}

/* Reasoning is only kept while it streams (the SDK stores text-only answers
   as plain strings). Remember it for this session, keyed by the answer it
   led to, so the reasoning stays with the answer after it lands. */
const memo = new Map<string, string>();
const keyOf = (answer: string) => answer.trim().slice(0, 120);
export const rememberThinking = (answer: string, text: string) => {
  if (answer.trim() && text.trim()) memo.set(keyOf(answer), text);
};
export const recallThinking = (answer: string) => memo.get(keyOf(answer));

/* Whether the reasoning was open when the live answer handed over (and had
   focus), so the stored answer keeps it as the reader left it. Read once. */
const opened = new Map<string, { focus: boolean }>();
export const rememberOpen = (answer: string, focus: boolean) => {
  if (answer.trim()) opened.set(keyOf(answer), { focus });
};
export const takeOpen = (answer: string) => {
  const k = keyOf(answer);
  const o = opened.get(k);
  opened.delete(k);
  return o;
};
