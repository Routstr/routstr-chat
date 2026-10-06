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
/** The root's one switch path, called when the account in use has to change
 *  without a screen asking: the root stops that account's work (chat's, once
 *  it is built there), then calls `settle()`, which picks where to go then. */
export type Switcher = () => void;
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
// localStorage full or blocked: the IndexedDB copy still gets it
const mirrorTo = (storage: KeyValueStorage, key: string, value: string) => {
  try {
    storage.setItem(key, value);
  } catch (error) {
    report(error);
  }
};

/** The one owner of who is signed in on this device. */
export class SessionService {
  private readonly manager = new AccountManager<AccountMetadata>();
  private session: Session = { accountId: null, pubkey: null, generation: 0 };
  private listeners = new Set<() => void>();
  private storage!: KeyValueStorage;
  private saved!: Saved;
  private switcher!: Switcher;
  // removed in this tab or another: a stored copy read later must not bring
  // them back
  private readonly gone = new Set<string>();
  // the accounts this tab has read back from the stored list. One it has not
  // is its own and not written yet, so it joins the list; one it has, and the
  // list no longer has, was removed in another tab, so it is gone here too
  private seen = new Set<string>();
  // the account in use in the stored list, for a tab that has none
  private storedActive: string | null = null;

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
  boot(storage: KeyValueStorage, saved: Saved, switcher: Switcher): void {
    this.storage = storage;
    this.saved = saved;
    this.switcher = switcher;
    this.manager.fromJSON(parse(storage.getItem(ACCOUNTS_KEY)));
    const activeId = storage.getItem(ACTIVE_KEY);
    if (activeId && this.manager.getAccount(activeId)) {
      this.manager.setActive(activeId);
    }
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
    mirrorTo(
      this.storage,
      ACCOUNTS_KEY,
      JSON.stringify(merge(mirror, [account.toJSON()]))
    );
    this.sync().catch(report);
  }

  switchTo(id: string): void {
    this.manager.setActive(id);
  }

  /** The root calls this once the work of the account in use has stopped.
   *  Off an account that was removed, to the next one or to none; a tab with
   *  none in use takes the stored one. Otherwise it does nothing, so asking
   *  twice is safe. */
  settle(): void {
    const active = this.manager.active$.value;
    if (active && this.gone.has(active.id)) {
      const next = this.manager.accounts$.value.find(
        (a) => !this.gone.has(a.id)
      );
      if (next) this.manager.setActive(next);
      else {
        this.manager.clearActive();
        // none left: a main tab's stale list must not sign it back in
        this.storage.removeItem(ACTIVE_KEY);
        this.saved.delete(ACTIVE_KEY).catch(report);
      }
    } else if (
      !active &&
      this.storedActive &&
      this.seen.has(this.storedActive)
    ) {
      this.manager.setActive(this.storedActive);
    }
    // removed while in use: it leaves once nothing uses it
    const now = this.manager.active$.value?.id;
    for (const a of this.manager.accounts$.value) {
      if (this.gone.has(a.id) && a.id !== now) this.manager.removeAccount(a.id);
    }
  }

  /** Removing the account in use asks the root to move off it, to the next
   *  one, so a removal never leaves accounts with none in use. */
  remove(id: string): void {
    this.gone.add(id);
    this.leave(id);
    this.sync().catch(report);
  }

  private leave(id: string): void {
    if (this.manager.active$.value?.id !== id) {
      return this.manager.removeAccount(id);
    }
    this.switcher();
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
    mirrorTo(this.storage, ACCOUNTS_KEY, json);
    this.seen = new Set(list.map((a) => a.id));
    this.manager.fromJSON(list);
    // removed in another tab
    const out = this.manager.accounts$.value.filter(
      (a) => !this.seen.has(a.id)
    );
    out.forEach((a) => this.gone.add(a.id));
    out.forEach((a) => this.leave(a.id));
    // a tab with none in use takes the stored one, also through the root
    const stored = activeId ?? this.storage.getItem(ACTIVE_KEY);
    this.storedActive = stored;
    if (!this.manager.active$.value && stored && this.seen.has(stored)) {
      this.switcher();
    }
    if (json !== saved) await this.saved.put(ACCOUNTS_KEY, json);
  }

  private saveActive(id: string): void {
    mirrorTo(this.storage, ACTIVE_KEY, id);
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
