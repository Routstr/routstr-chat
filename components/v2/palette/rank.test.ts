import { describe, expect, it } from "vitest";
import { fit, labelScore, plain, roomsFor, snippet, titleScore, tokens } from "./rank";

const WALLET = "balance sats money top up add fund pay send receive";
const ACCOUNT = "log in login sign in key";

describe("tokens", () => {
  it("lowercases and splits on any run of space", () => {
    expect(tokens("  Top   UP ")).toEqual(["top", "up"]);
  });
});

describe("fit", () => {
  it("is 3 at the start, 2 at a word, 1 inside a word, 0 when absent", () => {
    expect([fit("new chat", "new"), fit("new chat", "chat"), fit("new chat", "hat"), fit("new chat", "xyz"), fit("wallet-top", "top")]).toEqual([3, 2, 1, 0, 2]);
  });
});

describe("labelScore", () => {
  it("ranks a visible name over a phrase over a hidden word over a hit inside a word", () => {
    expect(labelScore("Wallet", WALLET, "wal", ["wal"], [], 70, 66)).toBe(100);
    expect(labelScore("Wallet", WALLET, "top up", ["top", "up"], [], 70, 66)).toBe(70);
    expect(labelScore("Wallet", WALLET, "balance", ["balance"], [], 70, 66)).toBe(66);
    expect(labelScore("Wallet", WALLET, "llet", ["llet"], [], 70, 66)).toBe(50);
    expect(labelScore("Sync chats now", "sync relays devices backup refresh", "chats", ["chats"], [], 70, 66)).toBe(80);
  });
  it("lets a plural find its word", () => {
    expect(labelScore("Choose a model", "model switch change llm ai", "models", ["models"], [], 70, 66)).toBe(80);
    expect(labelScore("Account", ACCOUNT, "logs", ["logs"], [], 70, 60)).toBe(55);
  });
  it("scores a settings row title 65, from two letters", () => {
    expect(labelScore("Usage", "Usage clear records history", "delete", ["delete"], ["Delete all chats", "Spending"], 60)).toBe(65);
    expect(labelScore("Usage", "Usage clear records history", "d", ["d"], ["Delete all chats"], 60)).toBe(0);
  });
  it("meets only visible names with one letter, and hidden words only from three", () => {
    expect(labelScore("Wallet", WALLET, "w", ["w"])).toBe(100);
    expect(labelScore("Wallet", WALLET, "a", ["a"])).toBe(0);
    expect(labelScore("Account", ACCOUNT, "sign", ["sign"], [], 70, 60)).toBe(60);
    expect(labelScore("Account", ACCOUNT, "si", ["si"], [], 70, 60)).toBe(0);
  });
  it("counts a phrase in the hidden words whole", () => {
    expect(labelScore("Night", "Ink moving in deep water dark black dark mode", "dark mode", ["dark", "mode"])).toBe(70);
  });
});

describe("titleScore", () => {
  it("strips a plural only from four letters", () => {
    expect(titleScore("Top up", "ups", ["ups"])).toBe(0);
  });
  it("is 90 at the start, 70 at a word, 45 inside a word, and needs every word", () => {
    expect(
      [
        titleScore("Bitcoin fees explained", "bitcoin", ["bitcoin"]),
        titleScore("Bitcoin fees explained", "fees", ["fees"]),
        titleScore("Bitcoin fees explained", "itcoin", ["itcoin"]),
        titleScore("Bitcoin fees explained", "fees bitcoin", ["fees", "bitcoin"]),
        titleScore("Bitcoin fees explained", "x", ["x"]),
        titleScore("Trip to Lisbon", "trips", ["trips"]),
        titleScore("Trip to Lisbon", "trip paris", ["trip", "paris"]),
      ]
    ).toEqual([90, 70, 45, 70, 0, 70, 0]);
  });
});

describe("plain", () => {
  it("drops markdown marks and gives headings and list items a stop", () => {
    expect(plain("## Plan for Lisbon\nWe land at **noon** and take the `metro` in.\n- check in\n- dinner at 8\n\n1. pack\n> keep the tickets")).toBe(
      "Plan for Lisbon. We land at noon and take the metro in. check in. dinner at 8.pack. keep the tickets."
    );
  });
  it("drops code blocks and images, keeps link words", () => {
    expect(plain("Use this:\n```ts\nconst x = 1;\n```\nthen see [the docs](https://example.com) and ![chart](a.png).")).toBe("Use this: then see the docs and .");
  });
  it("unwraps maths and emphasis", () => {
    expect(plain("Energy is $E = mc^2$ and $$x_1$$ here, with __strong__ and ~~gone~~ and *soft* words.")).toBe(
      "Energy is E = mc^2 and x1 here, with strong_ and gone and soft words."
    );
  });
  it("drops everything after a fence that never closes", () => {
    expect(plain("```\nunclosed code that never ends")).toBe("");
  });
});

describe("snippet", () => {
  const body =
    "The quick brown fox jumps over the lazy dog near the river bank today, and then it rests for a while under the old oak tree by the water.";
  it("opens at most three words before the hit", () => {
    expect(snippet(body, body.indexOf("lazy"), 4)).toBe(
      "…jumps over the lazy dog near the river bank today, and then it rests for a while under the old oak tree by th"
    );
    expect(snippet(body, body.indexOf("quick"), 5)).toBe("The quick brown fox jumps over the lazy dog near the river bank today, and then it rests for a whil");
  });
  it("has no ellipsis at the start of the text", () => {
    expect(snippet(body, 0, 3)).toBe("The quick brown fox jumps over the lazy dog near the river bank today, and then it rests for ");
  });
  it("folds runs of space", () => {
    const b = "one   two\n\nthree    four five six seven";
    expect(snippet(b, b.indexOf("six"), 3)).toBe("…three four five six seven");
  });
});

describe("roomsFor", () => {
  const ids = (q: string) => roomsFor(q).map((r) => r.id);
  it("lists every room when empty", () => {
    expect(ids("")).toEqual(["auto", "paper", "night", "meridian", "overprint"]);
  });
  it("ranks names first, then words, with the list order breaking ties", () => {
    expect(ids("dark")).toEqual(["auto", "night"]);
    expect(ids("night")).toEqual(["night", "auto"]);
    expect(ids("light mode")).toEqual(["auto", "paper"]);
    expect(ids("pa")).toEqual(["paper"]);
    expect(ids("rooms")).toEqual(["meridian"]);
    expect(ids("system")).toEqual(["auto"]);
    expect(ids("ink")).toEqual(["night", "overprint"]);
    expect(ids("zzz")).toEqual([]);
  });
});
