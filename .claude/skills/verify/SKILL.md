---
name: verify
description: Prove a routstr-chat change works in the running app before it is committed - the kit's real routstr-core, mints and relay with a fake AI, the built app driven in Chromium, screenshots at phone and desktop width. Use before committing app code, and to show a bug failing on the old build before fixing it.
---

# Verify a change

The kit (`tests/kit`, see AGENTS.md) runs the app against real services: routstr-core,
nutshell mints, a relay, and a model upstream that echoes. Only the AI and Lightning
(FakeWallet) are fake. Say so in the report.

## Setup, once per machine

As in AGENTS.md (`pnpm install`, `KIT_CORE_DIR`), and:

- Node 24 or newer. The money tests need `navigator.locks`; on Node 22 they fail with "This
  browser cannot safely coordinate payments across tabs".
- The `sqlite3` command: a money test edits core's database with it.
- Where the default Python is 3.13, coincurve does not build: use
  `uv sync --frozen --no-dev --python 3.12` in the core checkout, and `export UV_PYTHON=3.12`
  for the kit's mints.
- Where `unshare -rn` cannot seal the network (a cloud container has no `ip`): first, with the
  proxy still set, fetch the mint once with
  `uvx --from cashu==0.20.0 --with "marshmallow<4" --with "limits<4" cashu --help`. Then run
  every kit command as
  `env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy KIT_NO_SEAL=1 KIT_LIGHT_LOCK= KIT_HEAVY_LOCK= pnpm …`.
  If Playwright's own Chromium is missing, set `KIT_CHROMIUM` to one
  (`/opt/pw-browsers/chromium-*/chrome-linux64/chrome`).

## 1. Pick the checks from the diff

The whole unit run takes minutes per keyset mode, so run what the diff reaches:

- Any code: `pnpm exec tsc --noEmit -p .` and `pnpm lint`.
- Money code (`features/wallet`, `features/book`, `features/payments`, `platform/wallet`,
  `runtime`): `pnpm test unit` and `KIT_KEYSETS=v2 pnpm test unit`.
- Other code: `pnpm test unit <folder>` for each folder it changes. When you can't tell what
  a change reaches, run `pnpm test unit`.
- A screen or a flow a person sees: its area's spec
  (`pnpm test app tests/app/<area>.spec.ts`) and step 2.

## 2. Look at it in the app

    cp tests/app/verify.template.ts tests/app/zz-verify.spec.ts

Write in it the steps a person takes to reach the change, and what they must see. Then:

    pnpm test app tests/app/zz-verify.spec.ts

The first run builds the app (about 1.5 min, reused until a source file changes). Each run
starts the stack, takes the steps (about 20 s) and saves `test-results/verify/<name>-phone.png`
and `<name>-desktop.png`. Open the screenshots and look: a test can pass on a broken screen.
For a UI change, give the person the screenshots. They judge the look.

The drivers in `tests/app/drivers/v2.ts` already take the common steps (open, fund, signIn,
receive, send, makeToken, payInvoice, returnCredit and more). `kit` makes tokens and invoices
and queues upstream replies (`kit.upstream.queue`). The drivers read the desktop layout, so take
the steps at desktop width and let `shots` take the phone picture.

## 3. A bug fix fails first on the old build

Before you fix a bug, show it on the code from before the fix, the way the person hit it:

    base=../verify-base-$(git rev-parse --short <commit before the fix>)
    git worktree add $base <commit before the fix>
    (cd $base && pnpm install --frozen-lockfile)
    pnpm kit build $base
    KIT_APP_OUT=$base/out pnpm test app tests/app/zz-verify.spec.ts

It must fail there for the reason the person hit, and pass on this checkout. For a money or
unit fix, copy the new test into `$base` and run it there.

## 4. When a check fails

- Fix the code, never the check. No sleeps, retries, skips or looser asserts to make it pass.
- Re-run only what failed.
- If it still fails after 3 rounds of fixes, stop. Bring the person the failing output, the
  screenshot and what you tried.
- If it fails on main as well, call it pre-existing, with the main run as proof, and leave it
  out of this change.

## 5. Report and clean up

- Say what ran and the pass counts, and what was real and what was faked. Attach the
  screenshots for a UI change.
- Delete `tests/app/zz-verify.spec.ts`. If it guards a bug that reached people, move the test
  into the spec of that area instead. A small fix gets no new spec file.
- Remove the base worktree, also when you stopped early: `git worktree remove --force $base`
  (`--force`, as the build rewrites `next-env.d.ts` in it).
