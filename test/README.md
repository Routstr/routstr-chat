# Test Suite Documentation

Basic test suite for the Routstr chat application.

## Requirements

- Node.js 20+
- Docker (for test mint)

## Setup

```bash
# Install dependencies
npm install
```

## Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage
```

## Test Structure

```
test/
├── app.test.ts            # Core app functionality tests
├── components.test.tsx    # React component tests  
├── payment-flow.test.ts   # Payment flow integration
└── setup.ts               # Test environment setup
```

## Features Tested

### Core Functionality
- Mock mint operations (needs real Lightning implementation)
- Token format validation
- Quote creation and checking

### Error Scenarios
- Invalid amounts
- Network timeouts
- Malformed requests

### Chat Operations
- Component rendering (needs integration testing)
- Payment UI flows (mock only)

## Infrastructure

Tests currently use:
- **FakeWallet backend**: Mock Lightning implementation
- **Docker test mint**: Basic Cashu mint for testing

Real Lightning integration needed.

## CI/CD

GitHub Actions workflow runs tests on every PR and push to main.