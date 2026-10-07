// What `perf --detail` keeps besides the numbers, to name causes: each step's relay messages
// by relay, type and kind; each reply's timeline from its Send (network calls, relay messages,
// when core paid upstream); and where the page's main thread went (a CPU profile: the
// functions busiest by their own time and with what they call, in the windows asked for). A
// detail run is slowed by the profiler: read its causes, not its times.
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import type { RelayFrame } from "../kit/net";

export interface NetCall {
  /** Date.now() at the request, and when its response ended */
  at: number;
  end?: number;
  method: string;
  url: string;
  status?: number | "failed";
}

/** Every request the context makes, with when it started and ended. */
export function recordNetwork(context: BrowserContext): NetCall[] {
  const all: NetCall[] = [];
  const open = new WeakMap<object, NetCall>();
  context.on("request", (r) => {
    const call = { at: Date.now(), method: r.method(), url: r.url() };
    open.set(r, call);
    all.push(call);
  });
  context.on("requestfinished", async (r) => {
    const call = open.get(r);
    if (!call) return;
    call.end = Date.now();
    call.status = (await r.response())?.status();
  });
  context.on("requestfailed", (r) => {
    const call = open.get(r);
    if (call) Object.assign(call, { end: Date.now(), status: "failed" });
  });
  return all;
}

const kindsOf = (f: RelayFrame) =>
  f.kinds.length ? ` kind ${[...new Set(f.kinds)].join(",")}` : "";

/** Relay messages between two times (Date.now()), counted every way the question needs. */
export function relaySummary(frames: RelayFrame[], from: number, to: number) {
  const inside = frames.filter((f) => f.at >= from && f.at <= to);
  const count = (key: (f: RelayFrame) => string) => {
    const counts: Record<string, number> = {};
    for (const f of inside) counts[key(f)] = (counts[key(f)] ?? 0) + 1;
    return Object.fromEntries(
      Object.entries(counts).sort((a, b) => b[1] - a[1])
    );
  };
  return {
    sent: inside.filter((f) => f.dir === "out").length,
    received: inside.filter((f) => f.dir === "in").length,
    byType: count((f) => `${f.dir} ${f.type}`),
    byKind: count((f) => `${f.dir} ${f.type}${kindsOf(f)}`),
    byRelay: count((f) => `${f.relay} ${f.dir} ${f.type}${kindsOf(f)}`),
  };
}

/** Network calls and relay messages from `from` to `to`, in ms after `from`, in order. */
export function timeline(
  calls: NetCall[],
  frames: RelayFrame[],
  from: number,
  to: number,
  name: (url: string) => string
) {
  return [
    ...calls
      .filter((c) => c.at >= from && c.at <= to)
      .map((c) => ({
        t: c.at - from,
        what: `${c.method} ${name(c.url)}`,
        ms: c.end === undefined ? undefined : c.end - c.at,
        status: c.status,
      })),
    ...frames
      .filter((f) => f.at >= from && f.at <= to)
      .map((f) => ({
        t: f.at - from,
        what: `relay ${f.dir} ${f.type}${kindsOf(f)} (${f.relay})`,
      })),
  ].sort((a, b) => a.t - b.t);
}

interface ProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  children?: number[];
}
interface Profile {
  nodes: ProfileNode[];
  startTime: number;
  samples: number[];
  timeDeltas: number[];
}

/** A window of page time (performance.now()) to say where the main thread went in. */
export interface Window {
  name: string;
  from: number;
  to: number;
}

const IDLE = new Set(["(root)", "(program)", "(idle)"]);

/**
 * Starts sampling the page's JavaScript; the result stops it and, for each window, lists
 * the functions with the most time of their own and the most time including what they
 * called. `outDir` (the served build) adds a few characters of code at each function, since
 * a production build's names are short.
 */
export async function startProfile(page: Page, outDir?: string) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  // the profile's clock starts here; this is the same moment in the page's clock
  const pageAt = await page.evaluate(() => performance.now());
  await cdp.send("Profiler.start");
  return async (windows: Window[]) => {
    const { profile } = (await cdp.send("Profiler.stop")) as {
      profile: Profile;
    };
    await cdp.detach();
    return analyse(profile, pageAt, windows, outDir);
  };
}

function analyse(
  profile: Profile,
  pageAt: number,
  windows: Window[],
  outDir?: string
) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of profile.nodes)
    for (const c of n.children ?? []) parent.set(c, n.id);
  const sources = new Map<string, string[]>();
  const snippet = ({
    url,
    lineNumber,
    columnNumber,
  }: ProfileNode["callFrame"]) => {
    if (!outDir || !url) return undefined;
    const file = path.join(outDir, new URL(url).pathname);
    if (!sources.has(file))
      sources.set(
        file,
        fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : []
      );
    const line = sources.get(file)![lineNumber];
    return line?.slice(Math.max(0, columnNumber - 20), columnNumber + 60);
  };
  const label = (n: ProfileNode) => {
    const f = n.callFrame;
    const file = f.url ? path.basename(new URL(f.url).pathname) : "";
    return `${f.functionName || "(anonymous)"} ${file}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
  };
  // each sample's page time and how long it stands for (the gap to the next one)
  let t = profile.startTime;
  const samples = profile.samples.map((id, i) => {
    t += profile.timeDeltas[i];
    return {
      id,
      at: pageAt + (t - profile.startTime) / 1000,
      ms: (profile.timeDeltas[i + 1] ?? 500) / 1000,
    };
  });
  const top = (counts: Map<string, { ms: number; node: ProfileNode }>) =>
    [...counts.entries()]
      .sort((a, b) => b[1].ms - a[1].ms)
      .slice(0, 8)
      .map(([name, { ms, node }]) => ({
        ms: Math.round(ms),
        name,
        code: snippet(node.callFrame),
      }));
  return windows.map((w) => {
    const self = new Map<string, { ms: number; node: ProfileNode }>();
    const total = new Map<string, { ms: number; node: ProfileNode }>();
    let busy = 0;
    for (const s of samples) {
      if (s.at < w.from || s.at > w.to) continue;
      const node = byId.get(s.id)!;
      if (IDLE.has(node.callFrame.functionName)) continue;
      busy += s.ms;
      const add = (m: typeof self, n: ProfileNode) => {
        const k = label(n);
        m.set(k, { ms: (m.get(k)?.ms ?? 0) + s.ms, node: n });
      };
      add(self, node);
      // with what it called: each function on the stack once
      const seen = new Set<string>();
      for (
        let id: number | undefined = s.id;
        id !== undefined;
        id = parent.get(id)
      ) {
        const n = byId.get(id)!;
        if (IDLE.has(n.callFrame.functionName) || seen.has(label(n))) continue;
        seen.add(label(n));
        add(total, n);
      }
    }
    return {
      window: w.name,
      ms: Math.round(w.to - w.from),
      jsMs: Math.round(busy),
      self: top(self),
      withCallees: top(total),
    };
  });
}
