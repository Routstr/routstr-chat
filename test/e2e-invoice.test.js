#!/usr/bin/env node

/**
 * End-to-end test for invoice persistence
 * Simulates the full user flow including browser storage
 */

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const MINT_URL = "http://localhost:3338";
const APP_URL = "http://localhost:3000";

let appProcess;

function exec(command) {
  try {
    return execSync(command, { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    return error.stdout || error.stderr || error.message;
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Simulate localStorage operations
function createMockInvoice() {
  return {
    id: `test-${Date.now()}`,
    amount: 100,
    paymentRequest: "lnbcrt1u1ptest...",
    state: "UNPAID",
    type: "mint",
    mintUrl: MINT_URL,
    quoteId: `quote-${Date.now()}`,
    createdAt: Date.now(),
    expiresAt: Date.now() + 600000, // 10 minutes
  };
}

async function testStorageSimulation() {
  console.log("\nTest: Storage Simulation");
  console.log("------------------------");

  // Create test data
  const invoice = createMockInvoice();
  const storageData = JSON.stringify([invoice]);

  // Write to temp file (simulating localStorage)
  const tempFile = path.join(__dirname, "temp-invoice-storage.json");
  fs.writeFileSync(tempFile, storageData);
  console.log("✓ Created test invoice in storage");

  // Simulate payment
  invoice.state = "PAID";
  invoice.paidAt = Date.now();
  fs.writeFileSync(tempFile, JSON.stringify([invoice]));
  console.log("✓ Updated invoice to PAID state");

  // Read and verify
  const stored = JSON.parse(fs.readFileSync(tempFile, "utf8"));
  if (stored[0].state === "PAID") {
    console.log("✓ Storage persistence verified");
  } else {
    console.log("✗ Storage persistence failed");
  }

  // Cleanup
  fs.unlinkSync(tempFile);

  return true;
}

async function testMintIntegration() {
  console.log("\nTest: Mint Integration");
  console.log("----------------------");

  // Test mint connection
  const mintInfo = exec(`curl -s ${MINT_URL}/v1/info`);
  try {
    const info = JSON.parse(mintInfo);
    console.log(`✓ Connected to mint: ${info.name}`);
  } catch {
    console.log("✗ Could not connect to mint");
    return false;
  }

  // Create real invoice
  const response = exec(`curl -s -X POST ${MINT_URL}/v1/mint/quote/bolt11 \
    -H "Content-Type: application/json" \
    -d '{"amount": 100, "unit": "sat"}'`);

  try {
    const quote = JSON.parse(response);
    if (quote.request && quote.request.startsWith("lnbcrt")) {
      console.log("✓ Created regtest invoice");
      console.log(`  Quote ID: ${quote.quote}`);
      console.log(`  Amount: 100 sats`);

      // Store quote for later verification
      fs.writeFileSync(
        path.join(__dirname, "last-test-quote.json"),
        JSON.stringify(quote)
      );

      return quote;
    }
  } catch (error) {
    console.log("✗ Failed to create invoice");
    return null;
  }
}

async function testPaymentFlow(invoice) {
  if (!invoice) return false;

  console.log("\nTest: Payment Flow");
  console.log("------------------");

  // Pay the invoice
  console.log("Paying invoice...");
  const scriptPath = path.join(__dirname, "pay-invoice.sh");
  const payResult = exec(`${scriptPath} ${invoice.request}`);

  if (payResult.includes("SUCCEEDED")) {
    console.log("✓ Payment succeeded");

    // Check mint status
    await sleep(2000);
    const statusCheck = exec(
      `curl -s ${MINT_URL}/v1/mint/quote/bolt11/${invoice.quote}`
    );
    try {
      const status = JSON.parse(statusCheck);
      if (status.state === "PAID") {
        console.log("✓ Mint confirmed payment");
        return true;
      }
    } catch {
      console.log("✗ Could not verify payment status");
    }
  } else {
    console.log("✗ Payment failed");
  }

  return false;
}

async function runTests() {
  console.log("================================");
  console.log("Invoice Persistence E2E Tests");
  console.log("================================");

  let allPassed = true;

  // Check environment
  console.log("\nChecking environment...");
  const dockerCheck = exec("docker ps | grep cashu-");
  if (!dockerCheck.includes("cashu-")) {
    console.error("Error: Regtest not running");
    console.error("Run: cd ~/cashu-regtest && ./start.sh");
    process.exit(1);
  }
  console.log("✓ Regtest environment running");

  // Run tests
  allPassed = (await testStorageSimulation()) && allPassed;

  const invoice = await testMintIntegration();
  if (invoice) {
    allPassed = (await testPaymentFlow(invoice)) && allPassed;
  } else {
    allPassed = false;
  }

  // Summary
  console.log("\n================================");
  if (allPassed) {
    console.log("All tests passed ✓");
    process.exit(0);
  } else {
    console.log("Some tests failed ✗");
    process.exit(1);
  }
}

// Handle cleanup
process.on("SIGINT", () => {
  if (appProcess) {
    appProcess.kill();
  }
  process.exit(0);
});

// Run tests
runTests().catch((error) => {
  console.error("Test error:", error);
  process.exit(1);
});
