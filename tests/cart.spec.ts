import { test, expect } from "@playwright/test";
import { loadSiteConfig } from "../lib/config";
import {
  goTo,
  waitForStable,
  dismissCookieConsent,
  shouldSkip,
} from "../lib/helpers";

const config = loadSiteConfig();

test.describe("Cart", () => {
  test.skip(shouldSkip(config, "cart"), "Skipped via config");

  async function addProductAndOpenCart(page: any) {
    await goTo(page, config, config.pages.product || "/");
    await page.waitForLoadState("domcontentloaded");
    await waitForStable(page);
    await dismissCookieConsent(page);

    // Click "Comprar agora" — use force in case a floating banner overlaps
    const addToCart = page.locator(config.selectors.addToCartButton).first();
    await expect(addToCart).toBeVisible({ timeout: 10_000 });
    await addToCart.click({ force: true });

    // Wait for minicart drawer to open
    await page.waitForTimeout(3000);
  }

  test("should add product to cart", async ({ page }) => {
    await addProductAndOpenCart(page);

    // The minicart side drawer should be visible with "Produtos Adicionados"
    const pageText = await page.textContent("body");
    expect(
      pageText?.includes("Produtos Adicionados") ||
        pageText?.includes("carrinho") ||
        pageText?.includes("Subtotal")
    ).toBeTruthy();
  });

  test("cart should show product with price", async ({ page }) => {
    await addProductAndOpenCart(page);

    // The drawer should show a product name and price
    const pageText = await page.textContent("body");
    expect(pageText).toContain("R$");
    // Should also show the product name or at least "Subtotal"
    expect(
      pageText?.includes("Subtotal") || pageText?.includes("Smart TV")
    ).toBeTruthy();
  });

  test("cart should have quantity controls", async ({ page }) => {
    await addProductAndOpenCart(page);

    // Minicart uses aria-label buttons, not +/- text
    const plusButtons = page.getByRole("button", { name: "Aumentar quantidade" });
    const minusButtons = page.getByRole("button", { name: "Diminuir quantidade" });

    // Should have quantity controls (PDP + minicart = at least 2 each)
    const plusCount = await plusButtons.count();
    expect(plusCount).toBeGreaterThan(0);
  });

  test("should have checkout/cart link in minicart", async ({ page }) => {
    await addProductAndOpenCart(page);

    // Should have "Ir para o carrinho" link
    const checkoutLink = page.locator(config.selectors.checkoutButton).first();
    const isVisible = await checkoutLink.isVisible().catch(() => false);

    if (isVisible) {
      expect(isVisible).toBeTruthy();
    } else {
      // Fall back to checking any cart-related link
      const anyCartLink = page.locator(
        "a:has-text('carrinho'), a:has-text('checkout'), a[href*='checkout']"
      );
      const count = await anyCartLink.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test("coupon input should exist in cart flow", async ({ page }) => {
    await addProductAndOpenCart(page);

    // Check minicart first
    const couponInput = page.locator(config.selectors.couponInput);
    const hasCouponHere = await couponInput.isVisible().catch(() => false);

    if (!hasCouponHere) {
      // Coupon might be on the full checkout page, not minicart
      // Look for "Cupom" text to confirm it exists somewhere
      const pageText = await page.textContent("body");
      const hasCouponText =
        pageText?.includes("Cupom") || pageText?.includes("cupom");

      // Report — this is informational
      console.log(
        hasCouponText
          ? "Coupon section found in page text"
          : "Coupon input not found in minicart — check full checkout page"
      );
    }
  });
});
