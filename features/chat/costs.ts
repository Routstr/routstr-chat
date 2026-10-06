type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * What each reply cost, for one account, kept by reply event id so a screen
 * can show it next to the reply. The cost comes from the SDK's usage log once
 * the payment has settled.
 */
export class ReplyCosts {
  private map: Record<string, number>;
  private listeners = new Set<() => void>();

  /** `key` holds main's format, `{ [replyEventId]: sats }`. */
  constructor(
    private storage: KeyValueStorage,
    private key: string,
    private lookup: (requestId: string) => Promise<number | undefined>
  ) {
    this.map = this.read();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Record<string, number> => this.map;

  async record(replyId: string, requestId: string): Promise<void> {
    const sats = await this.lookup(requestId);
    if (sats === undefined) return;
    // read again first: another tab may have written since
    this.map = { ...this.read(), [replyId]: sats };
    this.storage.setItem(this.key, JSON.stringify(this.map));
    this.listeners.forEach((listener) => listener());
  }

  private read(): Record<string, number> {
    return JSON.parse(this.storage.getItem(this.key) ?? "{}");
  }
}
