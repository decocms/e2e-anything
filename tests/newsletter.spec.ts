import { test, expect } from "@playwright/test";
import { loadSiteConfig } from "../lib/config";
import { goTo, waitForStable, shouldSkip } from "../lib/helpers";

const config = loadSiteConfig();

test.describe("Newsletter", () => {
  test.skip(shouldSkip(config, "newsletter"), "Skipped via config");

  test("newsletter section should be visible", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    await waitForStable(page);

    // Scroll to bottom to trigger lazy loading
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    const newsletterInput = page.locator(config.selectors.newsletterInput).first();
    await expect(newsletterInput).toBeVisible({ timeout: 10_000 });
  });

  test("newsletter should have email input and submit button", async ({
    page,
  }) => {
    await goTo(page, config, config.pages.home);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    const input = page.locator(config.selectors.newsletterInput).first();
    const button = page.locator(config.selectors.newsletterButton).first();

    await expect(input).toBeVisible();
    await expect(button).toBeVisible();
  });

  test("should be able to type email in newsletter input", async ({
    page,
  }) => {
    await goTo(page, config, config.pages.home);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    const input = page.locator(config.selectors.newsletterInput).first();
    await input.fill(config.testData.newsletterEmail);

    const value = await input.inputValue();
    expect(value).toBe(config.testData.newsletterEmail);
  });

  test("submitting newsletter should show feedback", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    const input = page.locator(config.selectors.newsletterInput).first();
    const button = page.locator(config.selectors.newsletterButton).first();

    await input.fill(config.testData.newsletterEmail);
    await button.click();
    await page.waitForTimeout(2000);

    // Check for any feedback — success message, toast, alert, or form state change
    const pageText = await page.textContent("body");
    const hasFeedback =
      pageText?.includes("sucesso") ||
      pageText?.includes("Obrigado") ||
      pageText?.includes("cadastrado") ||
      pageText?.includes("Sucesso") ||
      pageText?.includes("receber");

    // Also check if form was cleared (another success indicator)
    const inputValue = await input.inputValue().catch(() => "");
    const formCleared = inputValue === "";

    // We expect either visible feedback or form cleared
    expect(hasFeedback || formCleared).toBeTruthy();
  });
});
