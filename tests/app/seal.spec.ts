// The harness itself: nothing leaves the machine, and the app's relay traffic lands on the
// kit relay instead of the public relays it names.
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedAccounts } from "./seed";

test("blocks every outside host and serves the app's relays from the kit relay", async ({
  page,
  context,
  kit,
  seal,
  appUrl,
}) => {
  const sk = generateSecretKey();
  await seedAccounts(context, [nip19.nsecEncode(sk)]);
  await v2.open(page, appUrl);
  await v2.receive(page, await kit.mintToken(50));

  // the app published as this account, through the public relays it names, onto the kit relay
  const mine = async () =>
    (await kit.relay.events()).filter((e) => e.pubkey === getPublicKey(sk))
      .length;
  await expect.poll(mine, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(seal.relays.size).toBeGreaterThan(0);
  expect([...seal.relays].every((url) => url.startsWith("wss://"))).toBe(true);

  // and an outside request from the page fails, and is listed
  const reached = await page.evaluate(() =>
    fetch("https://example.com/").then(
      () => true,
      () => false
    )
  );
  expect(reached).toBe(false);
  expect(seal.blocked).toContain("https://example.com/");
});
