import { AccountManager, type IAccount } from "applesauce-accounts";
import { registerCommonAccountTypes } from "applesauce-accounts/accounts";

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

  constructor() {
    registerCommonAccountTypes(this.manager);
  }

  get accounts(): Accounts {
    return this.manager;
  }

  /** Runs once, before the first render, so nothing starts up believing
   *  there is no account. */
  boot(storage: KeyValueStorage): void {
    this.manager.fromJSON(JSON.parse(storage.getItem(ACCOUNTS_KEY) || "[]"));
    const activeId = storage.getItem(ACTIVE_KEY);
    if (activeId && this.manager.getAccount(activeId)) {
      this.manager.setActive(activeId);
    }

    this.manager.accounts$.subscribe(() =>
      storage.setItem(ACCOUNTS_KEY, JSON.stringify(this.manager.toJSON()))
    );
    this.manager.active$.subscribe((account) => {
      if (account) storage.setItem(ACTIVE_KEY, account.id);
      else storage.removeItem(ACTIVE_KEY);
      this.update(account);
    });
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

  remove(id: string): void {
    this.manager.removeAccount(id);
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
