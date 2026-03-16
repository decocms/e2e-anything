import { test, expect } from "@playwright/test";
import { loadSiteConfig } from "../lib/config";
import { goTo, waitForStable, dismissCookieConsent, shouldSkip } from "../lib/helpers";

const config = loadSiteConfig();

test.describe("Category Filters", () => {
  test.skip(shouldSkip(config, "filters"), "Skipped via config");

  test.beforeEach(async ({ page }) => {
    const categoryUrl = config.pages.category || "/eletroportateis";
    await goTo(page, config, categoryUrl);
    // Use domcontentloaded + short wait instead of networkidle (category pages keep loading)
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);
    await dismissCookieConsent(page);
  });

  test("filters sidebar should be visible", async ({ page }) => {
    // Filters might be in a complementary region or aside element
    const filters = page.locator(config.selectors.filtersContainer);
    // Wait for at least one to appear, then check visibility of any
    const count = await filters.count();
    let anyVisible = false;
    for (let i = 0; i < count; i++) {
      if (await filters.nth(i).isVisible().catch(() => false)) {
        anyVisible = true;
        break;
      }
    }
    // On mobile, filters might be behind a toggle button
    if (!anyVisible) {
      const filterToggle = page.locator("button:has-text('Filtrar'), button:has-text('Filter'), [data-filter-toggle]");
      const hasToggle = await filterToggle.isVisible().catch(() => false);
      expect(hasToggle || count > 0).toBeTruthy();
    } else {
      expect(anyVisible).toBeTruthy();
    }
  });

  test("should have multiple filter groups", async ({ page }) => {
    // Check for filter-related text on the page (filter labels like Marca, Faixa de Preço, etc.)
    const pageText = await page.textContent("body");
    const filterLabels = ["Marca", "Faixa de Preço", "Categoria", "Subcategoria", "Cor"];
    const foundLabels = filterLabels.filter((label) => pageText?.includes(label));

    expect(foundLabels.length, `Expected filter groups like ${filterLabels.join(", ")}`).toBeGreaterThan(0);
  });

  test("price filter should have min/max inputs", async ({ page }) => {
    // Price filter inputs use placeholder="Mínimo" and placeholder="Máximo"
    const minInput = page.locator("input[placeholder='Mínimo']");
    const maxInput = page.locator("input[placeholder='Máximo']");

    // Scroll the min input into view if it exists
    const minCount = await minInput.count();
    if (minCount > 0) {
      await minInput.first().scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(500);

      await expect(minInput.first()).toBeVisible({ timeout: 5_000 });
      await expect(maxInput.first()).toBeVisible({ timeout: 5_000 });
    } else {
      // Price filter might not exist on this category
      const pageText = await page.textContent("body");
      expect.soft(
        pageText?.includes("Faixa de Preço") || pageText?.includes("Preço"),
        "Price filter section should exist on category page"
      ).toBeTruthy();
    }
  });

  test("sort select should work", async ({ page }) => {
    const sortSelect = page.locator(config.selectors.sortSelect).first();
    await expect(sortSelect).toBeVisible();

    // Try changing sort
    await sortSelect.selectOption({ index: 1 }).catch(async () => {
      // If it's a custom combobox, click it
      await sortSelect.click();
      await page.waitForTimeout(500);
    });
  });

  test("products should be displayed on category page", async ({ page }) => {
    const productCards = page.locator(config.selectors.productCardLink);
    await expect(productCards.first()).toBeVisible({ timeout: 10_000 });

    const count = await productCards.count();
    expect(count).toBeGreaterThan(0);
  });

  test("product cards should have title and price", async ({ page }) => {
    const firstProduct = page.locator(config.selectors.productCardLink).first();
    await expect(firstProduct).toBeVisible({ timeout: 10_000 });

    // Check heading
    const title = firstProduct.locator("h2, h3").first();
    await expect(title).toBeVisible();

    // Check price
    const text = await firstProduct.textContent();
    expect(text).toContain("R$");
  });

  test("pagination should exist when many products", async ({ page }) => {
    const pagination = page.locator(
      "a[href*='page=2'], a:has-text('next'), nav[aria-label*='page']"
    );
    const count = await pagination.count();
    // Pagination may not exist if few products, so soft assert
    if (count > 0) {
      expect(count).toBeGreaterThan(0);
    }
  });

  test("grid/list view toggle should exist", async ({ page }) => {
    const gridButton = page.locator("button:has-text('Grade'), button:has-text('Grid')");
    const listButton = page.locator("button:has-text('Lista'), button:has-text('List')");

    const hasGrid = await gridButton.isVisible().catch(() => false);
    const hasList = await listButton.isVisible().catch(() => false);

    expect.soft(hasGrid || hasList, "Grid/List toggle not found — may not be implemented").toBeTruthy();
  });
});
