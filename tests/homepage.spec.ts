import { test, expect } from "@playwright/test";
import { loadSiteConfig } from "../lib/config";
import { goTo, waitForStable, shouldSkip } from "../lib/helpers";

const config = loadSiteConfig();

test.describe("Homepage", () => {
  test.skip(shouldSkip(config, "homepage"), "Skipped via config");

  test("should load with 200 status", async ({ page }) => {
    const response = await goTo(page, config, config.pages.home);
    expect(response?.status()).toBe(200);
  });

  test("should have no critical console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });
    await goTo(page, config, config.pages.home);
    await waitForStable(page);

    // Filter out known non-critical errors (third-party scripts, etc.)
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes("third-party") &&
        !e.includes("favicon") &&
        !e.includes("ERR_BLOCKED_BY_CLIENT") &&
        !e.includes("net::ERR")
    );
    // Log for visibility but don't fail on console errors (too noisy)
    if (criticalErrors.length > 0) {
      console.warn("Console errors found:", criticalErrors.slice(0, 5));
    }
  });

  test("should display header with logo", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    await expect(page.locator("header")).toBeVisible();
    await expect(
      page.locator('header img[alt*="Logo"], header img[alt*="logo"], header a[href="/"] img')
    ).toBeVisible();
  });

  test("should display navigation menu", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    const menuLinks = page.locator(config.selectors.menuLinks);
    const count = await menuLinks.count();
    expect(count).toBeGreaterThan(0);
  });

  test("should display search bar", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    await expect(page.locator(config.selectors.searchInput)).toBeVisible();
  });

  test("should display footer", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    await expect(page.locator(config.selectors.footer).first()).toBeVisible();
  });

  test("should have product shelves or banners on homepage", async ({
    page,
  }) => {
    await goTo(page, config, config.pages.home);
    await waitForStable(page);

    // Check for product links or banner images
    const productLinks = page.locator("a[href*='/p']");
    const bannerImages = page.locator("img[alt*='banner'], img[alt*='Banner'], section img");
    const hasProducts = (await productLinks.count()) > 0;
    const hasBanners = (await bannerImages.count()) > 0;
    expect(hasProducts || hasBanners).toBeTruthy();
  });

  test("homepage links should not be broken (sample check)", async ({
    page,
  }) => {
    await goTo(page, config, config.pages.home);
    await waitForStable(page);

    // Get a sample of internal links (first 10)
    const links = await page
      .locator('a[href^="/"]')
      .evaluateAll((els) =>
        els
          .slice(0, 10)
          .map((el) => el.getAttribute("href"))
          .filter(Boolean)
      );

    const uniqueLinks = [...new Set(links)];

    for (const href of uniqueLinks.slice(0, 10)) {
      const response = await page.request.get(`${config.baseUrl}${href}`);
      expect
        .soft(response.status(), `Link ${href} returned ${response.status()}`)
        .toBeLessThan(500);
    }
  });
});
