import { describe, expect, it } from "vitest";
import type { RunSnapshot } from "@/features/chat/view";
import { notesOf } from "./useNotes";

const run = (phase: RunSnapshot["phase"], more: Partial<RunSnapshot> = {}): RunSnapshot => ({ phase, text: "", thinking: "", ...more });
const texts = (runs: RunSnapshot[]) => notesOf(runs).map((m) => m.content);

describe("the notes after a chat's last message", () => {
  it("says why a request failed, and that you stopped one", () => {
    expect(texts([run("failed", { error: "The provider did not respond to this request." })])).toEqual(["The provider did not respond to this request."]);
    expect(texts([run("stopped")])).toEqual(["Generation stopped."]);
  });

  it("piles up failed tries, so a repeat reads as several", () => {
    expect(texts([run("failed", { error: "a" }), run("failed", { error: "b" })])).toEqual(["a", "b"]);
  });

  it("starts over once a request answers", () => {
    const answered = run("done", { message: { role: "assistant", content: "hi", _eventId: "e1" } });
    expect(texts([run("failed", { error: "a" }), answered])).toEqual([]);
    expect(texts([run("failed", { error: "a" }), answered, run("failed", { error: "b" })])).toEqual(["b"]);
  });

  it("says when an answer came but could not be saved, and nothing for a saved one with a warning", () => {
    const warning = "The answer could not be saved: disk full";
    expect(texts([run("done", { warning, message: { role: "assistant", content: "hi" } })])).toEqual([warning]);
    expect(texts([run("done", { warning: "Some attachments could not be loaded and were left out.", message: { role: "assistant", content: "hi", _eventId: "e1" } })])).toEqual([]);
  });
});
