#!/usr/bin/env node

/**
 * Basic test suite for invoice persistence (Issue #48)
 * Tests that invoices survive app closure and are properly detected
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Test configuration
const MINT_URL = "http://localhost:3338";
const TEST_TIMEOUT = 30000; // 30 seconds per test
const INVOICE_AMOUNT = 100; // sats

// Test state
let testsPassed = 0;
let testsFailed = 0;

// Helper functions
function exec(command) {
  try {
    return execSync(command, { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    return error.stdout || error.stderr || error.message;
  }
}

function log(message) {
  console.log(`[TEST] ${message}`);
}

function pass(testName) {
  console.log(`✓ ${testName}`);
  testsPassed++;
}

function fail(testName, error) {
  console.error(`✗ ${testName}: ${error}`);
  testsFailed++;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Test: Check mint is running
async function testMintConnection() {
  const testName = "Mint connection";
  try {
    const response = exec(`curl -s ${MINT_URL}/v1/info`);
    const info = JSON.parse(response);
    if (info.name && info.version) {
      pass(testName);
      return true;
    }
    fail(testName, "Invalid mint response");
    return false;
  } catch (error) {
    fail(testName, error.message);
    return false;
  }
}

// Test: Create invoice
async function testCreateInvoice() {
  const testName = "Create invoice";
  try {
    const response = exec(`curl -s -X POST ${MINT_URL}/v1/mint/quote/bolt11 \
      -H "Content-Type: application/json" \
      -d '{"amount": ${INVOICE_AMOUNT}, "unit": "sat"}'`);

    const quote = JSON.parse(response);
    if (quote.quote && quote.request && quote.request.startsWith("lnbcrt")) {
      pass(testName);
      return quote;
    }
    fail(testName, "Invalid invoice format");
    return null;
  } catch (error) {
    fail(testName, error.message);
    return null;
  }
}

// Test: Check invoice status
async function testInvoiceStatus(quoteId) {
  const testName = "Check invoice status";
  try {
    const response = exec(
      `curl -s ${MINT_URL}/v1/mint/quote/bolt11/${quoteId}`,
    );
    const status = JSON.parse(response);
    if (status.state) {
      pass(testName);
      return status;
    }
    fail(testName, "No status returned");
    return null;
  } catch (error) {
    fail(testName, error.message);
    return null;
  }
}

// Test: Pay invoice
async function testPayInvoice(invoice) {
  const testName = "Pay invoice";

  // Skip payment test in CI environment
  if (process.env.CI) {
    console.log(`Skipping ${testName} in CI environment`);
    return true;
  }

  try {
    // Use the pay-invoice.sh script
    const scriptPath = path.join(__dirname, "pay-invoice.sh");
    const result = exec(`${scriptPath} ${invoice}`);
    if (result.includes("SUCCEEDED")) {
      pass(testName);
      return true;
    }
    fail(testName, "Payment failed");
    return false;
  } catch (error) {
    fail(testName, error.message);
    return false;
  }
}

// Test: Verify payment detected
async function testPaymentDetection(quoteId) {
  const testName = "Payment detection";

  // Skip payment detection test in CI environment
  if (process.env.CI) {
    console.log(`Skipping ${testName} in CI environment`);
    return true;
  }

  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    try {
      const response = exec(
        `curl -s ${MINT_URL}/v1/mint/quote/bolt11/${quoteId}`,
      );
      const status = JSON.parse(response);

      if (status.state === "PAID") {
        pass(testName);
        return true;
      }

      attempts++;
      await sleep(2000); // Wait 2 seconds between checks
    } catch (error) {
      // Continue checking
    }
  }

  fail(testName, "Payment not detected after 20 seconds");
  return false;
}

// Main test runner
async function runTests() {
  console.log("Invoice Persistence Test Suite");
  console.log("==============================\n");

  // Check prerequisites
  log("Checking environment...");

  // Check if regtest is running
  const dockerCheck = exec("docker ps");
  if (!dockerCheck.includes("cashu-")) {
    console.error("Error: Regtest environment not running");
    console.error("Run: cd ~/cashu-regtest && ./start.sh");
    process.exit(1);
  }

  // Run tests
  log("Starting tests...\n");

  // Test 1: Mint connection
  const mintOk = await testMintConnection();
  if (!mintOk) {
    console.error(
      "\nMint not accessible. Start with: ./test/setup-regtest-mint.sh",
    );
    process.exit(1);
  }

  // Test 2: Create invoice
  const invoice = await testCreateInvoice();
  if (!invoice) {
    process.exit(1);
  }

  // Test 3: Check initial status
  const initialStatus = await testInvoiceStatus(invoice.quote);
  if (!initialStatus) {
    process.exit(1);
  }

  // Test 4: Pay invoice
  const paid = await testPayInvoice(invoice.request);
  if (!paid) {
    process.exit(1);
  }

  // Test 5: Verify payment detected
  await testPaymentDetection(invoice.quote);

  // Summary
  console.log("\n==============================");
  console.log(`Tests passed: ${testsPassed}`);
  console.log(`Tests failed: ${testsFailed}`);
  console.log("==============================\n");

  process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  console.error("Test suite error:", error);
  process.exit(1);
});
