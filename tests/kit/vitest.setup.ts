// globalSetup of the "money" vitest project (*.mint.test.ts): uses the stack the kit runner
// already started (KIT_* env), or starts one for this vitest run and stops it after.
import type { GlobalSetupContext } from "vitest/node";
import { envFromProcess, startStack, type KitEnv } from "./stack";

declare module "vitest" {
  export interface ProvidedContext {
    kit: KitEnv;
  }
}

export default async function setup({ provide }: GlobalSetupContext) {
  const existing = envFromProcess();
  if (existing) return void provide("kit", existing);
  const stack = await startStack({
    core: !!process.env.KIT_CORE_DIR,
    log: (l) => console.log(`[kit] ${l}`),
  });
  provide("kit", stack.env);
  return stack.stop;
}
