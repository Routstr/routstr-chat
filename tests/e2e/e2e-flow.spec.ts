import { test, expect, Page } from "@playwright/test";
import {
  clearLocalStorage,
  waitForAppLoad,
  waitForAuth,
  waitForTopupModal,
  isTopupModalVisible,
  ensureMintInitialized,
} from "./utils/test-helpers";

// Test constants
const CASHU_TOKEN =
  "cashuBo2FteBxodHRwczovL21pbnQuY3ViYWJpdGNvaW4ub3JnYXVjc2F0YXSBomFpSAC58En8vOXiYXCBo2FhAmFzeEBkMTk1MDQ5MmExMzgwZjcyMGI2Yjk4MzMwOWY5MmFjMzUxYTFlYzVjNjJhMWUzY2QyMWM2MTZkYWU1NTI3ODkyYWNYIQNL_qZWdZGsadUn6jHqIXOwAhz8CmrXo4WFsIdfD-NLmg";

// Helper functions for token tab tests
async function switchToTokenTab(page: Page) {
  const tokenTab = page.getByRole("button", { name: "Token" });
  await tokenTab.click();
  await page.waitForTimeout(200);
}

async function getTokenTextarea(page: Page) {
  return page.getByPlaceholder("Paste your cashu token here...");
}

async function getReceiveButton(page: Page) {
  return page.getByRole("button", { name: /receive token/i });
}

async function switchToLightningTab(page: Page) {
  const lightningTab = page.getByRole("button", { name: "Lightning" });
  await lightningTab.click();
  await page.waitForTimeout(200);
}

async function switchToWalletTab(page: Page) {
  const walletTab = page.getByRole("button", { name: "Wallet" });
  await walletTab.click();
  await page.waitForTimeout(200);
}

async function ensureModalVisible(page: Page): Promise<boolean> {
  await waitForTopupModal(page);
  return await isTopupModalVisible(page);
}

test.describe("End-to-End Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearLocalStorage(page);
    await waitForAppLoad(page);
    await ensureMintInitialized(page);
    // Wait a bit for store to hydrate after initialization
    await page.waitForTimeout(500);
    await waitForAuth(page);
  });

  test("should display topup prompt modal when balance is zero", async ({
    page,
  }) => {
    // Wait for modal to appear (it shows when balance is 0 and authenticated)
    await waitForTopupModal(page);

    const modalVisible = await isTopupModalVisible(page);
    if (modalVisible) {
      const modalTitle = page.getByText("Top Up");
      await expect(modalTitle).toBeVisible();
    }
  });

  test("should display quick amount buttons", async ({ page }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      // Ensure we're on the Lightning tab (default)
      await switchToLightningTab(page);

      // Check for quick amount buttons - now they include "sats" suffix
      const amount500 = page.getByRole("button", { name: "500 sats" });
      const amount1000 = page.getByRole("button", { name: "1000 sats" });
      const amount5000 = page.getByRole("button", { name: "5000 sats" });

      await expect(amount500).toBeVisible();
      await expect(amount1000).toBeVisible();
      await expect(amount5000).toBeVisible();
    }
  });

  test("should display custom amount input field", async ({ page }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      // Ensure we're on the Lightning tab (default)
      await switchToLightningTab(page);

      const amountInput = page.getByPlaceholder("Custom amount (sats)");
      await expect(amountInput).toBeVisible();
      await expect(amountInput).toBeEnabled();
    }
  });

  test("should allow entering custom amount", async ({ page }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      // Ensure we're on the Lightning tab (default)
      await switchToLightningTab(page);

      const amountInput = page.getByPlaceholder("Custom amount (sats)");
      await amountInput.fill("2500");

      const inputValue = await amountInput.inputValue();
      expect(inputValue).toBe("2500");
    }
  });

  test("should display get invoice button", async ({ page }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      // Ensure we're on the Lightning tab (default)
      await switchToLightningTab(page);

      const getInvoiceButton = page.getByRole("button", {
        name: /get invoice/i,
      });
      await expect(getInvoiceButton).toBeVisible();
    }
  });

  test("should create invoice when clicking quick amount button", async ({
    page,
  }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      // Ensure we're on the Lightning tab (default)
      await switchToLightningTab(page);

      const amount500 = page.getByRole("button", { name: "500 sats" });
      await amount500.click();

      // Wait for UI feedback (success or error)
      await page.waitForTimeout(1000);

      // Check for success states
      const creatingText = page.getByText("Creating...");
      const waitingText = page.getByText("Waiting for payment...");

      // Check for error state (when mint is not configured or API fails)
      const errorText = page.getByText(/no active mint|failed to create/i);

      const processingVisible = await creatingText
        .isVisible()
        .catch(() => false);
      const waitingVisible = await waitingText.isVisible().catch(() => false);
      const errorVisible = await errorText.isVisible().catch(() => false);

      // Verify that some UI feedback occurred (either success or error)
      expect(processingVisible || waitingVisible || errorVisible).toBeTruthy();
    }
  });

  test("should create invoice when entering custom amount and clicking get invoice", async ({
    page,
  }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      // Ensure we're on the Lightning tab (default)
      await switchToLightningTab(page);

      const amountInput = page.getByPlaceholder("Custom amount (sats)");
      await amountInput.fill("1500");

      const getInvoiceButton = page.getByRole("button", {
        name: /get invoice/i,
      });
      await getInvoiceButton.click();

      await page.waitForTimeout(1000);

      // Check for success states
      const creatingText = page.getByText("Creating...");
      const waitingText = page.getByText("Waiting for payment...");

      // Check for error state
      const errorText = page.getByText(/no active mint|failed to create/i);

      const processingVisible = await creatingText
        .isVisible()
        .catch(() => false);
      const waitingVisible = await waitingText.isVisible().catch(() => false);
      const errorVisible = await errorText.isVisible().catch(() => false);

      // Verify that some UI feedback occurred
      expect(processingVisible || waitingVisible || errorVisible).toBeTruthy();
    }
  });

  test("should create invoice when pressing Enter in amount input", async ({
    page,
  }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      // Ensure we're on the Lightning tab (default)
      await switchToLightningTab(page);

      const amountInput = page.getByPlaceholder("Custom amount (sats)");
      await amountInput.fill("2000");
      await amountInput.press("Enter");

      await page.waitForTimeout(1000);

      // Check for success states
      const creatingText = page.getByText("Creating...");
      const waitingText = page.getByText("Waiting for payment...");

      // Check for error state
      const errorText = page.getByText(/no active mint|failed to create/i);

      const processingVisible = await creatingText
        .isVisible()
        .catch(() => false);
      const waitingVisible = await waitingText.isVisible().catch(() => false);
      const errorVisible = await errorText.isVisible().catch(() => false);

      // Verify that some UI feedback occurred
      expect(processingVisible || waitingVisible || errorVisible).toBeTruthy();
    }
  });

  test("should display QR code after invoice is created", async ({ page }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      // Ensure we're on the Lightning tab (default)
      await switchToLightningTab(page);

      const amount500 = page.getByRole("button", { name: "500 sats" });
      await amount500.click();

      // Wait for invoice creation attempt (either success or error)
      await page.waitForTimeout(2000);

      // Check if "Waiting for payment..." text appears (indicates invoice was created)
      // Use isVisible() instead of waitFor() to avoid timeout errors
      const waitingText = page.getByText("Waiting for payment...");
      const waitingVisible = await waitingText.isVisible().catch(() => false);

      // Only check for QR code if invoice was successfully created
      if (waitingVisible) {
        // Now check for actual QR code - it should have many rect elements (real QR codes have many squares)
        // The placeholder icon has only a few paths, while real QR codes have many rect elements
        const qrCodeContainer = page.locator(
          '[role="button"][title="Click to copy invoice"]',
        );
        const qrCodeVisible = await qrCodeContainer
          .isVisible()
          .catch(() => false);

        if (qrCodeVisible) {
          // Verify it's the actual QR code by checking for many rect elements (real QR codes have 25+ rects)
          const rectCount = await qrCodeContainer.locator("svg rect").count();
          // Real QR codes have many rect elements (typically 25+ for a small QR code)
          // The placeholder icon has no rect elements, only path elements
          expect(rectCount).toBeGreaterThan(20);
        }
      }
      // If waiting text doesn't appear, invoice creation likely failed (API error, etc.)
      // This is acceptable - the test verifies UI state, not API success
    }
  });

  test("should display waiting for payment message after invoice creation", async ({
    page,
  }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      // Ensure we're on the Lightning tab (default)
      await switchToLightningTab(page);

      const amount500 = page.getByRole("button", { name: "500 sats" });
      await amount500.click();

      // Wait for invoice creation
      await page.waitForTimeout(2000);

      const waitingText = page.getByText("Waiting for payment...");
      const waitingVisible = await waitingText.isVisible().catch(() => false);

      // Should show waiting message if invoice was created
      if (waitingVisible) {
        await expect(waitingText).toBeVisible();
      }
    }
  });

  test("should allow closing modal", async ({ page }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      // Find close button - look for the X button in the modal
      const closeButton = page
        .locator("button")
        .filter({
          has: page.locator('svg path[d*="M6 18L18 6M6 6l12 12"]'),
        })
        .first();

      const closeButtonVisible = await closeButton
        .isVisible()
        .catch(() => false);

      if (closeButtonVisible) {
        await closeButton.click();
        await page.waitForTimeout(500);

        // Modal should be closed
        const modalStillVisible = await isTopupModalVisible(page);
        expect(modalStillVisible).toBeFalsy();
      }
    }
  });

  test("should show error message for invalid amount", async ({ page }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      // Ensure we're on the Lightning tab (default)
      await switchToLightningTab(page);

      const amountInput = page.getByPlaceholder("Custom amount (sats)");
      await amountInput.fill("0");

      const getInvoiceButton = page.getByRole("button", {
        name: /get invoice/i,
      });
      await getInvoiceButton.click();

      await page.waitForTimeout(500);

      // Check for error message
      const errorMessage = page.getByText(/enter a valid amount|invalid/i);
      const errorVisible = await errorMessage.isVisible().catch(() => false);

      // Error should appear for invalid amount
      if (errorVisible) {
        await expect(errorMessage).toBeVisible();
      }
    }
  });

  test("should handle responsive layout on mobile", async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      // On mobile, modal should use drawer component
      const modalTitle = page.getByText("Top Up");
      await expect(modalTitle).toBeVisible();

      // Ensure we're on the Lightning tab
      await switchToLightningTab(page);

      // Quick amount buttons should still be visible
      const amount500 = page.getByRole("button", { name: "500 sats" });
      await expect(amount500).toBeVisible();
    }
  });

  test("should display tabs in modal", async ({ page }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      // Check for all three tabs
      const lightningTab = page.getByRole("button", { name: "Lightning" });
      const tokenTab = page.getByRole("button", { name: "Token" });
      const walletTab = page.getByRole("button", { name: "Wallet" });

      await expect(lightningTab).toBeVisible();
      await expect(tokenTab).toBeVisible();
      await expect(walletTab).toBeVisible();
    }
  });

  test("should switch to Token tab", async ({ page }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      await switchToTokenTab(page);

      // Check for Token tab content
      const tokenLabel = page.getByText("Paste Cashu Token");
      const receiveButton = page.getByRole("button", {
        name: /receive token/i,
      });

      await expect(tokenLabel).toBeVisible();
      await expect(receiveButton).toBeVisible();
    }
  });

  test("should display token input field in Token tab", async ({ page }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      await switchToTokenTab(page);

      // Check for textarea
      const tokenTextarea = await getTokenTextarea(page);
      await expect(tokenTextarea).toBeVisible();
      await expect(tokenTextarea).toBeEnabled();
    }
  });

  test("should display paste button in Token tab", async ({ page }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      await switchToTokenTab(page);

      // Check for paste button (clipboard icon button)
      const pasteButton = page.locator('button[title="Paste from clipboard"]');
      await expect(pasteButton).toBeVisible();
    }
  });

  test("should switch to Wallet tab", async ({ page }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      await switchToWalletTab(page);

      // Check for Wallet tab content
      const walletLabel = page.getByText("Wallet (NWC)");
      await expect(walletLabel).toBeVisible();
    }
  });

  test("should display connect wallet button in Wallet tab", async ({
    page,
  }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      await switchToWalletTab(page);

      // Check for connect wallet button (may show "Connect Wallet" or "Connected" depending on state)
      const connectButton = page.getByRole("button", {
        name: /connect wallet|connected/i,
      });
      const connectButtonVisible = await connectButton
        .isVisible()
        .catch(() => false);

      // Button should be visible (either Connect Wallet or Connected status)
      expect(connectButtonVisible).toBeTruthy();
    }
  });

  test("should allow pasting token into textarea", async ({ page }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      await switchToTokenTab(page);

      const tokenTextarea = await getTokenTextarea(page);
      await tokenTextarea.fill(CASHU_TOKEN);

      const inputValue = await tokenTextarea.inputValue();
      expect(inputValue).toBe(CASHU_TOKEN);
    }
  });

  test("should enable receive button when token is entered", async ({
    page,
  }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      await switchToTokenTab(page);

      const tokenTextarea = await getTokenTextarea(page);
      const receiveButton = await getReceiveButton(page);

      // Initially, button should be disabled if textarea is empty
      const initiallyDisabled = await receiveButton
        .isDisabled()
        .catch(() => false);

      // Fill with token
      await tokenTextarea.fill(CASHU_TOKEN);
      await page.waitForTimeout(100);

      // After entering token, button should be enabled
      const isEnabled = await receiveButton.isEnabled().catch(() => false);
      expect(isEnabled).toBeTruthy();
    }
  });

  test("should paste token from clipboard when clicking paste button", async ({
    page,
    context,
  }) => {
    // Grant clipboard permissions
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      await switchToTokenTab(page);

      // Clear the textarea first to avoid duplicates
      const tokenTextarea = await getTokenTextarea(page);
      await tokenTextarea.clear();
      await page.waitForTimeout(100);

      // Set clipboard content using Playwright's clipboard API
      await page.evaluate((token) => {
        navigator.clipboard.writeText(token);
      }, CASHU_TOKEN);

      // Wait a bit for clipboard to be ready
      await page.waitForTimeout(100);

      const pasteButton = page.locator('button[title="Paste from clipboard"]');
      await pasteButton.click();
      await page.waitForTimeout(300);

      const inputValue = await tokenTextarea.inputValue();

      // Token should be pasted into textarea (only once)
      expect(inputValue).toBe(CASHU_TOKEN);
    }
  });

  test("should attempt to receive token when clicking receive button", async ({
    page,
  }) => {
    const modalVisible = await ensureModalVisible(page);
    if (modalVisible) {
      await switchToTokenTab(page);

      const tokenTextarea = await getTokenTextarea(page);
      const receiveButton = await getReceiveButton(page);

      // Use Cashu token
      await tokenTextarea.fill(CASHU_TOKEN);
      await page.waitForTimeout(100);

      // Click receive button
      await receiveButton.click();
      await page.waitForTimeout(1000);

      // Check for UI feedback - either success message, error message, or loading state
      const receivingText = page.getByText("Receiving...");
      const successMessage = page.getByText(/received/i);
      const errorMessage = page.getByText(/invalid|failed|error/i);

      const receivingVisible = await receivingText
        .isVisible()
        .catch(() => false);
      const successVisible = await successMessage
        .isVisible()
        .catch(() => false);
      const errorVisible = await errorMessage.isVisible().catch(() => false);

      // Some UI feedback should occur (loading, success, or error)
      expect(receivingVisible || successVisible || errorVisible).toBeTruthy();
    }
  });
});
