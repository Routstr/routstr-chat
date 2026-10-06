const IDLE_MS = 10 * 60 * 1000;

/**
 * When provider credit goes back to the wallet by itself: once when the
 * account opens in this tab (credit a closed tab left behind), on leaving a
 * chat, and after ten idle minutes. Not after every reply: each refund rounds
 * down to whole sats.
 */
export class AutoRefund {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private viewed: string | null = null;
  private stopped = false;

  constructor(private refund: () => Promise<unknown>) {}

  start(): void {
    this.run();
    this.rearm();
  }

  /** The chat on screen; leaving one refunds. */
  viewing(conversationId: string | null): void {
    const left = this.viewed !== null && this.viewed !== conversationId;
    this.viewed = conversationId;
    if (left) this.run();
    this.rearm();
  }

  /** The idle clock runs only while no reply is being paid for. */
  activity(busy: boolean): void {
    if (busy === this.busy) return;
    this.busy = busy;
    this.rearm();
  }

  dispose(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private rearm(): void {
    clearTimeout(this.timer);
    if (!this.busy && !this.stopped) {
      this.timer = setTimeout(() => this.run(), IDLE_MS);
    }
  }

  private run(): void {
    if (this.stopped) return;
    this.refund().catch((error) =>
      console.warn("Automatic refund failed; it will run again later", error)
    );
  }
}
