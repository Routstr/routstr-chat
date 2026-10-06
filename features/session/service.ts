import { AccountManager, type IAccount } from "applesauce-accounts";
import { registerCommonAccountTypes } from "applesauce-accounts/accounts";
import type { Saved } from "./saved";

export interface AccountMetadata {
  name: string;
}

export type Account = IAccount<any, any, AccountMetadata>;

/** What the rest of the app may read. Only the session adds, switches or removes. */
export type Accounts = Pick<
  AccountManager<AccountMetadata>,
  "active$" | "accounts$"
>;

export interface Session {
  accountId: string | null;
  pubkey: string | null;
  /** Bumps whenever the active account changes, and the app remounts on it.
   *  A guest's first key keeps it, so the guest's draft carries over. */
  generation: number;
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SavedAccounts = ReturnType<AccountManager["toJSON"]>;

const ACCOUNTS_KEY = "accounts";
const ACTIVE_KEY = "activeAccount";
const LOCK = "routstr-chat-accounts";

const parse = (json: string | null | undefined): SavedAccounts =>
  JSON.parse(json || "[]");
const merge = (a: SavedAccounts, b: SavedAccounts) => [
  ...a,
  ...b.filter((x) => !a.some((y) => y.id === x.id)),
];
const report = (error: unknown) =>
  console.error("[session] saving accounts", error);

/** The one owner of who is signed in on this device. */
export class SessionService {
  private readonly manager = new AccountManager<AccountMetadata>();
  private session: Session = { accountId: null, pubkey: null, generation: 0 };
  private listeners = new Set<() => void>();
  private storage!: KeyValueStorage;
  private saved!: Saved;
  // removed in this tab or another: a stored copy read later must not bring
  // them back
  private readonly gone = new Set<string>();
  // the accounts this tab has read back from the stored list. One it has not
  // is its own and not written yet, so it joins the list; one it has, and the
  // list no longer has, was removed in another tab, so it is gone here too
  private seen = new Set<string>();

  constructor() {
    registerCommonAccountTypes(this.manager);
  }

  get accounts(): Accounts {
    return this.manager;
  }

  /** Runs once, before the first render, so nothing starts up believing
   *  there is no account. The mirror in `storage` is read at once; accounts
   *  only the `saved` copy still has (the mirror was wiped) come back when it
   *  has been read. */
  boot(storage: KeyValueStorage, saved: Saved): void {
    this.storage = storage;
    this.saved = saved;
    this.load(
      parse(storage.getItem(ACCOUNTS_KEY)),
      storage.getItem(ACTIVE_KEY)
    );
    this.manager.active$.subscribe((account) => {
      if (account) this.saveActive(account.id);
      this.update(account);
    });
    this.sync().catch(report);
  }

  /** Another tab changed the stored accounts, or a main tab wiped
   *  localStorage: this tab follows, and writes the mirror again. */
  refresh(): void {
    const active = this.manager.active$.value;
    if (active && !this.storage.getItem(ACTIVE_KEY)) this.saveActive(active.id);
    this.sync().catch(report);
  }

  /** Adds an account and makes it the active one. It is on the mirror at
   *  once, so a reload right after keeps it. */
  add(account: Account, name?: string): void {
    if (name) account.metadata = { name };
    this.manager.addAccount(account);
    this.manager.setActive(account);
    const mirror = parse(this.storage.getItem(ACCOUNTS_KEY));
    this.storage.setItem(
      ACCOUNTS_KEY,
      JSON.stringify(merge(mirror, [account.toJSON()]))
    );
    this.sync().catch(report);
  }

  switchTo(id: string): void {
    this.manager.setActive(id);
  }

  /** Removing the active account moves to the next one first, so a removal
   *  never leaves accounts with none in use. */
  remove(id: string): void {
    this.gone.add(id);
    this.leave(id);
    this.sync().catch(report);
  }

  private leave(id: string): void {
    const next = this.manager.accounts$.value.find((a) => !this.gone.has(a.id));
    if (this.manager.active$.value?.id === id) {
      if (next) this.manager.setActive(next);
      // the last one: a stale list from a main tab must not sign it back in
      else {
        this.storage.removeItem(ACTIVE_KEY);
        this.saved.delete(ACTIVE_KEY).catch(report);
      }
    }
    this.manager.removeAccount(id);
  }

  /** Under a lock every tab shares, so no tab writes over another's change. */
  private async sync(): Promise<void> {
    // a page without Web Locks (plain http, a LAN address) still saves, unlocked
    if (!navigator.locks) return this.write();
    await navigator.locks.request(LOCK, () => this.write());
  }

  /** The stored list is read, this tab's own accounts join it, removed ones
   *  leave, and it is written back to both copies. This tab then holds
   *  exactly that list. */
  private async write(): Promise<void> {
    const [saved, activeId] = await Promise.all([
      this.saved.get(ACCOUNTS_KEY),
      this.saved.get(ACTIVE_KEY),
    ]);
    const mirror = this.storage.getItem(ACCOUNTS_KEY);
    const own = this.manager.accounts$.value
      .filter((a) => !this.seen.has(a.id))
      .map((a) => a.toJSON());
    const list = merge(merge(parse(saved), parse(mirror)), own).filter(
      (a) => !this.gone.has(a.id)
    );
    const json = JSON.stringify(list);
    this.storage.setItem(ACCOUNTS_KEY, json);
    this.seen = new Set(list.map((a) => a.id));
    this.load(list, activeId ?? this.storage.getItem(ACTIVE_KEY));
    // removed in another tab
    const out = this.manager.accounts$.value.filter(
      (a) => !this.seen.has(a.id)
    );
    out.forEach((a) => this.gone.add(a.id));
    out.forEach((a) => this.leave(a.id));
    if (json !== saved) await this.saved.put(ACCOUNTS_KEY, json);
  }

  /** Takes in accounts this tab does not have yet, and makes the given one
   *  active when none is. */
  private load(accounts: SavedAccounts, activeId: string | null): void {
    this.manager.fromJSON(accounts.filter((a) => !this.gone.has(a.id)));
    if (!this.manager.active$.value && activeId) {
      if (this.manager.getAccount(activeId)) this.manager.setActive(activeId);
    }
  }

  private saveActive(id: string): void {
    this.storage.setItem(ACTIVE_KEY, id);
    this.saved.put(ACTIVE_KEY, id).catch(report);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Session => this.session;

  private update(account: Account | undefined): void {
    const { session } = this;
    this.session = {
      accountId: account?.id ?? null,
      pubkey: account?.pubkey ?? null,
      generation:
        session.pubkey === null ? session.generation : session.generation + 1,
    };
    this.listeners.forEach((listener) => listener());
  }
}
