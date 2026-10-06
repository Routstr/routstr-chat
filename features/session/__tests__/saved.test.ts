import { describe, expect, it } from "vitest";
import { freshIndexedDBPerTest } from "@/tests/kit/idb";
import { savedInIndexedDB } from "../saved";

freshIndexedDBPerTest();

describe("savedInIndexedDB", () => {
  it("keeps what was put across a reopen, and forgets what was deleted", async () => {
    const first = savedInIndexedDB();
    await first.put("accounts", '[{"id":"a"}]');
    await first.put("activeAccount", "a");
    await first.delete("activeAccount");

    const again = savedInIndexedDB();
    expect(await again.get("accounts")).toBe('[{"id":"a"}]');
    expect(await again.get("activeAccount")).toBeUndefined();
  });
});
