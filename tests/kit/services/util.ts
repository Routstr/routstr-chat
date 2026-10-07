import net from "node:net";
import type { ChildProcess } from "node:child_process";

/** A port nothing listens on right now (the OS picks it, never a fixed one). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** Polls `ready` until it returns true; fails early if `child` exits first. */
export async function waitFor(
  what: string,
  timeoutMs: number,
  ready: () => Promise<boolean>,
  child?: ChildProcess
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null))
      throw new Error(`${what} exited before it was ready`);
    if (await ready().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${what} was not ready after ${timeoutMs / 1000} s`);
}
