// Measures one build of the app, the same way every time, against the kit stack.
// Run it through the kit, which takes the heavy lock for each run and seals the network:
//
//   pnpm kit perf --driver v2|main [--out <static export dir> | --url <running app>]
//                 [--runs 5] [--label name] [--json result.json] [--compare base.json]
//                 [--spend x-cashu]   (main: pay per request instead of its default API key)
//   pnpm kit perf --compare a.json b.json        (just print the table)
//
// Every run is a fresh browser (no cache, no storage) and goes through the same steps a
// person takes. A step's time runs from the action to what the person would see: reply
// times in the page's own clock (from the Send click to the frame the text shows), other
// steps around the driver, whose waits end within 50 ms (tests/app/drivers/wait.ts). The
// result keeps every run with the free memory and load at its start, the median and the
// slowest.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateSecretKey, nip19 } from "nostr-tools";
import { chromium, type Page } from "@playwright/test";
import { kitClient, type KitClient } from "../kit/client";
import { chromiumPath, PROVIDER_ALIAS, seal } from "../kit/net";
import { serveStatic } from "../kit/services/static";
import { startStack } from "../kit/stack";
import { addAccount, seedKitProvider } from "../app/seed";
import { bundleSize, type BundleSize } from "./bundle";
import { drivers, type Driver } from "../app/drivers";
import { textShown } from "../app/drivers/wait";
import {
  collectPageMetrics,
  mainThreadTimer,
  readPageMetrics,
  startFrames,
  stopFrames,
} from "./page-metrics";

type Sample = Record<string, number | undefined>;

interface PerfResult {
  label: string;
  driver: string;
  at: string;
  /** what was measured: the app's commit and SDK version, core's commit, this kit's commit
   *  (each "+<hash>" when it had uncommitted changes), and main's pay mode */
  versions: {
    app?: string;
    sdk?: string;
    core?: string;
    kit?: string;
    spend?: string;
  };
  runs: Sample[];
  median: Sample;
  worst: Sample;
  bundle?: BundleSize;
}

/** The machine's load average over the last minute, so a busy run shows in its numbers. */
const load1 = () => Math.round(os.loadavg()[0] * 10) / 10;

const freeMb = () =>
  Math.round(
    Number(
      fs
        .readFileSync("/proc/meminfo", "utf8")
        .match(/MemAvailable:\s+(\d+)/)![1]
    ) / 1024
  );

/** Milliseconds `fn` takes. */
async function time(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return Math.round(performance.now() - t0);
}

// a reply long enough to stream in steps: 41 words, 25 ms apart upstream (about 1 s). Each
// reply starts and ends with its own number, so a wait never matches an earlier reply.
const REPLY_WORDS = Array.from({ length: 39 }, (_, i) => `word${i}`).join(" ");
const LONG_PROMPT =
  "[kit:chunk=2] [kit:usage=10,10] [kit:md=4600] a long answer";
const PROMPT = (n: number) =>
  `[kit:chunk=25] [kit:text=start${n} ${REPLY_WORDS} end${n}] question ${n}`;

/** The page's clock now, so a step can take only the records that start after it. */
const mark = (page: Page) =>
  page.evaluate(() => ({
    origin: performance.timeOrigin,
    at: performance.now(),
  }));

/**
 * The slowest interaction (event to next paint), the main-thread blocking and the long tasks
 * that started since `from`. Waits two frames first: the browser reports these a frame or
 * more after they happen.
 */
const since = (page: Page, from: Awaited<ReturnType<typeof mark>>) =>
  page.evaluate(async (from) => {
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r))
    );
    const k = window.__kitPerf!;
    // a reload starts the page's clock and records again: then all of them are this step's
    const start = performance.timeOrigin === from.origin ? from.at : 0;
    const events = k.events.filter(([t]) => t >= start);
    const tasks = k.longTasks.filter(([t]) => t >= start);
    return {
      inp: Math.max(0, ...events.map(([, d]) => d)),
      blocked: tasks.reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0),
      longTasks: tasks.length,
    };
  }, from);

/** The page time of the last click or Enter (a Send), recorded by collectPageMetrics. */
const lastInput = (page: Page) =>
  page.evaluate(() => window.__kitPerf!.lastInput);

/**
 * The same reply straight from core, no app: first byte and full reply for each pay path,
 * so app numbers can be read against what the provider itself costs.
 */
async function coreOnly(kit: KitClient, s: Sample) {
  const reply = async (auth: Record<string, string>) => {
    const t0 = Date.now();
    const res = await fetch(`${kit.coreUrl}v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({
        model: "kit-cheap",
        messages: [{ role: "user", content: PROMPT(0) }],
        stream: true,
      }),
    });
    if (!res.ok) throw new Error(`core answered ${res.status}`);
    const reader = res.body!.getReader();
    await reader.read();
    const firstByte = Date.now() - t0;
    while (!(await reader.read()).done);
    return { firstByte, full: Date.now() - t0 };
  };
  const record = (name: string, t: { firstByte: number; full: number }) => {
    s[`core.${name}.firstByte`] = t.firstByte;
    s[`core.${name}.full`] = t.full;
  };
  // untimed: a fresh core opens its wallet and loads the mint on its first payment
  await reply({ "X-Cashu": await kit.mintToken(50) });
  record("xcashu", await reply({ "X-Cashu": await kit.mintToken(50) }));
  const key = await fetch(`${kit.coreUrl}v1/wallet/info`, {
    headers: { authorization: `Bearer ${await kit.mintToken(50)}` },
  });
  if (!key.ok) throw new Error(`core answered ${key.status} to a new key`);
  const auth = {
    authorization: `Bearer ${((await key.json()) as { api_key: string }).api_key}`,
  };
  record("apikey", await reply(auth));
}

async function oneRun(
  driver: Driver,
  kit: KitClient,
  appUrl: string,
  spend?: string
): Promise<Sample> {
  const browser = await chromium.launch({
    executablePath: chromiumPath(),
    headless: true,
  });
  const s: Sample = { freeMb: freeMb(), load1: load1() };
  try {
    await coreOnly(kit, s);
    const context = await browser.newContext({ serviceWorkers: "block" });
    const sealed = await seal(context, kit.env, appUrl);
    await collectPageMetrics(context);
    // main's Settings → Spend mode (API key by default); v2 ignores it
    if (spend)
      await context.addInitScript((mode) => {
        if (!localStorage.getItem("spendMode"))
          localStorage.setItem("spendMode", JSON.stringify(mode));
      }, spend);
    const page = await context.newPage();
    // every request the app makes, by service: how many calls each step costs
    const calls = {
      mint: 0,
      core: 0,
      get relayMsgs() {
        return sealed.relayMessages;
      },
    };
    const mintOrigins = [kit.env.mintUrl, kit.env.invoiceMintUrl];
    context.on("request", (r) => {
      const url = r.url();
      if (mintOrigins.some((m) => url.startsWith(m))) calls.mint++;
      else if (url.startsWith(kit.coreUrl) || url.startsWith(PROVIDER_ALIAS))
        calls.core++;
    });

    /** Times one step a person takes, plus how responsive the page was during it. */
    const step = async (name: string, fn: () => Promise<unknown>) => {
      const from = await mark(page);
      const c0 = { ...calls };
      s[name] = await time(fn);
      s[`${name}.mintCalls`] = calls.mint - c0.mint;
      s[`${name}.coreCalls`] = calls.core - c0.core;
      s[`${name}.relayMsgs`] = calls.relayMsgs - c0.relayMsgs;
      const after = await since(page, from);
      s[`${name}.inp`] = after.inp;
      s[`${name}.blockedMs`] = Math.round(after.blocked);
      s[`${name}.longTasks`] = after.longTasks;
    };
    const heap = async (name: string) => {
      const m = await readPageMetrics(page);
      s[`${name}.jsHeapMb`] = Math.round(m.jsHeapMb * 10) / 10;
      s[`${name}.domNodes`] = m.domNodes;
    };

    // first visit: until the composer can take a message, and what the page itself reports
    // (main's top-up prompt, which opens itself half a second later, is closed after)
    await step("firstLoad", async () => {
      await page.goto(appUrl);
      await driver.loaded(page);
    });
    const load = await readPageMetrics(page);
    Object.assign(s, {
      fcp: load.fcp && Math.round(load.fcp),
      lcp: load.lcp && Math.round(load.lcp),
      domContentLoaded:
        load.domContentLoaded && Math.round(load.domContentLoaded),
      loadEvent: load.load && Math.round(load.load),
      "afterLoad.jsHeapMb": Math.round(load.jsHeapMb * 10) / 10,
      "afterLoad.domNodes": load.domNodes,
    });
    await driver.ready(page);

    const nsec = nip19.nsecEncode(generateSecretKey());
    await step("signIn", () => driver.signIn(page, nsec));
    await seedKitProvider(page, kit.coreUrl, "kit-cheap");
    await driver.ready(page);
    const funds = await kit.mintToken(500);
    await step("walletReceive", () => driver.receive(page, funds));
    await driver.useMint(page, kit.env.mintUrl);

    /**
     * One reply, timed in the page's clock from the Send click: until `first` shows in it,
     * until `last` does, and until the composer can send again; and when core forwarded the
     * paid request upstream.
     */
    const reply = async (
      name: string,
      prompt: string,
      first: string,
      last: string
    ) => {
      const before = (await kit.upstream.requests()).length;
      const from = await mark(page);
      const c0 = { ...calls };
      await driver.send(page, prompt);
      const sent = await lastInput(page);
      const at = (t: number) => Math.round(t - sent);
      const shownAt = await textShown(page, driver.replies, first);
      s[`${name}.firstToken`] = at(shownAt);
      s[`${name}.full`] = at(await textShown(page, driver.replies, last));
      await driver.waitIdle(page);
      s[`${name}.idle`] = at(await page.evaluate(() => performance.now()));
      const paidAt = (await kit.upstream.requests())[before]?.at;
      s[`${name}.sendToPaid`] =
        paidAt && Math.round(paidAt - from.origin - sent);
      s[`${name}.mintCalls`] = calls.mint - c0.mint;
      s[`${name}.coreCalls`] = calls.core - c0.core;
      s[`${name}.relayMsgs`] = calls.relayMsgs - c0.relayMsgs;
      const after = await since(page, from);
      s[`${name}.inp`] = after.inp;
      s[`${name}.blockedMs`] = Math.round(after.blocked);
      s[`${name}.longTasks`] = after.longTasks;
      return shownAt;
    };

    // three replies; the first pays cold (a new key at the provider), the others warm
    for (let i = 1; i <= 3; i++)
      await reply(`reply${i}`, PROMPT(i), `start${i}`, `end${i}`);
    await heap("afterReplies");

    // rendering a long streamed reply: about 4,600 words of markdown, a word every 2 ms
    // upstream (usage pinned small, so it costs what a short reply does). Frame times,
    // long tasks and the main thread's total busy time from send until it is idle again.
    {
      const busy = await mainThreadTimer(page);
      await startFrames(page);
      const shownAt = await reply(
        "longReply",
        LONG_PROMPT,
        "startlong",
        "endlong"
      );
      const frames = await stopFrames(page, shownAt);
      s["longReply.frameP50"] = frames.p50;
      s["longReply.frameP95"] = frames.p95;
      s["longReply.frameMax"] = frames.max;
      s["longReply.mainThreadMs"] = await busy();
    }
    await heap("afterLongReply");

    const invoice = await kit.invoice(10);
    await step("walletPay", () => driver.payInvoice(page, invoice));
    await step("walletMakeToken", () => driver.makeToken(page, 5));
    await addAccount(page, nip19.nsecEncode(generateSecretKey()));
    await driver.ready(page);
    // to the other key, until it is active and the app takes a message
    await step("accountSwitch", () => driver.switchAccount(page));
    await heap("end");
    await context.close();

    // history on a new device: sign in with the same key, until the chat is listed (all four
    // replies, the long one included, went into one chat)
    const fresh = await browser.newContext({ serviceWorkers: "block" });
    await seal(fresh, kit.env, appUrl);
    const second = await fresh.newPage();
    await driver.open(second, appUrl);
    s.historyLoad = await time(async () => {
      await driver.signIn(second, nsec);
      await driver.waitChats(second, 1);
    });
    await fresh.close();
  } finally {
    await browser.close();
  }
  return s;
}

function versions(
  outDir?: string,
  spend?: string,
  json?: string
): PerfResult["versions"] {
  const git = (dir: string, ...args: string[]) =>
    spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" }).stdout;
  // the commit, plus "+" and a hash of what was changed or added on top of it, so two
  // different edits never look the same; left out: next-env.d.ts (every next build rewrites
  // it) and this run's own results file
  const commit = (dir: string) => {
    const head = git(dir, "rev-parse", "--short", "HEAD").trim();
    if (!head) return undefined;
    const diff = git(dir, "diff", "HEAD", "--", ".", ":!next-env.d.ts");
    const added = git(dir, "ls-files", "-o", "--exclude-standard")
      .split("\n")
      .filter((f) => f && path.resolve(dir, f) !== json);
    if (!diff && !added.length) return head;
    const hash = createHash("sha1").update(diff);
    for (const f of added)
      hash.update(f).update(fs.readFileSync(path.join(dir, f)));
    return `${head}+${hash.digest("hex").slice(0, 7)}`;
  };
  const app = outDir && path.resolve(outDir, "..");
  let sdk: string | undefined;
  if (app)
    sdk = JSON.parse(
      fs.readFileSync(
        path.join(app, "node_modules", "@routstr", "sdk", "package.json"),
        "utf8"
      )
    ).version;
  const core = process.env.KIT_CORE_DIR;
  return {
    app: app && commit(app),
    sdk,
    core: core && commit(core),
    kit: commit(path.resolve(__dirname, "../..")),
    spend,
  };
}

function summarize(
  runs: Sample[],
  pick: (values: number[], key: string) => number
): Sample {
  const keys = [...new Set(runs.flatMap(Object.keys))];
  return Object.fromEntries(
    keys.map((k) => {
      const values = runs
        .map((r) => r[k])
        .filter((v): v is number => typeof v === "number");
      return [
        k,
        values.length
          ? pick(
              values.sort((a, b) => a - b),
              k
            )
          : undefined,
      ];
    })
  );
}
const median = (v: number[]) => v[Math.floor((v.length - 1) / 2)];
// the worst of everything is its highest, except free memory, which is its lowest
const worst = (v: number[], key: string) =>
  key === "freeMb" ? v[0] : v[v.length - 1];

function table(results: PerfResult[]): string {
  const keys = [...new Set(results.flatMap((r) => Object.keys(r.median)))];
  const head = `| measure | ${results.map((r) => `${r.label} median (worst)`).join(" | ")} |`;
  const rows = keys.map(
    (k) =>
      `| ${k} | ${results.map((r) => (r.median[k] === undefined ? "n/a" : `${r.median[k]} (${r.worst[k]})`)).join(" | ")} |`
  );
  const bundle = results.some((r) => r.bundle)
    ? (
        ["homeJsGzip", "homeCssGzip", "jsGzip", "cssGzip", "jsBytes"] as const
      ).map(
        (k) =>
          `| bundle.${k} (KB) | ${results.map((r) => (r.bundle ? Math.round(r.bundle[k] / 1024) : "n/a")).join(" | ")} |`
      )
    : [];
  const version = (["app", "sdk", "core", "kit", "spend"] as const).map(
    (k) =>
      `| ${k} | ${results.map((r) => r.versions?.[k] ?? "n/a").join(" | ")} |`
  );
  return [
    head,
    `|---|${results.map(() => "---").join("|")}|`,
    ...version,
    ...rows,
    ...bundle,
  ].join("\n");
}

async function main(argv: string[]) {
  const arg = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const read = (file: string) =>
    JSON.parse(fs.readFileSync(file, "utf8")) as PerfResult;
  if (!arg("driver")) {
    console.log(table(argv.filter((a) => a.endsWith(".json")).map(read)));
    return;
  }
  // --driver core: no app, just core's own times for each pay path (no browser)
  const coreOnlyRun = arg("driver") === "core";
  const driver = drivers[arg("driver")!];
  if (!coreOnlyRun && !driver)
    throw new Error(
      `no driver ${arg("driver")}; have core, ${Object.keys(drivers).join(", ")}`
    );
  const outDir = arg("out");
  const json = arg("json");
  // --json names a file that collects runs: each call adds its runs to it, and only runs of
  // the same driver on the same code may share one median
  const fresh: PerfResult = {
    label: arg("label") ?? arg("driver")!,
    driver: arg("driver")!,
    at: new Date().toISOString(),
    versions: versions(outDir, arg("spend"), json && path.resolve(json)),
    runs: [],
    median: {},
    worst: {},
  };
  const result = json && fs.existsSync(json) ? read(json) : fresh;
  for (const k of ["driver", "versions"] as const)
    if (JSON.stringify(result[k]) !== JSON.stringify(fresh[k]))
      throw new Error(
        `${json} holds runs of ${JSON.stringify(result[k])}, not ${JSON.stringify(fresh[k])}: use another --json`
      );

  const stack = await startStack({ log: (l) => console.log(`[perf] ${l}`) });
  const server = outDir ? await serveStatic(path.resolve(outDir)) : undefined;
  const appUrl = arg("url") ?? server?.url;
  try {
    if (outDir) result.bundle ??= bundleSize(path.resolve(outDir));
    for (let i = 0, runs = Number(arg("runs") ?? 1); i < runs; i++) {
      const sample: Sample = coreOnlyRun
        ? { freeMb: freeMb(), load1: load1() }
        : await oneRun(driver, kitClient(stack.env), appUrl!, arg("spend"));
      if (coreOnlyRun) await coreOnly(kitClient(stack.env), sample);
      console.log(
        `[perf] run ${result.runs.length + 1}: ${JSON.stringify(sample)}`
      );
      result.runs.push(sample);
    }
  } finally {
    await server?.close();
    await stack.stop();
  }
  result.median = summarize(result.runs, median);
  result.worst = summarize(result.runs, worst);
  if (json) fs.writeFileSync(json, JSON.stringify(result, null, 2));
  const base = arg("compare");
  console.log(table(base ? [read(base), result] : [result]));
}

main(process.argv.slice(2)).catch((e) => {
  console.error(`[perf] ${(e as Error).stack}`);
  process.exit(1);
});
