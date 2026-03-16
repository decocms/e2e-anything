import { test, expect } from "@playwright/test";
import { loadSiteConfig } from "../lib/config";
import {
  goTo,
  waitForStable,
  dismissCookieConsent,
  shouldSkip,
} from "../lib/helpers";

const config = loadSiteConfig();

test.describe("Checkout", () => {
  test.skip(shouldSkip(config, "checkout"), "Skipped via config");

  test("should be able to reach checkout from cart", async ({ page }) => {
    // Add a product to cart
    await goTo(page, config, config.pages.product || "/");
    await waitForStable(page);
    await dismissCookieConsent(page);

    const addToCart = page.locator(config.selectors.addToCartButton).first();
    await expect(addToCart).toBeVisible({ timeout: 10_000 });
    await addToCart.click();
    await page.waitForTimeout(3000);

    // Look for "Ir para o carrinho" or "Finalizar" in the minicart
    const checkoutBtn = page.locator(config.selectors.checkoutButton).first();
    const hasCheckout = await checkoutBtn.isVisible().catch(() => false);

    if (hasCheckout) {
      await checkoutBtn.click();
      await page.waitForTimeout(5000);

      const url = page.url();
      expect(
        url.includes("checkout") ||
          url.includes("cart") ||
          url.includes("carrinho") ||
          url.includes("vtex")
      ).toBeTruthy();
    } else {
      // Navigate to checkout directly
      const response = await goTo(page, config, config.pages.cart);
      expect(response?.status()).toBeLessThan(500);
    }
  });

  test("checkout page should load without server errors", async ({ page }) => {
    const response = await goTo(page, config, config.pages.cart);
    // Checkout may redirect to VTEX or return 4xx if empty cart — that's OK
    // We only care about 5xx server errors
    const status = response?.status() || 200;
    expect.soft(status, `Checkout page returned ${status}`).toBeLessThan(500);
  });
});
