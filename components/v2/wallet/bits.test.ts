import { describe, it, expect } from "vitest";
import { pairChange } from "@/components/v2/wallet/bits";

describe("pairChange", () => {
  it("gives each reply its own change, even when refunds and replies interleave", () => {
    // a real run: three payments with no change, then six replies refunded in full
    const at = (hms: string) => Date.parse(`2026-10-04T${hms}Z`);
    const seq: [string, "in" | "out", number][] = [
      ["12:19:34", "out", 50], ["12:21:37", "out", 100], ["12:24:05", "out", 95],
      ["12:25:32", "out", 58], ["12:25:43", "in", 58], ["12:25:44", "out", 60], ["12:25:54", "in", 60],
      ["12:25:56", "out", 60], ["12:26:03", "in", 60], ["12:26:05", "out", 82], ["12:26:12", "in", 82],
      ["12:27:37", "out", 13], ["12:27:45", "in", 13], ["12:28:23", "out", 107], ["12:28:33", "in", 107],
    ];
    const entries = seq.map(([t, direction, amount], i) => ({ id: String(i), direction, amount, timestamp: at(t) }));
    const { changeOf } = pairChange(entries);
    const cost = entries.filter((e) => e.direction === "out").map((e) => e.amount - (changeOf.get(e.id)?.amount ?? 0));
    expect(cost).toEqual([50, 100, 95, 0, 0, 0, 0, 0, 0]);
  });

  it("pairs a payment with change written in the same second, whichever was listed first", () => {
    const t = Date.parse("2026-10-07T12:00:00Z") / 1000;
    const entries = [
      { id: "in", direction: "in", amount: "49", timestamp: t },
      { id: "out", direction: "out", amount: "50", timestamp: t },
    ];
    expect(pairChange(entries).changeOf.get("out")?.id).toBe("in");
  });
});
