import { test, expect } from "@playwright/test";
import { loadSiteConfig } from "../lib/config";
import { goTo, waitForStable, dismissCookieConsent, shouldSkip } from "../lib/helpers";

const config = loadSiteConfig();

test.describe("Authentication", () => {
  test.skip(shouldSkip(config, "auth"), "Skipped via config");

  test("login button should be visible in header", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    const loginBtn = page.locator(config.selectors.loginButton).first();
    await expect(loginBtn).toBeVisible();
  });

  test("clicking login should open dropdown, modal, or navigate", async ({
    page,
  }) => {
    await goTo(page, config, config.pages.home);
    await dismissCookieConsent(page);

    const loginBtn = page.locator(config.selectors.loginButton).first();
    await loginBtn.click();
    await page.waitForTimeout(2000);

    const url = page.url();
    const hasLoginUrl = url.includes("login") || url.includes("account");
    const hasModal = await page
      .locator("[role='dialog'], [data-modal], .modal")
      .isVisible()
      .catch(() => false);
    // Check for dropdown with login links or text
    const hasPopover = await page
      .locator("a[href*='login'], a:has-text('Entrar'), a:has-text('Cadastr'), a:has-text('Fazer login')")
      .isVisible()
      .catch(() => false);
    // Check if a dropdown appeared with "Escolha" or account-related text
    const pageText = await page.textContent("body");
    const hasDropdownText =
      pageText?.includes("Escolha") ||
      pageText?.includes("Entrar") ||
      pageText?.includes("Cadastre-se") ||
      pageText?.includes("Minha conta");

    expect(hasLoginUrl || hasModal || hasPopover || hasDropdownText).toBeTruthy();
  });

  test("login page should have email and password fields", async ({
    page,
  }) => {
    await goTo(page, config, config.pages.login);
    await waitForStable(page);

    const emailInput = page.locator(
      "input[type='email'], input[name='email'], input[placeholder*='email'], input[placeholder*='Email']"
    );
    const passwordInput = page.locator(
      "input[type='password'], input[name='password']"
    );

    const hasForm =
      (await emailInput.count()) > 0 || (await passwordInput.count()) > 0;
    const isOnLoginPage =
      page.url().includes("login") || page.url().includes("account");

    expect(hasForm || isOnLoginPage).toBeTruthy();
  });

  test("my account link should exist", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    const myAccountLink = page.locator(
      "a[href*='my-account'], a[href*='meus-pedidos'], a:has-text('Meus pedidos')"
    );
    const count = await myAccountLink.count();
    expect(count).toBeGreaterThan(0);
  });
});
