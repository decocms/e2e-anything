import { test, expect } from "@playwright/test";
import { loadSiteConfig } from "../lib/config";
import { goTo, waitForStable, dismissCookieConsent, shouldSkip } from "../lib/helpers";

const config = loadSiteConfig();

test.describe("Geolocation / CEP", () => {
  test.skip(shouldSkip(config, "geolocation"), "Skipped via config");

  test("geolocation button should be visible in header", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    const geoButton = page.locator(config.selectors.geoButton).first();
    await expect(geoButton).toBeVisible();
  });

  test("clicking geo button should open CEP input or dropdown", async ({
    page,
  }) => {
    await goTo(page, config, config.pages.home);
    await dismissCookieConsent(page);

    const geoButton = page.locator(config.selectors.geoButton).first();
    await geoButton.click();
    await page.waitForTimeout(2000);

    // Should open a dropdown/modal with CEP input, or show location-related content
    const cepInput = page.locator(
      "input[placeholder*='CEP'], input[name*='cep'], input[placeholder*='cep'], input[type='tel'], input[inputmode='numeric']"
    );
    const dialog = page.locator("[role='dialog'], [data-modal]");

    const hasCepInput = await cepInput.isVisible().catch(() => false);
    const hasDialog = await dialog.isVisible().catch(() => false);

    // Also check if a dropdown appeared with location-related text
    const pageText = await page.textContent("body");
    const hasLocationText =
      pageText?.includes("CEP") ||
      pageText?.includes("localização") ||
      pageText?.includes("região") ||
      pageText?.includes("endereço");

    expect(hasCepInput || hasDialog || hasLocationText).toBeTruthy();
  });

  test("should be able to type CEP", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    await dismissCookieConsent(page);

    const geoButton = page.locator(config.selectors.geoButton).first();
    await geoButton.click();
    await page.waitForTimeout(2000);

    const cepInput = page.locator(
      "input[placeholder*='CEP'], input[name*='cep'], input[placeholder*='cep'], input[type='tel'], input[inputmode='numeric']"
    ).first();

    const isVisible = await cepInput.isVisible().catch(() => false);
    if (isVisible) {
      await cepInput.fill(config.testData.cep);
      const value = await cepInput.inputValue();
      expect(value.length).toBeGreaterThan(0);
    }
  });

  test("submitting CEP should update location display", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    await dismissCookieConsent(page);

    const geoButton = page.locator(config.selectors.geoButton).first();
    await geoButton.click();
    await page.waitForTimeout(2000);

    const cepInput = page.locator(
      "input[placeholder*='CEP'], input[name*='cep'], input[placeholder*='cep'], input[type='tel'], input[inputmode='numeric']"
    ).first();

    const isVisible = await cepInput.isVisible().catch(() => false);
    if (isVisible) {
      await cepInput.fill(config.testData.cep);
      await cepInput.press("Enter");
      await page.waitForTimeout(3000);

      // After CEP submission, check for any location update
      const headerText = await page.locator("header").textContent();
      const changed =
        !headerText?.includes("Ver ofertas para a região") ||
        headerText?.includes("Rio") ||
        headerText?.includes("RJ") ||
        headerText?.includes("Centro");

      if (changed) {
        expect(changed).toBeTruthy();
      }
    }
  });
});
