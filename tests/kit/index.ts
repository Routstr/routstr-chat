// For *.mint.test.ts files: the running stack and its client. (Not a React hook, so no
// "use" prefix.)
import { inject } from "vitest";
import { kitClient, type KitClient } from "./client";

export function getKit(): KitClient {
  return kitClient(inject("kit"));
}

export { kitClient, type KitClient } from "./client";
export type { KitEnv } from "./stack";
export type { Behaviour } from "./services/upstream";
