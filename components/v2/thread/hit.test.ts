import { describe, expect, it } from "vitest";
import type { ThreadSlot } from "@/features/history/view";
import { hitIn } from "./hit";

const slot = (keys: string[], shown: number) =>
  ({ keys, displayed: { _eventId: keys[shown] }, displayedIndex: shown }) as unknown as ThreadSlot;
const slots = [slot(["q1"], 0), slot(["a1", "a1b"], 1), slot(["q2"], 0)];

describe("hitIn: where a search hit sits in a thread", () => {
  it("finds a shown message at its depth", () => {
    expect(hitIn(slots, "q2")).toEqual({ shown: 2 });
    expect(hitIn(slots, "a1b")).toEqual({ shown: 1 });
  });

  it("finds another version of a turn, to show it first", () => {
    expect(hitIn(slots, "a1")).toEqual({ other: 1 });
  });

  it("finds nothing for a message off this thread", () => {
    expect(hitIn(slots, "elsewhere")).toBeNull();
  });
});
