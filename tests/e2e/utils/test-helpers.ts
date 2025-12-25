import { Page, expect } from "@playwright/test";

/**
 * Helper functions for Playwright tests
 */

/**
 * Clear localStorage to reset app state
 * Must be called after page navigation to ensure proper origin context
 */
export async function clearLocalStorage(page: Page) {
  // Ensure we're on a page with proper origin before accessing localStorage
  await page.evaluate(() => {
    localStorage.clear();
  });
}

/**
 * Wait for the app to be fully loaded
 */
export async function waitForAppLoad(page: Page) {
  // Wait for auth check to complete
  await page.waitForSelector("body", { state: "visible" });
  // Wait a bit for React to hydrate
  await page.waitForTimeout(500);
}

/**
 * Wait for chat input to be visible and ready
 */
export async function waitForChatInput(page: Page) {
  await page.waitForSelector('[data-tutorial="chat-input"]', {
    state: "visible",
    timeout: 5000,
  });
}

/**
 * Type a message in the chat input
 */
export async function typeMessage(page: Page, message: string) {
  const chatInput = page.locator('[data-tutorial="chat-input"]');
  await chatInput.fill(message);
}

/**
 * Send a message
 */
export async function sendMessage(page: Page, message: string) {
  await typeMessage(page, message);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
}

/**
 * Wait for model selector to be visible
 */
export async function waitForModelSelector(page: Page) {
  await page.waitForSelector('[data-tutorial="model-selector"]', {
    state: "visible",
    timeout: 5000,
  });
}

/**
 * Open model selector
 */
export async function openModelSelector(page: Page) {
  const modelSelector = page.locator('[data-tutorial="model-selector"]');
  await modelSelector.click();
  await page.waitForTimeout(500);
}

/**
 * Check if sidebar is visible
 */
export async function isSidebarVisible(page: Page) {
  // Sidebar might have different selectors depending on state
  const sidebar = page.locator("[data-sidebar]").or(page.locator("aside"));
  return await sidebar.isVisible().catch(() => false);
}

/**
 * Wait for authentication to complete
 */
export async function waitForAuth(page: Page) {
  // Wait for auth check indicator to disappear
  await page
    .waitForFunction(
      () => {
        const loader = document.querySelector('svg[class*="animate-spin"]');
        return !loader || loader.closest("div")?.textContent !== "";
      },
      { timeout: 10000 },
    )
    .catch(() => {
      // Auth might already be complete
    });
}

/**
 * Wait for topup modal to appear
 */
export async function waitForTopupModal(page: Page, timeout = 5000) {
  await page
    .waitForSelector("text=Top Up", {
      state: "visible",
      timeout,
    })
    .catch(() => {
      // Modal might not appear if balance is not zero or user not authenticated
    });
}

/**
 * Check if topup modal is visible
 */
export async function isTopupModalVisible(page: Page): Promise<boolean> {
  const modalTitle = page.getByText("Top Up");
  return await modalTitle.isVisible().catch(() => false);
}

/**
 * Wait for mint to be initialized (sets default mint in localStorage)
 */
export async function ensureMintInitialized(page: Page) {
  await page.evaluate(() => {
    // Set default mint in localStorage (cashu store uses persist middleware)
    const cashuData = localStorage.getItem("cashu");
    const defaultMintUrl = "https://mint.minibits.cash/Bitcoin";

    if (cashuData) {
      try {
        const parsed = JSON.parse(cashuData);
        parsed.state = parsed.state || {};

        // Set active mint URL if not already set
        if (!parsed.state.activeMintUrl) {
          parsed.state.activeMintUrl = defaultMintUrl;
        }

        // Ensure default mint is in mints array
        if (!parsed.state.mints || !Array.isArray(parsed.state.mints)) {
          parsed.state.mints = [];
        }

        const mintExists = parsed.state.mints.some(
          (m: any) => (typeof m === "string" ? m : m.url) === defaultMintUrl,
        );

        if (!mintExists) {
          parsed.state.mints.push({ url: defaultMintUrl });
        }

        localStorage.setItem("cashu", JSON.stringify(parsed));
      } catch (e) {
        // If parsing fails, create new store structure
        localStorage.setItem(
          "cashu",
          JSON.stringify({
            state: {
              activeMintUrl: defaultMintUrl,
              mints: [{ url: defaultMintUrl }],
              proofs: [],
              usingNip60: true,
            },
            version: 0,
          }),
        );
      }
    } else {
      // Create new store structure
      localStorage.setItem(
        "cashu",
        JSON.stringify({
          state: {
            activeMintUrl: defaultMintUrl,
            mints: [{ url: defaultMintUrl }],
            proofs: [],
            usingNip60: true,
          },
          version: 0,
        }),
      );
    }
  });
}

/**
 * Wait for models to load in the model selector
 */
export async function waitForModelsToLoad(page: Page, timeout = 10000) {
  // Wait for the model drawer to be visible and models to appear
  await page
    .waitForSelector("#model-selector-drawer", {
      state: "visible",
      timeout,
    })
    .catch(() => {
      // Drawer might not have that ID, try alternative selector
    });

  // Wait for model list items to appear (either "All Models" section or model items)
  await page
    .waitForSelector("text=All Models", {
      state: "visible",
      timeout,
    })
    .catch(() => {
      // Models might already be visible
    });

  // Give a bit more time for models to render
  await page.waitForTimeout(500);
}

/**
 * Select an available model from the model selector
 * Returns the model name that was selected, or null if no model was found
 */
export async function selectAvailableModel(page: Page): Promise<string | null> {
  // Open model selector
  await openModelSelector(page);

  // Wait for models to load
  await waitForModelsToLoad(page);

  // Wait for the drawer to be visible
  const drawer = page.locator("#model-selector-drawer");
  await drawer.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});

  // Wait for models to be loaded (check for "All Models" text or model items)
  await page
    .waitForSelector("text=All Models", { timeout: 10000 })
    .catch(() => {
      // Try alternative: wait for any model item
      return page
        .waitForSelector('[class*="rounded-md"]', { timeout: 10000 })
        .catch(() => {});
    });

  // Try to find a model in the "All Models" section first
  // Models are rendered in a div with "All Models" text, then model items below
  const allModelsText = page.getByText("All Models");
  const allModelsVisible = await allModelsText.isVisible().catch(() => false);

  if (allModelsVisible) {
    // Find the parent container of "All Models" section
    const allModelsSection = allModelsText.locator("..").locator("..");

    // Find model items within this section that are not disabled
    // Model items have a structure: div with rounded-md, containing .flex-1 with model info
    const modelItems = allModelsSection
      .locator('div[class*="rounded-md"]')
      .filter({
        hasNot: page.locator('[class*="opacity-40"]'),
      });

    const modelCount = await modelItems.count();

    if (modelCount > 0) {
      // Get the first available model
      const firstModel = modelItems.first();

      // Get the model name before clicking
      const modelNameElement = firstModel.locator(".font-medium").first();
      const modelName = await modelNameElement.textContent();

      // Click on the flex-1 div that contains the model info (clickable area)
      await firstModel.locator(".flex-1").first().click();
      await page.waitForTimeout(800);

      // Verify the drawer closed (or is closing)
      const drawerStillVisible = await drawer.isVisible().catch(() => false);
      if (drawerStillVisible) {
        // Drawer might still be animating, wait a bit more
        await page.waitForTimeout(500);
      }

      return modelName?.trim() || null;
    }
  }

  // Fallback: try to find any available model item anywhere in the drawer
  const anyModelItems = drawer.locator('div[class*="rounded-md"]').filter({
    hasNot: page.locator('[class*="opacity-40"]'),
  });

  const anyModelCount = await anyModelItems.count();

  if (anyModelCount > 0) {
    const firstModel = anyModelItems.first();
    const modelNameElement = firstModel.locator(".font-medium").first();
    const modelName = await modelNameElement.textContent();

    await firstModel.locator(".flex-1").first().click();
    await page.waitForTimeout(800);

    return modelName?.trim() || null;
  }

  return null;
}

/**
 * Wait for a user message to appear in the chat
 */
export async function waitForUserMessage(
  page: Page,
  messageText: string,
  timeout = 5000,
) {
  // User messages are displayed in a div with bg-white/10 rounded-2xl
  // They appear in a flex justify-end container
  await page.waitForSelector(`text=${messageText}`, {
    state: "visible",
    timeout,
  });
}

/**
 * Wait for chat to be ready (chat input visible and model selected if needed)
 */
export async function waitForChatReady(page: Page) {
  await waitForChatInput(page);
  await page.waitForTimeout(300);
}

/**
 * Receive a cashu token to top up balance
 * This simulates the topup flow by receiving a token
 * Returns true if topup was successful, false otherwise
 */
export async function receiveCashuToken(
  page: Page,
  token: string,
): Promise<boolean> {
  // Wait for topup modal to appear
  await waitForTopupModal(page);
  const modalVisible = await isTopupModalVisible(page);

  if (!modalVisible) {
    // Modal might not appear if balance already exists
    return false;
  }

  // Switch to Token tab
  const tokenTab = page.getByRole("button", { name: "Token" });
  await tokenTab.click();
  await page.waitForTimeout(200);

  // Fill in token
  const tokenTextarea = page.getByPlaceholder("Paste your cashu token here...");
  await tokenTextarea.fill(token);
  await page.waitForTimeout(100);

  // Click receive button
  const receiveButton = page.getByRole("button", { name: /receive token/i });
  await receiveButton.click();

  // Wait for processing
  await page.waitForTimeout(2000);

  // Check for success message
  const successMessage = page.getByText(/received/i);
  const successVisible = await successMessage.isVisible().catch(() => false);

  if (successVisible) {
    // Wait a bit more for modal to close
    await page.waitForTimeout(500);
    return true;
  }

  // Check if modal closed (indicating success)
  const modalStillVisible = await isTopupModalVisible(page);
  if (!modalStillVisible) {
    return true;
  }

  return false;
}
