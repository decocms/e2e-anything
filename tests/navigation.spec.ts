import { test, expect } from "@playwright/test";
import { loadSiteConfig } from "../lib/config";
import { goTo, shouldSkip } from "../lib/helpers";

const config = loadSiteConfig();

test.describe("Navigation", () => {
  test.skip(shouldSkip(config, "navigation"), "Skipped via config");

  test("menu links should be visible", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    const menuLinks = page.locator(config.selectors.menuLinks);
    const count = await menuLinks.count();
    expect(count).toBeGreaterThan(3);
  });

  test("each menu link should navigate to a valid page", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    const menuLinks = page.locator(config.selectors.menuLinks);
    const hrefs = await menuLinks.evaluateAll((els) =>
      els.map((el) => el.getAttribute("href")).filter(Boolean)
    );

    const internalLinks = hrefs
      .filter((h): h is string => !!h && h.startsWith("/"))
      .slice(0, 8); // Test first 8 menu items

    for (const href of internalLinks) {
      const response = await page.request.get(`${config.baseUrl}${href}`);
      expect
        .soft(
          response.status(),
          `Menu link ${href} returned ${response.status()}`
        )
        .toBeLessThan(400);
    }
  });

  test("clicking a category link should load category page", async ({
    page,
  }) => {
    await goTo(page, config, config.pages.home);
    const firstMenuLink = page.locator(config.selectors.menuLinks).first();
    const href = await firstMenuLink.getAttribute("href");
    expect(href).toBeTruthy();

    await firstMenuLink.click();
    await page.waitForLoadState("domcontentloaded");

    // Should have navigated away from home
    expect(page.url()).not.toBe(`${config.baseUrl}/`);
  });

  test("category page should display breadcrumb or heading", async ({
    page,
  }) => {
    const categoryUrl = config.pages.category || "/eletroportateis";
    await goTo(page, config, categoryUrl);

    // Look for a heading or breadcrumb that indicates the category
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test("mobile menu button should exist", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    const menuButton = page.locator(
      "button:has-text('open menu'), button:has-text('menu'), [data-menu-button]"
    );
    const count = await menuButton.count();
    expect(count).toBeGreaterThan(0);
  });
});
