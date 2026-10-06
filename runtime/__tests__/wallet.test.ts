import { expect, it, vi } from "vitest";

const made = vi.hoisted(() => [] as { owner: string; activity: unknown }[]);
vi.mock("@/features/wallet/purse", () => ({
  createPurse: (owner: string, deps: { activity: unknown }) => {
    made.push({ owner, activity: deps.activity });
    return { owner };
  },
}));
vi.mock("../book", () => ({ journal: {}, locks: undefined }));

import {
  legacyActivity,
  localActivity,
} from "@/features/wallet/hooks/purseBridge";
import { purseFor, walletPurseFor } from "../wallet";

it("gives chat and keys purses whose activity stays local, and the wallet screens published ones", () => {
  expect(purseFor("alice")).toBe(purseFor("alice"));
  expect(walletPurseFor("alice")).toBe(walletPurseFor("alice"));
  expect(purseFor("alice")).not.toBe(walletPurseFor("alice"));
  expect(made).toEqual([
    { owner: "alice", activity: localActivity },
    { owner: "alice", activity: legacyActivity },
  ]);
});
