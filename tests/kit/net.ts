// A headless Chromium that reaches only the app under test and the kit's own services. Every
// other request and WebSocket is blocked and listed, other ports on this machine included
// (a dev build names http://localhost:8000 as a provider). Nostr relays are the exception:
// they (and their NIP-11 info) are answered by the kit's local relay, so the app syncs and
// discovers as it would online, without publishing anything outside. Service workers are
// blocked (in the context options) so a cached build never answers instead.
import fs from "node:fs";
import { chromium, type BrowserContext } from "playwright";
import WebSocket from "ws";
import type { KitEnv } from "./stack";

/** A fixed provider URL for builds (NEXT_PUBLIC_ROUTSTR_PROVIDERS); the seal forwards it to the run's core. */
export const PROVIDER_ALIAS = "http://routstr-core.localhost/";

export interface Seal {
  /** every outside URL the page tried, in order (relays excluded: they were served locally) */
  blocked: string[];
  /** outside relays the page connected to, served by the local relay */
  relays: Set<string>;
  /** messages the page sent to relays */
  relayMessages: number;
}

export function chromiumPath(): string | undefined {
  if (process.env.KIT_CHROMIUM) return process.env.KIT_CHROMIUM;
  try {
    if (fs.existsSync(chromium.executablePath())) return undefined; // Playwright's own build
  } catch {
    /* not installed */
  }
  return [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].find((p) => fs.existsSync(p));
}

/**
 * Seals a context to the app at `appUrl` and the kit stack: its relay for every relay, its
 * core at PROVIDER_ALIAS.
 */
export async function seal(
  context: BrowserContext,
  env: KitEnv,
  appUrl: string
): Promise<Seal> {
  const state: Seal = { blocked: [], relays: new Set(), relayMessages: 0 };
  const ours = new Set(
    [appUrl, env.mintUrl, env.invoiceMintUrl, env.relayUrl, env.coreUrl]
      .filter((u): u is string => !!u)
      .map((u) => new URL(u).host)
  );
  const isOurs = (url: string) => ours.has(new URL(url).host);
  const aliases: Record<string, string> = env.coreUrl
    ? { [PROVIDER_ALIAS]: env.coreUrl }
    : {};
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    const alias = Object.keys(aliases).find((a) => url.startsWith(a));
    // continue, not fetch and fulfill: a fulfilled body arrives whole, so replies would not stream
    if (alias)
      return route.continue({ url: aliases[alias] + url.slice(alias.length) });
    if (url.startsWith("data:") || url.startsWith("blob:") || isOurs(url))
      return route.continue();
    // a relay's NIP-11 info (clients check it for NIP-77 sync): the kit relay answers
    if (route.request().headers().accept?.includes("application/nostr+json")) {
      const info = env.relayUrl.replace(/^ws/, "http");
      return route.fulfill({ response: await route.fetch({ url: info }) });
    }
    state.blocked.push(url);
    return route.abort("blockedbyclient");
  });
  await context.routeWebSocket(/.*/, (page) => {
    const url = page.url();
    if (isOurs(url)) return void page.connectToServer();
    // a relay is a ws(s) URL on another machine; anything else here is not ours
    if (
      !/^wss?:\/\//.test(url) ||
      /^wss?:\/\/(localhost|127\.|\[::1\])/.test(url)
    ) {
      state.blocked.push(url);
      return void page.close();
    }
    state.relays.add(url);
    const local = new WebSocket(env.relayUrl);
    const pending: string[] = [];
    local.on("open", () => pending.splice(0).forEach((m) => local.send(m)));
    local.on("message", (data) => page.send(String(data)));
    local.on("close", () => page.close());
    local.on("error", () => page.close());
    page.onMessage((m) => {
      state.relayMessages++;
      if (local.readyState === WebSocket.OPEN) local.send(String(m));
      else pending.push(String(m));
    });
    page.onClose(() => local.close());
  });
  return state;
}
