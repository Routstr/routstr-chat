import { expect, it } from "vitest";
import { Journal, memoryStorage, PREFIX } from "../journal";

it("skips a stored value that is not a record, and lists the rest", () => {
  const storage = memoryStorage();
  const journal = new Journal(storage);
  storage.setItem(`${PREFIX}x`, "null");
  storage.setItem(`${PREFIX}y`, "{not json");
  journal.put({
    v: 1,
    kind: "landed",
    id: "l",
    owner: "alice",
    mintUrl: "m",
    createdAt: 0,
    proofs: [],
  });

  expect(journal.list("alice").map((r) => r.id)).toEqual(["l"]);
});
