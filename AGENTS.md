# AGENTS.md

Routstr Chat (v2): a client-only Next.js app (`output: "export"`, no server routes) for
chatting with AI models paid per request in Cashu ecash, through `@routstr/sdk`. Nostr relays
keep each account's chats, wallet backup and provider keys.

## Commands

- `pnpm install`, then `pnpm dev` on http://localhost:3001.
- `pnpm build` writes the static site to `out/` (webpack). For a sub-path, set it at build
  time: `NEXT_PUBLIC_BASE_PATH=/v2 pnpm build`.
- Types: `pnpm exec tsc --noEmit -p .`
- Lint: `pnpm lint`. It must end with 0 errors and 0 warnings. The code has no
  `eslint-disable` comments; fix the code instead of adding one or loosening a rule.

## Tests (`tests/kit`)

The kit runs the tests against local services: FakeWallet mints, a relay, a fake model
upstream and a real routstr-core. The browser and routstr-core are sealed from the internet.

- `pnpm test unit [filter]`: vitest, both projects. `unit` needs nothing outside;
  `money` (`*.mint.test.ts`) runs against the kit's mints, relay and routstr-core.
- `KIT_KEYSETS=v2 pnpm test unit`: the same with new-style keyset ids on the main mint. Run
  both modes when you touch money code.
- `pnpm test app [spec | -g name]`: builds the app and runs the Playwright specs in
  `tests/app`.
- Money and in-app tests need `KIT_CORE_DIR=<a routstr-core checkout>` with a `.venv` made
  by `uv sync --frozen --no-dev` in it.
- `pnpm kit mutate <file>` breaks code on purpose to check the tests notice;
  `pnpm kit perf` measures the app.
- `tests/live` spends real sats from a test account. A person runs it by hand with
  `LIVE_SECRET` and `LIVE_APP_OUT` (see its header). It is never part of the kit.

## Layout

- `app/`: the Next.js entry. Only `app/` mounts the runtime.
- `components/v2/`: the screens.
- `features/<name>/`: book, catalog, chat, history, keys, node, payments, relays, session,
  wallet. Rules and services are plain TypeScript; the screens read a feature through its
  `view.ts`. What a feature needs from outside is declared in its `ports.ts`.
- `platform/`: the outside world behind those ports (relays, the SDK, files, the node, the
  wallet's storage).
- `runtime/`: the composition root. It builds the platform and fills each feature's ports,
  per account.
- `tests/`: `app` (Playwright specs), `kit` (runner and local services), `perf`, `live`.
- `hooks/`, `utils/`, `context/` and parts of `lib/` and `components/` come from the
  previous app. The `LEGACY` list in `eslint.config.mjs` names what the screens still use
  from them; that list only shrinks.

## Import rules (enforced by `eslint.config.mjs`)

- Besides packages, `components/v2` imports only `components/v2`, a feature's
  `view.ts(x)` and `copy.ts`, `types/`, `lib/base.ts` and the `LEGACY` files.
- `features/` never imports `platform/`, `runtime/`, `components/` or `app/`.
- `platform/` sees a feature only through its `ports.ts` and `types.ts`.
- `components/v2`, `features/` and `platform/` never import `runtime/`; `app/` mounts it.
- `applesauce-relay` only in `platform/nostr` (and tests).
- `@cashu/cashu-ts` never in `components/v2`, `runtime/`, or features other than `wallet`
  and `book`.
- No `react` in a feature's `.ts` files other than `view.ts`.
- Absolute paths go through `withBase("/…")` (`lib/base.ts`), so the app also works under a
  base path. A change of the query alone goes through `showQuery`
  (`components/v2/address.ts`), never `router.replace`/`push`.

## Money

Ecash proofs are bearer money: whoever has a proof's secret has the sats.

- The wallet book writes a record holding the exact outputs before the mint is asked, and
  stores the coins before the record goes (`features/book/executor.ts`). Keep that order: a
  lost answer is then restored, here or by recovery.
- Code that changes an account's coins takes `walletLock(owner)`
  (`features/book/executor.ts`), a Web Lock shared by every tab.
- A mint that still holds sats stays listed, even after it is removed
  (`features/wallet/mintList.ts`).
- Book records live under `cashu_op:book_`, which the old app's sign-out wipe keeps
  (`features/book/journal.ts`).
- Never commit or log secrets, nsec keys or ecash tokens.

## Before a commit

tsc and lint clean, `pnpm test unit` in both keyset modes, and the in-app specs for what you
changed. Check UI changes in a browser at phone and desktop widths.
