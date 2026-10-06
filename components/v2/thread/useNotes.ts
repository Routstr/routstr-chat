import { useState } from "react";
import { useAccountChat, useRun, type RunSnapshot } from "@/features/chat/view";
import type { Message } from "@/types/chat";

type Run = { parentId?: string; getSnapshot(): RunSnapshot };
const NONE: Run[] = [];

/** What a request left to say once it ended: why it failed, that you stopped
 *  it, or that its answer could not be saved. None when it answered. */
function noteOf({ phase, error, warning, message }: RunSnapshot): Message | null {
  if (phase === "failed") return { role: "system", content: error ?? "Something went wrong." };
  if (phase === "stopped") return { role: "system", content: "Generation stopped." };
  if (phase === "done" && warning && message && !message._eventId) return { role: "system", content: warning };
  return null;
}

/** What the last requests left to say: the notes of the runs since the last
 *  one that answered, oldest first. */
export function notesOf(runs: RunSnapshot[]): Message[] {
  const notes: Message[] = [];
  for (let i = runs.length - 1; i >= 0; i--) {
    const note = noteOf(runs[i]);
    if (!note) break;
    notes.unshift(note);
  }
  return notes;
}

/** The notes after a chat's last message. Failed tries of one question pile
 *  up, so a repeat reads as "no reply after three tries"; an answer, or a new
 *  question, starts over. */
export function useNotes(conversationId: string | null, questionId: string | undefined, lastId: string | undefined): Message[] {
  const chat = useAccountChat()?.chat;
  const snapshot = useRun(conversationId);
  const run = conversationId ? chat?.getRun(conversationId) : undefined;
  const key = `${conversationId} ${questionId}`;
  const [seen, setSeen] = useState({ key, runs: NONE });
  let runs = seen.key === key ? seen.runs : NONE;
  const ended = snapshot && !["preparing", "paying", "thinking", "answering"].includes(snapshot.phase);
  // only runs that answer this question (or follow what it left): a run of the question before
  // can still be the latest for a moment after this one is saved
  const ours = run?.parentId !== undefined && (run.parentId === questionId || run.parentId === lastId);
  if (run && ended && ours && !runs.includes(run)) runs = [...runs, run].slice(-10);
  if (seen.key !== key || seen.runs !== runs) setSeen({ key, runs });
  return notesOf(runs.map((r) => r.getSnapshot()));
}
