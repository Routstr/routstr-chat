// For *.mint.test.ts files: the running stack and its client.
import { inject } from "vitest";
import { kitClient, type KitClient } from "./client";

export function useKit(): KitClient {
  return kitClient(inject("kit"));
}

export { kitClient, type KitClient } from "./client";
export type { KitEnv } from "./stack";
export type { Behaviour } from "./services/upstream";
