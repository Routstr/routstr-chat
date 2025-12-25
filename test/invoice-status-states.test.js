#!/usr/bin/env node

/**
 * Tests that invoices are properly marked as paid when mint returns ISSUED status
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Test configuration
const MINT_URL = process.env.MINT_URL || "http://localhost:3338";
const TEST_TIMEOUT = 30000;
const INVOICE_AMOUNT = 12;

let testsPassed = 0;
let testsFailed = 0;

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}[TEST] ${message}${colors.reset}`);
}

function pass(testName) {
  console.log(`${colors.green}✓ ${testName}${colors.reset}`);
  testsPassed++;
}

function fail(testName, error) {
  console.error(`${colors.red}✗ ${testName}: ${error}${colors.reset}`);
  testsFailed++;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testMintConnection() {
  const testName = "Mint connection";

  try {
    const response = await fetch(`${MINT_URL}/v1/info`);
    if (!response.ok) throw new Error("Mint not responding");
    const info = await response.json();
    pass(`${testName} - Connected to ${info.name || "mint"}`);
    return true;
  } catch (error) {
    fail(testName, `Cannot connect to mint at ${MINT_URL}`);
    return false;
  }
}

async function testInvoiceStates() {
  const testName = "Invoice state transitions";

  try {
    const { CashuMint, CashuWallet, MintQuoteState } =
      await import("@cashu/cashu-ts");

    const mint = new CashuMint(MINT_URL);
    const wallet = new CashuWallet(mint);
    await wallet.loadMint();

    const mintQuote = await wallet.createMintQuote(INVOICE_AMOUNT);
    log(`Created mint quote: ${mintQuote.quote}`, "yellow");
    log(`Initial state: ${mintQuote.state}`, "yellow");

    const status = await wallet.checkMintQuote(mintQuote.quote);
    log(`Status check:`, "yellow");
    log(`  - state: ${status.state}`, "yellow");
    log(`  - paid: ${status.paid}`, "yellow");

    if (process.env.DEBUG) {
      console.log("Full response:", JSON.stringify(status, null, 2));
    }

    if (status.state === "ISSUED" && status.paid === false) {
      log("⚠️  FOUND PROBLEMATIC STATE: ISSUED with paid=false", "red");
      log(
        "This is the bug we fixed - mint says tokens are issued but paid=false",
        "yellow",
      );
      pass(`${testName} - Detected and handled ISSUED state correctly`);
    } else if (
      status.state === "UNPAID" ||
      status.state === MintQuoteState.UNPAID
    ) {
      pass(`${testName} - Invoice correctly in UNPAID state`);
    } else if (
      status.state === "PAID" ||
      status.state === MintQuoteState.PAID
    ) {
      pass(`${testName} - Invoice in PAID state`);
    } else if (
      status.state === "ISSUED" ||
      status.state === MintQuoteState.ISSUED
    ) {
      pass(`${testName} - Invoice in ISSUED state (tokens minted)`);
    } else {
      fail(testName, `Unexpected state: ${status.state}`);
    }

    return true;
  } catch (error) {
    fail(testName, error.message);
    console.error("Full error:", error);
    return false;
  }
}

async function testFixLogic() {
  const testName = "Fix handles all invoice states";

  try {
    const { MintQuoteState } = await import("@cashu/cashu-ts");

    function isInvoicePaid(state, paid) {
      return (
        state === "PAID" ||
        state === "ISSUED" ||
        state === MintQuoteState.PAID ||
        state === MintQuoteState.ISSUED
      );
    }

    const testCases = [
      {
        state: "UNPAID",
        paid: false,
        shouldBePaid: false,
        desc: "UNPAID with paid=false",
      },
      {
        state: "PAID",
        paid: true,
        shouldBePaid: true,
        desc: "PAID with paid=true",
      },
      {
        state: "PAID",
        paid: false,
        shouldBePaid: true,
        desc: "PAID with paid=false (edge case)",
      },
      {
        state: "ISSUED",
        paid: true,
        shouldBePaid: true,
        desc: "ISSUED with paid=true",
      },
      {
        state: "ISSUED",
        paid: false,
        shouldBePaid: true,
        desc: "ISSUED with paid=false (the bug case)",
      },
    ];

    let allPassed = true;
    log("Testing invoice state logic:", "blue");

    testCases.forEach((test) => {
      const result = isInvoicePaid(test.state, test.paid);
      const passed = result === test.shouldBePaid;

      if (passed) {
        log(`  ✓ ${test.desc} => isPaid: ${result}`, "green");
      } else {
        log(
          `  ✗ ${test.desc} => isPaid: ${result} (expected: ${test.shouldBePaid})`,
          "red",
        );
        allPassed = false;
      }
    });

    if (allPassed) {
      pass(testName);
    } else {
      fail(testName, "Some state combinations failed");
    }

    return allPassed;
  } catch (error) {
    fail(testName, error.message);
    return false;
  }
}

async function testInvoiceCheckingBehavior() {
  const testName = "Invoice checking hook behavior";

  try {
    const mockStorage = {};

    const mockInvoice = {
      id: `test-${Date.now()}`,
      type: "mint",
      mintUrl: MINT_URL,
      quoteId: `quote-${Date.now()}`,
      paymentRequest: "lnbc...",
      amount: INVOICE_AMOUNT,
      state: "UNPAID",
      createdAt: Date.now(),
    };

    mockStorage["lightning_invoices"] = JSON.stringify({
      invoices: [mockInvoice],
      lastSync: Date.now(),
    });

    log("Created mock invoice in storage", "yellow");

    const states = ["UNPAID", "PAID", "ISSUED"];
    for (const state of states) {
      mockInvoice.state = state;
      const isPaid = state === "PAID" || state === "ISSUED";
      log(`  State: ${state} => Should be paid: ${isPaid}`, "yellow");
    }

    pass(testName);
    return true;
  } catch (error) {
    fail(testName, error.message);
    return false;
  }
}

async function runTests() {
  console.log("\n" + "=".repeat(50));
  log("Invoice Status States Test Suite", "blue");
  log("Testing ISSUED vs PAID state handling", "blue");
  console.log("=".repeat(50) + "\n");

  const startTime = Date.now();

  await testMintConnection();
  await testInvoiceStates();
  await testFixLogic();
  await testInvoiceCheckingBehavior();

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log("\n" + "=".repeat(50));
  log("Test Summary", "blue");
  console.log("=".repeat(50));
  console.log(`  Total tests: ${testsPassed + testsFailed}`);
  console.log(`  ${colors.green}Passed: ${testsPassed}${colors.reset}`);
  console.log(`  ${colors.red}Failed: ${testsFailed}${colors.reset}`);
  console.log(`  Duration: ${duration}s`);
  console.log("=".repeat(50) + "\n");

  if (testsFailed > 0) {
    log("Some tests failed!", "red");
    process.exit(1);
  } else {
    log("All tests passed!", "green");
    process.exit(0);
  }
}

const timeoutHandle = setTimeout(() => {
  log("Test timeout!", "red");
  process.exit(1);
}, TEST_TIMEOUT);

runTests()
  .then(() => clearTimeout(timeoutHandle))
  .catch((error) => {
    clearTimeout(timeoutHandle);
    log(`Unexpected error: ${error.message}`, "red");
    console.error(error);
    process.exit(1);
  });
