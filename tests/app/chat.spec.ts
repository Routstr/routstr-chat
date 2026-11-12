import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedKitProvider } from "./seed";

test("pays for a reply through routstr-core and keeps the change", async ({
  page,
  kit,
  appUrl,
}) => {
  await kit.upstream.reset();
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");
  await v2.fund(page, appUrl, await kit.mintToken(300));
  expect(await v2.balance(page)).toBe(300);

  // a fixed, tiny usage: well under one sat, so core charges exactly one whole sat
  await v2.send(page, "[kit:usage=10,10] hello kit");
  await v2.waitReplyText(page, "Echo: hello kit");
  expect((await kit.upstream.requests()).map((r) => r.outcome)).toEqual(["ok"]);

  // the change is kept: 299, not 300 minus the whole token the reply carried
  // (with an API key, the default, it waits on the key until it is returned)
  await v2.returnCredit(page);
  await expect.poll(() => v2.balance(page), { timeout: 20_000 }).toBe(299);
  // and it is spendable money, not a number: all of it redeems at the mint
  await v2.useMint(page, kit.env.mintUrl);
  expect(await kit.redeem(await v2.makeToken(page, 299))).toBe(299);
});

test("an html answer runs in a box of its own: it cannot reach the app's storage or page, and a game in it can hold the mouse", async ({
  page,
  kit,
  appUrl,
}) => {
  // the page tries the app's storage, its window and the top address, and writes what it found
  const html = [
    "<!DOCTYPE html>",
    "<html><head><title>Probe Page</title></head><body><h1>Probe</h1><p id=\"r\"></p><a id=\"jump\" href=\"#end\">end</a><button id=\"lock\">play</button><p id=\"l\"></p><script>",
    "const out = [];",
    "try { out.push('parent:' + parent.document.title); } catch { out.push('parent:blocked'); }",
    "out.push('secret:' + (localStorage.getItem('kit-secret') ?? 'none'));",
    "localStorage.setItem('own', '1'); out.push('own:' + localStorage.getItem('own'));",
    "try { indexedDB.open('routstr'); out.push('idb:open'); } catch { out.push('idb:blocked'); }",
    "try { top.location.href = 'about:blank'; out.push('top:moved'); } catch { out.push('top:blocked'); }",
    "out.push('origin:' + origin);",
    "document.getElementById('r').textContent = out.join(' ');",
    "const l = document.getElementById('l');",
    "document.addEventListener('pointerlockchange', () => { l.textContent = document.pointerLockElement ? 'locked' : 'free'; });",
    "document.addEventListener('pointerlockerror', () => { l.textContent = 'blocked'; });",
    "document.getElementById('lock').onclick = () => document.body.requestPointerLock()?.catch?.(() => {});",
    "</script><p id=\"end\">the end</p></body></html>",
  ].join("\n");
  await kit.upstream.reset();
  await v2.open(page, appUrl);
  await page.evaluate(() => localStorage.setItem("kit-secret", "app-only"));
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");
  await v2.fund(page, appUrl, await kit.mintToken(300));
  await kit.upstream.queue({
    text: `Here it is:\n\n\`\`\`html\n${html}\n\`\`\`\n\n${"It writes what it can reach into the page. ".repeat(6)}`,
    usage: { prompt: 10, completion: 10 },
    chunkMs: 60,
  });
  await v2.send(page, "make a probe page");

  // while the answer still arrives, its whole page waits: the finished answer is drawn anew
  const fig = page.locator(v2.replies).last().locator(".rd-code");
  await expect(fig.getByText("Probe Page")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("main").getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(fig.getByRole("button", { name: "Preview" })).toHaveCount(0);
  await v2.waitIdle(page);

  await fig.getByRole("button", { name: "Preview" }).click();
  const box = fig.locator("iframe.rd-page");
  const inside = box.contentFrame();
  await expect(inside.locator("#r")).toHaveText(
    "parent:blocked secret:none own:1 idb:blocked top:blocked origin:null"
  );
  expect(page.url()).toContain(new URL(appUrl).host);
  // the box takes the page's own height, not its default 320px
  await expect.poll(async () => (await box.boundingBox())?.height ?? 0).toBeLessThan(200);
  // its own "#" link stays in the page, where it loaded the app into the box
  await inside.locator("#jump").click();
  await expect(inside.locator("#r")).toHaveText(/^parent:blocked/);
  // a game takes the mouse when played (a click), and gives it back
  await inside.locator("#lock").click();
  await expect(inside.locator("#l")).toHaveText("locked");
  await inside.locator("body").evaluate(() => document.exitPointerLock());
  await expect(inside.locator("#l")).toHaveText("free");

  // over the window, named by the app, then Esc
  await fig.getByRole("button", { name: "Full screen" }).click();
  const dialog = page.getByRole("dialog", { name: "Page from the answer" });
  await expect(dialog.getByText("Page from the answer")).toBeVisible();
  await expect(dialog.locator("iframe").contentFrame().locator("h1")).toHaveText("Probe");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // saved as the page wrote it, named after its title
  const [file] = await Promise.all([page.waitForEvent("download"), fig.getByRole("button", { name: "Save page" }).click()]);
  expect(file.suggestedFilename()).toBe("probe-page.html");
  expect(await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString())).toBe(html);
});
