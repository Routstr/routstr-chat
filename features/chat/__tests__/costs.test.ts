import { describe, expect, it, vi } from "vitest";
import { ReplyCosts } from "../costs";
import { memoryStorage } from "./fakes";

const price = (sats?: number) => vi.fn(async () => sats);

describe("ReplyCosts", () => {
  it("records a reply's cost from the usage log, by reply event id", async () => {
    const storage = memoryStorage();
    const lookup = price(3.2);
    const costs = new ReplyCosts(storage, "sats_spent_by_event:alice", lookup);

    await costs.record("reply-1", "req-1");

    expect(lookup).toHaveBeenCalledWith("req-1");
    expect(costs.getSnapshot()).toEqual({ "reply-1": 3.2 });
    expect(JSON.parse(storage.getItem("sats_spent_by_event:alice")!)).toEqual({
      "reply-1": 3.2,
    });
  });

  it("records nothing when the usage log has no entry", async () => {
    const costs = new ReplyCosts(
      memoryStorage(),
      "sats_spent_by_event:alice",
      price(undefined)
    );

    await costs.record("reply-1", "req-1");

    expect(costs.getSnapshot()).toStrictEqual({});
  });

  it("reads what is already stored for this account only", () => {
    const storage = memoryStorage();
    storage.setItem("sats_spent_by_event:alice", '{"e1":2}');
    storage.setItem("sats_spent_by_event:bob", '{"e2":5}');

    expect(
      new ReplyCosts(
        storage,
        "sats_spent_by_event:alice",
        price()
      ).getSnapshot()
    ).toEqual({ e1: 2 });
  });

  it("keeps another tab's costs when it writes its own", async () => {
    const storage = memoryStorage();
    const tabA = new ReplyCosts(storage, "sats_spent_by_event:alice", price(1));
    const tabB = new ReplyCosts(storage, "sats_spent_by_event:alice", price(2));

    await tabA.record("from-a", "r");
    await tabB.record("from-b", "r");

    expect(JSON.parse(storage.getItem("sats_spent_by_event:alice")!)).toEqual({
      "from-a": 1,
      "from-b": 2,
    });
  });

  it("tells the screen when a cost arrives", async () => {
    const costs = new ReplyCosts(
      memoryStorage(),
      "sats_spent_by_event:alice",
      price(1)
    );
    const listener = vi.fn();
    costs.subscribe(listener);

    await costs.record("reply-1", "req-1");

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
