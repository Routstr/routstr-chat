// Every in-app test gets a sealed browser context (nothing leaves the machine; relays are
// served by the kit relay) and the kit client for coins, invoices and the upstream.
import { test as base, expect } from "@playwright/test";
import { kitClient, type KitClient } from "../kit/client";
import { seal, type Seal } from "../kit/net";
import { envFromProcess } from "../kit/stack";

const env = envFromProcess();
if (!env)
  throw new Error("no kit stack: run in-app tests with `pnpm test app`");

export interface AppOptions {
  /** where the app under test is served (the kit sets KIT_APP_URL) */
  appUrl: string;
}

export const test = base.extend<{ kit: KitClient; seal: Seal } & AppOptions>({
  // Playwright's fixture callback, named `provide`: react-hooks lint reads `use` as React's hook
  kit: async ({}, provide) => provide(kitClient(env)),
  appUrl: [process.env.KIT_APP_URL ?? "", { option: true }],
  seal: [
    async ({ context, appUrl }, provide, info) => {
      const state = await seal(context, env, appUrl);
      // what the person would have seen go wrong: page errors, console errors, toasts
      const seen: string[] = [];
      context.on("weberror", (e) =>
        seen.push(`page error: ${e.error().message}`)
      );
      context.on(
        "console",
        (m) =>
          m.type() === "error" &&
          !/ERR_BLOCKED_BY_CLIENT/.test(m.text()) &&
          seen.push(`console: ${m.text()}`)
      );
      await context.exposeBinding(
        "__kitToast",
        (_, text: string) => void seen.push(`toast: ${text}`)
      );
      await context.addInitScript(() => {
        const report = (n: HTMLElement) =>
          (window as unknown as { __kitToast(t: string): void }).__kitToast(
            n.innerText
          );
        // the first toast arrives inside its list, which sonner only adds with it
        new MutationObserver((changes) => {
          for (const c of changes)
            for (const n of c.addedNodes) {
              if (!(n instanceof HTMLElement)) continue;
              if (n.matches("[data-sonner-toast]")) report(n);
              else
                n.querySelectorAll<HTMLElement>("[data-sonner-toast]").forEach(
                  report
                );
            }
        }).observe(document, { childList: true, subtree: true });
      });
      await provide(state);
      if (state.blocked.length)
        info.annotations.push({
          type: "blocked",
          description: [...new Set(state.blocked)].join("\n"),
        });
      if (seen.length && info.status !== info.expectedStatus)
        await info.attach("what the page showed", {
          body: seen.join("\n").slice(0, 20_000),
          contentType: "text/plain",
        });
    },
    { auto: true },
  ],
});

export { expect };
