import { describe, expectTypeOf, it } from "vitest";
import type { ApiKeyEntry, StorageAdapter } from "@routstr/sdk/wallet";
import type { KeysService } from "../service";
import type { oldCredit } from "../legacy";
import type { OtherDevices as Backup } from "../backup";

// The chat pipeline's ports, as v2/chat 4cefda8 declares them in
// features/payments/ports.ts. When both branches meet, import them from there.
type PaySource = "direct" | "node";
interface Keys {
  ready(): Promise<void>;
  storage(source?: PaySource): StorageAdapter;
  lock(signal?: AbortSignal): Promise<() => void>;
  reload(source?: PaySource): Promise<void>;
  flush(source?: PaySource): Promise<void>;
}
interface OldCredit {
  load(): Promise<StorageAdapter>;
  lock(): Promise<() => void>;
}
interface OtherDevices {
  keys(): ApiKeyEntry[];
  drop(keys: string[]): Promise<void>;
}

describe("the ports keys gives the chat pipeline", () => {
  it("fit the chat's port types", () => {
    expectTypeOf<KeysService>().toMatchTypeOf<Keys>();
    expectTypeOf<ReturnType<typeof oldCredit>>().toMatchTypeOf<OldCredit>();
    expectTypeOf<Backup>().toMatchTypeOf<OtherDevices>();
  });
});
