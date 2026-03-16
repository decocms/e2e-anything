import { test, expect } from "@playwright/test";
import { loadSiteConfig } from "../lib/config";
import { goTo, waitForStable, dismissCookieConsent, shouldSkip } from "../lib/helpers";

const config = loadSiteConfig();

test.describe("Search", () => {
  test.skip(shouldSkip(config, "search"), "Skipped via config");

  async function searchFor(page: any, term: string) {
    await goTo(page, config, config.pages.home);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookieConsent(page);

    const searchInput = page.locator(config.selectors.searchInput);
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.click();
    await searchInput.fill(term);
    await page.waitForTimeout(500);
    await searchInput.press("Enter");

    await page.waitForLoadState("domcontentloaded");
    await waitForStable(page);
  }

  test("search input should be visible on homepage", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    await expect(page.locator(config.selectors.searchInput)).toBeVisible();
  });

  test("typing and submitting search should return results", async ({
    page,
  }) => {
    await searchFor(page, config.testData.searchTerm);

    // URL should contain search term or be on search page
    const url = page.url().toLowerCase();
    expect(
      url.includes("search") ||
        url.includes("busca") ||
        url.includes(encodeURIComponent(config.testData.searchTerm).toLowerCase())
    ).toBeTruthy();
  });

  test("search results should display product cards", async ({ page }) => {
    await searchFor(page, config.testData.searchTerm);

    await page.waitForLoadState("domcontentloaded");
    await waitForStable(page);

    // Should have product links on the results page
    const productCards = page.locator(config.selectors.productCardLink);
    await expect(productCards.first()).toBeVisible({ timeout: 15_000 });

    const count = await productCards.count();
    expect(count).toBeGreaterThan(0);
  });

  test("search result products should have title and price", async ({
    page,
  }) => {
    await searchFor(page, config.testData.searchTerm);

    // Check first product card has a heading (title)
    const firstProduct = page.locator(config.selectors.productCardLink).first();
    await expect(firstProduct).toBeVisible({ timeout: 15_000 });

    const title = firstProduct.locator("h2, h3").first();
    await expect(title).toBeVisible();

    // Check there's a price somewhere
    const priceText = await firstProduct.textContent();
    expect(priceText).toContain("R$");
  });

  test("clicking search button should also work", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookieConsent(page);

    const searchInput = page.locator(config.selectors.searchInput);
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.click();
    await searchInput.fill(config.testData.searchTerm);
    await page.waitForTimeout(500);

    // Try the configured button first, fall back to form submit
    const searchButton = page.locator(config.selectors.searchButton).first();
    const isVisible = await searchButton.isVisible().catch(() => false);

    if (isVisible) {
      await searchButton.click();
    } else {
      await searchInput.press("Enter");
    }

    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const url = page.url().toLowerCase();
    expect(
      url.includes("search") ||
        url.includes("busca") ||
        url.includes(config.testData.searchTerm.toLowerCase())
    ).toBeTruthy();
  });
});
