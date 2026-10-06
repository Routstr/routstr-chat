import nextVitals from "eslint-config-next/core-web-vitals";
import path from "node:path";
import prettier from "eslint-config-prettier/flat";

// What the screens still take from the old engine. Each module's wiring removes its lines; the list
// goes away with the old hooks, and the rule below then has no exceptions.
const LEGACY = [
  "./components/QueryTimeoutModal.tsx",
  "./components/pwa/KeepAliveProvider.tsx",
  "./context/AuthProvider.tsx",
  "./context/ChatProvider.tsx",
  "./features/wallet/hooks/useCashuToken.ts",
  "./features/wallet/hooks/useCashuWallet.ts",
  "./features/wallet/hooks/useSdkUsageHistory.ts",
  "./features/wallet/hooks/useWalletReceive.ts",
  "./features/wallet/hooks/useWalletSend.ts",
  "./features/wallet/index.ts",
  "./features/wallet/state/transactionHistoryStore.ts",
  "./features/wallet/state/unclaimedTokensStore.ts",
  "./hooks/useAutoRefill.ts",
  "./hooks/useBitcoinConnect.tsx",
  "./hooks/useDisabledProviders.ts",
  "./hooks/useInvoiceChecker.ts",
  "./hooks/useInvoiceSync.ts",
  "./hooks/useLogs.ts",
  "./lib/preconfiguredModels.ts",
  "./lib/utils.ts",
  "./lib/version.ts",
  "./utils/cashuUtils.ts",
  "./utils/download.ts",
  "./utils/modelUtils.ts",
  "./utils/storageUtils.ts",
  "./utils/torUtils.ts",
];

// The old wallet, which imports old components; it goes with the old hooks.
const LEGACY_IMPORTERS = ["features/wallet/components/**", "features/wallet/hooks/**", "features/wallet/state/**", "features/wallet/index.ts"];

// with a glob `from`, the rule matches `except` against absolute paths, and only takes globs
const glob = (p) => path.join(import.meta.dirname, p.replace(/\.ts(x?)$/, ".[t]s$1"));

// The import graph from ARCHITECTURE.md: screens read views; services and rules never see React,
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
            except: ["./components/v2/**", "./features/*/view.ts", "./features/*/view.tsx", "./features/*/copy.ts", "./types/**", "./node_modules/**", ...LEGACY].map(glob),
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

// Restricted packages. ESLint keeps only the last matching config's options for a rule, so each
// group below lists every restriction that applies to it, from the widest group to the narrowest.
const RELAY = { name: "applesauce-relay", message: "Relays go through history's relay layer (features/relays, platform/nostr)." };
const COINS = { name: "@cashu/cashu-ts", message: "Read and move coins through the wallet layer (its Purse), which knows each mint's keysets." };
const REACT = ["react", "react-dom"].map((name) => ({ name, message: "Services and rules stay framework-free; React lives in view.ts." }));
const restrict = (...paths) => ({ "no-restricted-imports": ["error", ...paths.flat()] });
// what still breaks those rules until its module is wired; the list goes with the old hooks
const LEGACY_DECODERS = ["components/v2/App.tsx", "components/v2/composer/back/usePay.tsx"];
const TESTS = ["**/__tests__/**", "**/*.test.ts"];
const packages = [
  { files: ["**/*.{ts,tsx}"], ignores: ["platform/nostr/**", ...TESTS], rules: restrict(RELAY) },
  {
    files: ["components/v2/**/*.{ts,tsx}", "features/**/*.{ts,tsx}", "runtime/**/*.{ts,tsx}"],
    ignores: ["features/wallet/**", "features/book/**", ...TESTS, ...LEGACY_DECODERS],
    rules: restrict(RELAY, COINS),
  },
  { files: ["features/**/*.ts"], ignores: ["features/**/view.ts", "features/wallet/**", "features/book/**", ...TESTS], rules: restrict(RELAY, COINS, REACT) },
  { files: ["features/wallet/**/*.ts", "features/book/**/*.ts"], ignores: ["features/**/view.ts", ...LEGACY_IMPORTERS, ...TESTS], rules: restrict(RELAY, REACT) },
];

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
  ...packages,
];

export default config;
