// The steps a person takes, per app. Each method returns once the person would see the
// result, so the time around it is what they wait. Optional steps are features an app may
// not have; a parity check reports those as missing.
import type { Page } from "@playwright/test";
import { main } from "./main";
import { v2 } from "./v2";

export interface Driver {
  name: string;
  /** first visit, until the composer takes a message */
  open(page: Page, appUrl: string): Promise<void>;
  /** until the composer takes a message (what a first load is timed to) */
  loaded(page: Page): Promise<void>;
  /** after a load or reload: loaded, with any prompt the app opens by itself closed */
  ready(page: Page): Promise<void>;
  /** the wallet total the app shows */
  balance(page: Page): Promise<number>;
  /** until the app shows the account as signed in */
  signIn(page: Page, nsec: string): Promise<void>;
  /** paste a token into the wallet, until the balance shows it */
  receive(page: Page, token: string): Promise<void>;
  /** make `mintUrl` the wallet's active mint (sends and invoices use it), as a person picks it */
  useMint(page: Page, mintUrl: string): Promise<void>;
  /** pay a Lightning invoice from the wallet, until it shows paid */
  payInvoice(page: Page, bolt11: string): Promise<void>;
  /** make an ecash token, until it is shown; returns it */
  makeToken(page: Page, sats: number): Promise<string>;
  send(page: Page, text: string): Promise<void>;
  /** CSS for the replies, in order (perf times text appearing in the last one, in the page) */
  replies: string;
  /** the latest reply's text right now ("" when there is none) */
  replyText(page: Page): Promise<string>;
  /** until the latest reply contains `text` */
  waitReplyText(page: Page, text: string): Promise<void>;
  /** until the reply is finished and the composer can send again */
  waitIdle(page: Page): Promise<void>;
  /** until the chat list shows at least `n` chats */
  waitChats(page: Page, n: number): Promise<void>;
  /** stop the reply that is streaming */
  stop(page: Page): Promise<void>;
  /** ask the last reply again */
  retryLast(page: Page): Promise<void>;
  /** "which version / how many" of the last reply, or null when it has one */
  lastVersion(page: Page): Promise<{ at: number; of: number } | null>;
  /** until a reply's reasoning is shown as finished thinking */
  waitThought(page: Page): Promise<void>;
  /** take back what is held at providers (credit, unspent reply tokens), until it is in the wallet */
  returnCredit(page: Page): Promise<void>;
  /** until a failed reply is shown as an error */
  waitError(page: Page): Promise<void>;
  /** open the app with ?cashu=<token>, until the balance shows it */
  fundByLink(page: Page, appUrl: string, token: string): Promise<void>;
  /** switch to the other key on this device, until it is the active one and the app takes a message */
  switchAccount(page: Page): Promise<void>;
}

export const drivers: Record<string, Driver> = { v2, main };
