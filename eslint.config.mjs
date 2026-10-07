import nextVitals from "eslint-config-next/core-web-vitals";
import path from "node:path";
import prettier from "eslint-config-prettier/flat";

// What the screens still take from the old engine. Each module's wiring removes its lines; the list
// goes away with the old hooks, and the rule below then has no exceptions.
const LEGACY = [
  "./components/QueryTimeoutModal.tsx",
  "./components/pwa/KeepAliveProvider.tsx",
  "./features/wallet/hooks/useSdkUsageHistory.ts",
  "./features/wallet/hooks/useWalletReceive.ts",
  "./features/wallet/hooks/useWalletSend.ts",
  "./features/wallet/index.ts",
  "./features/wallet/state/unclaimedTokensStore.ts",
  "./hooks/useAutoRefill.ts",
  "./hooks/useBitcoinConnect.tsx",
  "./hooks/useInvoiceChecker.ts",
  "./hooks/useInvoiceSync.ts",
  "./hooks/useLogs.ts",
  "./lib/preconfiguredModels.ts",
  "./lib/utils.ts",
  "./lib/version.ts",
  "./utils/cashuUtils.ts",
  "./utils/download.ts",
  "./utils/storageUtils.ts",
  "./utils/torUtils.ts",
];

// The old wallet, which imports old components; it goes with the old hooks.
const LEGACY_IMPORTERS = ["features/wallet/components/**", "features/wallet/hooks/**", "features/wallet/state/**", "features/wallet/index.ts"];

// with a glob `from`, the rule matches `except` against absolute paths, and only takes globs
const glob = (p) => path.join(import.meta.dirname, p.replace(/\.ts(x?)$/, ".[t]s$1"));

// The import graph (AGENTS.md): screens read views; services and rules never see React,
// the platform or the runtime; the platform never sees a feature beyond its ports; only app/ mounts
// the runtime.
const graph = {
  ignores: LEGACY_IMPORTERS,
  rules: {
    "import/no-restricted-paths": [
      "error",
      {
        zones: [
          {
            target: "./components/v2/**",
            from: ["./**"],
            except: ["./components/v2/**", "./features/*/view.ts", "./features/*/view.tsx", "./features/*/copy.ts", "./types/**", "./lib/base.ts", "./node_modules/**", ...LEGACY].map(glob),
            message: "Screens read a feature's view, never its service, the platform, the runtime or the old engine.",
          },
          { target: "./features/**", from: ["./platform/**", "./runtime/**", "./components/**", "./app/**"], message: "Features get the platform through their ports, filled by the runtime." },
          { target: "./platform/**", from: ["./features/**", "./runtime/**", "./components/**"], except: ["./features/*/ports.ts", "./features/*/types.ts"].map(glob), message: "The platform implements a feature's ports and knows nothing else of it." },
          { target: ["./components/v2/**", "./features/**", "./platform/**"], from: ["./runtime/**"], message: "Only app/ mounts the runtime." },
        ],
      },
    ],
  },
};

// The whole wallet, its old hooks included, never reaches the root or the runtime: the runtime
// hands it what it needs (features/wallet/hooks/purseBridge.ts). Last for these files, so it
// carries the features zone too.
const wallet = {
  files: ["features/wallet/**/*.ts", "features/wallet/**/*.tsx"],
  rules: {
    "import/no-restricted-paths": [
      "error",
      {
        zones: [
          {
            target: "./features/wallet/**",
            from: ["./platform/**", "./runtime/**", "./components/**", "./app/**"],
            message: "The wallet never imports the root, the runtime or the platform: the runtime registers what it needs.",
          },
        ],
      },
    ],
  },
};

// Restricted packages. ESLint keeps only the last matching config's options for a rule, so each
// group below lists every restriction that applies to it, from the widest group to the narrowest.
const RELAY = { name: "applesauce-relay", message: "Relays go through history's relay layer (features/relays, platform/nostr)." };
const COINS = { name: "@cashu/cashu-ts", message: "Read and move coins through the wallet layer (its Purse), which knows each mint's keysets." };
const REACT = ["react", "react-dom"].map((name) => ({ name, message: "Services and rules stay framework-free; React lives in view.ts." }));
const restrict = (...paths) => ({ "no-restricted-imports": ["error", ...paths.flat()] });
// what still breaks those rules until its module is wired; the list goes with the old hooks
const TESTS = ["**/__tests__/**", "**/*.test.ts"];
const packages = [
  { files: ["**/*.{ts,tsx}"], ignores: ["platform/nostr/**", ...TESTS], rules: restrict(RELAY) },
  {
    files: ["components/v2/**/*.{ts,tsx}", "features/**/*.{ts,tsx}", "runtime/**/*.{ts,tsx}"],
    ignores: ["features/wallet/**", "features/book/**", ...TESTS],
    rules: restrict(RELAY, COINS),
  },
  { files: ["features/**/*.ts"], ignores: ["features/**/view.ts", "features/wallet/**", "features/book/**", ...TESTS], rules: restrict(RELAY, COINS, REACT) },
  { files: ["features/wallet/**/*.ts", "features/book/**/*.ts"], ignores: ["features/**/view.ts", ...LEGACY_IMPORTERS, ...TESTS], rules: restrict(RELAY, REACT) },
];

// A hand-written absolute path breaks when the app is served under a base path (/v2 beside main):
// it goes through withBase (lib/base.ts). Next adds the base to its own links, router and assets.
const RAW_PATH = "Write an absolute path as withBase(\"/…\") (lib/base.ts), so the app also works under /v2.";
// Under a base path the router fetches the root page's file from outside the base (/v2.txt), a
// 404 that becomes a full reload: a change of the query alone goes through showQuery.
const QUERY_ONLY = "Change only the query with showQuery (components/v2/address.ts); the router would reload the page under /v2.";
const ROUTER = 'CallExpression[callee.object.name="router"][callee.property.name=/^(replace|push)$/]';
const basePaths = {
  files: ["**/*.{ts,tsx}"],
  ignores: ["tests/**", "lib/base.ts", "next.config.ts", ...TESTS],
  rules: {
    "no-restricted-syntax": [
      "error",
      { selector: 'Literal[value=/^\\/[A-Za-z_]/]:not(CallExpression[callee.name="withBase"] > Literal)', message: RAW_PATH },
      { selector: "TemplateLiteral[expressions.length=0] > TemplateElement[value.raw=/^\\/[A-Za-z_]/]", message: RAW_PATH },
      { selector: `${ROUTER}[arguments.0.expressions.0.name="pathname"]`, message: QUERY_ONLY },
      { selector: `${ROUTER}[arguments.0.value=/^\\?/]`, message: QUERY_ONLY },
    ],
  },
};

const config = [
  { ignores: ["node_modules/**", ".next/**", "out/**", "public/**", "components/ui/**", "next-env.d.ts"] },
  ...nextVitals,
  prettier,
  {
    rules: {
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "off",
      "import/no-duplicates": "off",
      "import/no-unresolved": "off",
      "react-hooks/exhaustive-deps": "off",
      "import/no-named-as-default-member": "off",
    },
  },
  graph,
  wallet,
  ...packages,
  basePaths,
];

export default config;
