# Routstr Chat Frontend

This repository contains the Next.js frontend for the Routstr Chat application.

## Features

- **Chat UI** with conversation history and model selection
- **Cashu Lightning** wallet integration (deposit, balance, invoice history)
- **Nostr** support and relay connectivity
- **Configurable models** and providers
- **Persistent storage** via localStorage and Zustand stores

## Tech Stack

- Next.js 16, React 19, TypeScript 5
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
```

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

Deploy to any platform supporting Next.js 16 (Node.js 18+).

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

## API Mocking with MSW

This project uses [Mock Service Worker (MSW)](https://mswjs.io/) for API mocking in development. This allows you to test error scenarios and edge cases without hitting the real backend.

### Testing the 413 Payload Too Large Error

To test the 413 error scenario:

1. **Start the development server:**

   ```bash
   npm run dev
   ```

2. **Open the app in your browser** and wait for the service worker to initialize (check Network tab for `mockServiceWorker.js`).

3. **Enable the 413 mock scenario** in your browser console:

   ```javascript
   localStorage.setItem("msw:scenario", "413");
   // Optional: add latency delay
   localStorage.setItem("msw:latency", "1500"); // milliseconds
   ```

4. **Refresh the page** and trigger a chat request. The API call to `v1/chat/completions` will return a 413 error with the payload:

   ```json
   {
     "error": {
       "message": "Payload Too Large",
       "code": "PAYLOAD_TOO_LARGE",
       "status": 413
     }
   }
   ```

5. **Disable the mock** when done:
   ```javascript
   localStorage.removeItem("msw:scenario");
   localStorage.removeItem("msw:latency");
   ```

The mock handler is configured in `mocks/handlers.ts` and automatically starts in development mode via `components/ClientProviders.tsx`.

## License

MIT
