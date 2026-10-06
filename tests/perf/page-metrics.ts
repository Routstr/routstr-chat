// What the page itself reports: paint times, long tasks (main thread blocked > 50 ms) and
// slow interactions (event handling + next paint > 16 ms), collected from the first byte;
// frame times while asked; and the main thread's total busy time, from Chromium.
import type { BrowserContext, Page } from "@playwright/test";

declare global {
  interface Window {
    __kitPerf?: {
      fcp?: number;
      lcp?: number;
      longTasks: [number, number][];
      /** interactions over 16 ms: [start, duration] */
      events: [number, number][];
      /** frame start times, recorded between startFrames and stopFrames */
      frames?: number[];
      /** when the last click or Enter happened (a Send), page time */
      lastInput: number;
    };
  }
}

export async function collectPageMetrics(
  context: BrowserContext
): Promise<void> {
  await context.addInitScript(() => {
    const k: NonNullable<Window["__kitPerf"]> = {
      longTasks: [],
      events: [],
      lastInput: 0,
    };
    window.__kitPerf = k;
    const input = () => (k.lastInput = performance.now());
    addEventListener("click", input, true);
    addEventListener("keydown", (e) => e.key === "Enter" && input(), true);
    const watch = (
      type: string,
      fn: (e: PerformanceEntry) => void,
      extra: object = {}
    ) => {
      try {
        new PerformanceObserver((list) =>
          list.getEntries().forEach(fn)
        ).observe({ type, buffered: true, ...extra });
      } catch {
        /* not supported here */
      }
    };
    watch(
      "paint",
      (e) => e.name === "first-contentful-paint" && (k.fcp = e.startTime)
    );
    watch("largest-contentful-paint", (e) => (k.lcp = e.startTime));
    watch("longtask", (e) => k.longTasks.push([e.startTime, e.duration]));
    watch(
      "event",
      (e) => {
        const ev = e as PerformanceEntry & { interactionId?: number };
        if (ev.interactionId) k.events.push([e.startTime, e.duration]);
      },
      { durationThreshold: 16 }
    );
  });
}

/** Starts recording when each frame starts (requestAnimationFrame). */
export async function startFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const k = window.__kitPerf!;
    const frames: number[] = [];
    k.frames = frames;
    const next = (t: number) => {
      if (k.frames !== frames) return; // stopped, or started again
      frames.push(t);
      requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  });
}

/**
 * Stops recording; the time between frames from the first word on, p50, p95 and the
 * longest, in ms. `from` is when the page was seen to show it, a frame after the frame that
 * drew it, so the window opens two frames earlier. (Before that the page has nothing to
 * draw: those frames would only pull the numbers towards an idle 16.7 ms.)
 */
export async function stopFrames(
  page: Page,
  from: number
): Promise<{ p50: number; p95: number; max: number }> {
  const frames = await page.evaluate((from) => {
    const k = window.__kitPerf!;
    const all = k.frames ?? [];
    k.frames = undefined;
    const i = all.findIndex((t) => t >= from);
    return all.slice(Math.max(0, (i < 0 ? all.length : i) - 2));
  }, from);
  const gaps = frames
    .slice(1)
    .map((t, i) => t - frames[i])
    .sort((a, b) => a - b);
  const at = (q: number) =>
    Math.round(
      gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] ?? 0
    );
  return { p50: at(0.5), p95: at(0.95), max: at(1) };
}

/** A Chromium metric by name; a renamed one fails loudly instead of reading as 0. */
function metricOf(metrics: { name: string; value: number }[], name: string) {
  const m = metrics.find((m) => m.name === name);
  if (!m) throw new Error(`Chromium reports no ${name} metric`);
  return m.value;
}

/** Starts timing the page's main thread (Chromium's task time); call the result to stop. */
export async function mainThreadTimer(
  page: Page
): Promise<() => Promise<number>> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const busy = async () =>
    metricOf(
      (await cdp.send("Performance.getMetrics")).metrics,
      "TaskDuration"
    );
  const from = await busy();
  return async () => {
    const ms = Math.round(((await busy()) - from) * 1000);
    await cdp.detach();
    return ms;
  };
}

interface PageMetrics {
  fcp?: number;
  lcp?: number;
  domContentLoaded?: number;
  load?: number;
  jsHeapMb: number;
  domNodes: number;
}

export async function readPageMetrics(page: Page): Promise<PageMetrics> {
  const k = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    return {
      fcp: window.__kitPerf!.fcp,
      lcp: window.__kitPerf!.lcp,
      dcl: nav?.domContentLoadedEventEnd,
      load: nav?.loadEventEnd,
    };
  });
  const cdp = await page.context().newCDPSession(page);
  // heap and nodes counted after a collection, so garbage V8 has not swept yet adds no noise
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("Performance.enable");
  const { metrics } = await cdp.send("Performance.getMetrics");
  await cdp.detach();
  const metric = (name: string) => metricOf(metrics, name);
  return {
    fcp: k.fcp,
    lcp: k.lcp,
    domContentLoaded: k.dcl,
    load: k.load,
    jsHeapMb: metric("JSHeapUsedSize") / 1024 / 1024,
    domNodes: metric("Nodes"),
  };
}
