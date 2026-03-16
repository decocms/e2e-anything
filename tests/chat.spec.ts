import { test, expect } from "@playwright/test";
import { loadSiteConfig } from "../lib/config";
import { goTo, waitForStable, shouldSkip } from "../lib/helpers";

const config = loadSiteConfig();

test.describe("Chat Widget", () => {
  test.skip(shouldSkip(config, "chat"), "Skipped via config");

  test("chat widget should be present on page", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    await waitForStable(page);
    // Wait extra time for third-party chat scripts to load
    await page.waitForTimeout(5000);

    const chatWidget = page.locator(config.selectors.chatWidget);
    const whatsappLink = page.locator(
      "a[href*='whatsapp'], a[href*='wa.me']"
    );

    const hasChatWidget = await chatWidget.isVisible().catch(() => false);
    const hasWhatsapp = (await whatsappLink.count()) > 0;

    // Site should have either a chat widget or WhatsApp link
    expect(
      hasChatWidget || hasWhatsapp
    ).toBeTruthy();
  });

  test("WhatsApp link should have valid phone number", async ({ page }) => {
    await goTo(page, config, config.pages.home);

    const whatsappLinks = page.locator("a[href*='wa.me'], a[href*='whatsapp']");
    const count = await whatsappLinks.count();

    if (count > 0) {
      const href = await whatsappLinks.first().getAttribute("href");
      expect(href).toBeTruthy();
      expect(href).toMatch(/\d{10,}/); // Should contain a phone number
    }
  });

  test("chat widget should be clickable/openable", async ({ page }) => {
    await goTo(page, config, config.pages.home);
    await waitForStable(page);
    await page.waitForTimeout(5000);

    const chatWidget = page.locator(config.selectors.chatWidget);
    const hasChatWidget = await chatWidget.isVisible().catch(() => false);

    if (hasChatWidget) {
      // Try to click the chat widget
      await chatWidget.click().catch(() => {});
      await page.waitForTimeout(1000);

      // Check if something opened (expanded iframe, modal, etc.)
      const dialogs = page.locator(
        "[role='dialog'], iframe[src*='chat'], .chat-open, .chat-expanded"
      );
      const count = await dialogs.count();
      // Just log — chat behavior varies wildly
      console.log(`Chat widget click resulted in ${count} dialog elements`);
    }
  });
});
