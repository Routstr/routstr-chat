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

const ACCOUNTS_KEY = "accounts";
const ACTIVE_KEY = "activeAccount";

/** The one owner of who is signed in on this device. */
export class SessionService {
  private readonly manager = new AccountManager<AccountMetadata>();
  private session: Session = { accountId: null, pubkey: null, generation: 0 };
  private listeners = new Set<() => void>();
  private storage!: KeyValueStorage;
  private saved!: Saved;
  // the saved copy is written only once it was read, so a mirror that was
  // wiped while the app was closed never writes over it
  private synced = false;
  // removed in this tab: a saved copy read later must not bring them back
  private readonly gone = new Set<string>();

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
    this.load(storage.getItem(ACCOUNTS_KEY), storage.getItem(ACTIVE_KEY));
    this.manager.accounts$.subscribe(() => this.save());
    this.manager.active$.subscribe((account) => {
      this.save();
      this.update(account);
    });
    Promise.all([saved.get(ACCOUNTS_KEY), saved.get(ACTIVE_KEY)])
      .then(([accounts, activeId]) => {
        this.load(accounts ?? null, activeId ?? null);
        // and what another tab wrote to the mirror meanwhile
        this.load(storage.getItem(ACCOUNTS_KEY), storage.getItem(ACTIVE_KEY));
        this.synced = true;
        this.save();
      })
      .catch((error) => console.error("[session] saved accounts", error));
  }

  /** Writes the mirror again after another tab wiped it. */
  repair(): void {
    this.save();
  }

  /** Adds an account and makes it the active one. */
  add(account: Account, name?: string): void {
    if (name) account.metadata = { name };
    this.manager.addAccount(account);
    this.manager.setActive(account);
  }

  switchTo(id: string): void {
    this.manager.setActive(id);
  }

  /** Removing the active account moves to the next one first, so a removal
   *  never leaves accounts with none in use. */
  remove(id: string): void {
    const next = this.manager.accounts$.value.find((a) => a.id !== id);
    if (this.manager.active$.value?.id === id && next) {
      this.manager.setActive(next);
    }
    this.gone.add(id);
    this.manager.removeAccount(id);
  }

  /** Takes in accounts this tab does not have yet, and makes the given one
   *  active when none is. */
  private load(accounts: string | null, activeId: string | null): void {
    const saved: ReturnType<AccountManager["toJSON"]> = JSON.parse(
      accounts || "[]"
    );
    this.manager.fromJSON(saved.filter((a) => !this.gone.has(a.id)));
    if (!this.manager.active$.value && activeId) {
      if (this.manager.getAccount(activeId)) this.manager.setActive(activeId);
    }
  }

  private save(): void {
    const accounts = JSON.stringify(this.manager.toJSON());
    const activeId = this.manager.active$.value?.id;
    this.storage.setItem(ACCOUNTS_KEY, accounts);
    if (activeId) this.storage.setItem(ACTIVE_KEY, activeId);
    else this.storage.removeItem(ACTIVE_KEY);
    if (!this.synced) return;
    const done = Promise.all([
      this.saved.put(ACCOUNTS_KEY, accounts),
      activeId
        ? this.saved.put(ACTIVE_KEY, activeId)
        : this.saved.delete(ACTIVE_KEY),
    ]);
    done.catch((error) => console.error("[session] saving accounts", error));
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
