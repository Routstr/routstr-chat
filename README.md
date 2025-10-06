# Routstr Chat Frontend

This repository contains the Next.js frontend for the Routstr Chat application.

## Features

- **Chat UI** with conversation history and model selection
- **Cashu Lightning** wallet integration (deposit, balance, invoice history)
- **Nostr** support and relay connectivity
- **Configurable models** and providers
- **Persistent storage** via localStorage and Zustand stores

## Tech Stack

- Next.js 15, React 19, TypeScript 5
- Tailwind CSS 4
- Zustand for state management
- TanStack Query for data fetching/caching
- Cashu TS, Nostr tools

## Getting Started

1. Install dependencies

```bash
npm install
```

1. Run the development server

```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

## Scripts

```bash
# Start dev server (Turbopack)
npm run dev

# Build production assets
npm run build

# Start production server
npm run start

# Lint
npm run lint

# Invoice-related tests (see Testing below)
npm run test:invoices
npm run test:invoices:integration

# Helper: set up local regtest Cashu mint
npm run test:setup
```

## Testing

This project includes invoice persistence and Lightning integration tests.

- Overview and quick usage: `test/README.md`
- Full local regtest setup: `test/LIGHTNING_TESTING_SETUP.md`

Quick start:

```bash
# Start Cashu regtest environment (see the guide for details)
cd ~ && git clone https://github.com/callebtc/cashu-regtest.git
cd ~/cashu-regtest && ./start.sh

# From the project root, start mint and run tests
npm run test:setup
npm run test:invoices
```

When running the app against local regtest:

```bash
npm run dev
```

Then in your browser console set the mint URL (first run):

```javascript
localStorage.clear();
localStorage.setItem('mint_url', 'http://localhost:3338');
location.reload();
```

See `test/LIGHTNING_TESTING_SETUP.md` for a full end-to-end walkthrough and troubleshooting.

## Production

### Static Export (Recommended)

Build as static files for hosting anywhere:

```bash
npm run build  # Generates static files in out/
npm run static # Build and serve locally for testing
```

Deploy the `out/` folder to any static hosting:

- Netlify, Vercel, GitHub Pages, AWS S3, Firebase Hosting, etc.
- No server required - pure client-side app

### Docker

```bash
npm run docker:build  # Build container with nginx
npm run docker:run    # Run on port 3000
```

### Traditional Server

```bash
npm run build
npm run start
```

Deploy to any platform supporting Next.js 15 (Node.js 18+).

## Troubleshooting

- Port conflicts: If `3000` is in use, Next.js will prompt or choose another port.
- Regtest not detected: Verify the mint is running: `curl http://localhost:3338/v1/info`.
- Invoices not updating:
  - Check that `mint_url` is set in `localStorage`
  - Ensure the regtest containers and the mint are up (see test guide)
- Node version: Use Node.js 18 or newer.

## Project Structure

Key directories:

- `app/`: Next.js App Router entry points
- `components/`: UI components (chat UI, settings, wallet, etc.)
- `context/`: React context providers
- `hooks/`: Custom React hooks
- `stores/`: Zustand stores for wallet and transactions
- `utils/` and `lib/`: Utilities and integrations (Cashu, Nostr)
- `test/`: Scripts and docs for Lightning/regtest testing

## License

MIT
