import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutoRefund } from "../autoRefund";

const MINUTE = 60_000;

let refund: ReturnType<typeof vi.fn>;
let auto: AutoRefund;

beforeEach(() => {
  vi.useFakeTimers();
  refund = vi.fn(async () => {});
  auto = new AutoRefund(refund);
});

describe("AutoRefund", () => {
  it("refunds once when the account opens, for credit a closed tab left", () => {
    auto.start();
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it("refunds on leaving a chat, not on opening the first one", () => {
    auto.viewing("a");
    expect(refund).not.toHaveBeenCalled();

    auto.viewing("a");
    expect(refund).not.toHaveBeenCalled();

    auto.viewing("b");
    expect(refund).toHaveBeenCalledTimes(1);

    auto.viewing(null);
    expect(refund).toHaveBeenCalledTimes(2);
  });

  it("refunds after ten idle minutes, counting from the last activity", () => {
    auto.start();
    refund.mockClear();

    vi.advanceTimersByTime(9 * MINUTE);
    auto.viewing("a");
    vi.advanceTimersByTime(9 * MINUTE);
    expect(refund).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1 * MINUTE);
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it("does not count time while a reply is being paid for", () => {
    auto.start();
    refund.mockClear();

    auto.activity(true);
    vi.advanceTimersByTime(30 * MINUTE);
    expect(refund).not.toHaveBeenCalled();

    auto.activity(false);
    vi.advanceTimersByTime(10 * MINUTE);
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it("stops for good when the account is put away", () => {
    auto.start();
    refund.mockClear();

    auto.dispose();
    auto.viewing("a");
    auto.viewing("b");
    vi.advanceTimersByTime(60 * MINUTE);

    expect(refund).not.toHaveBeenCalled();
  });

  it("keeps going after a refund fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    refund.mockRejectedValueOnce(new Error("provider down"));

    auto.start();
    await vi.runOnlyPendingTimersAsync();

    expect(refund).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
  });
});
