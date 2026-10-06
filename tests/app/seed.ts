// Points the app's SDK at the kit's routstr-core. Discovery cannot do it offline: the SDK
// disables every provider without a review signed by Routstr's key, so a test enables the
// kit node by hand, exactly as a person does in Settings (manually_enabled_providers).
import type { BrowserContext, Page } from "@playwright/test";
import { PrivateKeyAccount } from "applesauce-accounts/accounts";
import { nip19 } from "nostr-tools";

/** Call on a loaded app page; reloads it so the SDK reads the new list. */
export async function seedKitProvider(
  page: Page,
  coreUrl: string,
  model: string
): Promise<void> {
  // the SDK creates its database on start; wait for it rather than create it with the wrong shape
  await page.waitForFunction(
    async () =>
      (await indexedDB.databases()).some((d) => d.name === "routstr-sdk"),
    null,
    { timeout: 30_000 }
  );
  await page.evaluate(
    async ({ url, model }) => {
      localStorage.setItem("base_urls_list", JSON.stringify([url]));
      // stored JSON-encoded: the app drops a value it cannot parse
      localStorage.setItem("lastUsedModel", JSON.stringify(`${model}@@${url}`));
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("routstr-sdk");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("sdk_storage", "readwrite");
          const store = tx.objectStore("sdk_storage");
          store.put(JSON.stringify([url]), "base_urls_list");
          store.put(JSON.stringify(Date.now()), "lastBaseUrlsUpdate");
          store.put(JSON.stringify([url]), "manually_enabled_providers");
          tx.oncomplete = () => (open.result.close(), resolve());
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { url: coreUrl, model }
  );
  await page.reload();
}

/**
 * Puts keys on the device before the app loads, as a person who signed in with each of
 * them earlier would have (`accounts` / `activeAccount`, the format both apps share). The
 * first one is active. v2 has no way to add a second key while signed in, so a test of
 * switching starts here.
 */
export async function seedAccounts(
  context: BrowserContext,
  nsecs: string[]
): Promise<void> {
  const accounts = nsecs.map((nsec) => {
    const { data } = nip19.decode(nsec);
    return PrivateKeyAccount.fromKey(data as Uint8Array).toJSON();
  });
  await context.addInitScript(
    ({ accounts }) => {
      if (localStorage.getItem("accounts")) return; // only on the first load
      localStorage.setItem("accounts", JSON.stringify(accounts));
      localStorage.setItem("activeAccount", accounts[0].id);
    },
    { accounts }
  );
}

/** Adds a key to the device's account list (not made active) and reloads, as if it had been
 *  signed in earlier. Neither app can add a second key from its screens while signed in. */
export async function addAccount(page: Page, nsec: string): Promise<void> {
  const { data } = nip19.decode(nsec);
  const account = PrivateKeyAccount.fromKey(data as Uint8Array).toJSON();
  await page.evaluate((account) => {
    const list = JSON.parse(localStorage.getItem("accounts") || "[]");
    localStorage.setItem("accounts", JSON.stringify([...list, account]));
  }, account);
  await page.reload();
}
