// A parity check is written once against the Driver interface and runs on both apps.
import { generateSecretKey, nip19 } from "nostr-tools";
import { test as app, expect, type AppOptions } from "../app/fixtures";
import { drivers, type Driver } from "../app/drivers";
import { getTokenMetadata } from "@cashu/cashu-ts";
import { seedKitProvider } from "../app/seed";

export interface ParityOptions extends AppOptions {
  driverName: string;
}

export const test = app.extend<
  Omit<ParityOptions, "appUrl"> & { driver: Driver }
>({
  driverName: ["v2", { option: true }],
  driver: async ({ driverName }, provide) => provide(drivers[driverName]),
});

export const newKey = () => nip19.nsecEncode(generateSecretKey());

/** Opens the app, signs in with a fresh key, points it at the kit's core and adds sats. */
export async function readyToChat(
  page: Parameters<Driver["open"]>[0],
  driver: Driver,
  appUrl: string,
  coreUrl: string,
  token: string,
  nsec: string
) {
  await driver.open(page, appUrl);
  await driver.signIn(page, nsec);
  await seedKitProvider(page, coreUrl, "kit-cheap");
  await driver.ready(page);
  await driver.receive(page, token);
  await driver.useMint(page, getTokenMetadata(token).mint);
}

export { expect };
